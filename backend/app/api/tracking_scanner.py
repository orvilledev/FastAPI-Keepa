"""Tracking Extractor API endpoints.

Accepts a multi-page PDF whose odd pages carry a text-based FBA shipment
label and whose even pages carry an image-based UPS shipping label, and
returns either a JSON list of extracted rows or a CSV file.
"""
import io
import logging
from datetime import datetime
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from supabase import Client

from app.dependencies import get_current_user
from app.database import get_supabase
from app.models.tracking_history import (
    TrackingHistoryCreate,
    TrackingHistoryDetail,
    TrackingHistorySummary,
    TrackingScannerRow,
)
from app.services.tracking_scanner import (
    ScannedRow,
    extract_pairs_from_pdf,
    rows_to_csv_bytes,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()


# Hard cap on PDF size to keep OCR work bounded (~25 MB matches a few hundred
# label pages well above any realistic shipping-label PDF).
_MAX_PDF_BYTES = 25 * 1024 * 1024


class TrackingScannerResponse(BaseModel):
    filename: str
    page_count_estimate: int
    pair_count: int
    matched_count: int
    needs_review_count: int
    rows: List[TrackingScannerRow]


class TrackingScannerExportRequest(BaseModel):
    filename: str | None = None
    rows: List[TrackingScannerRow]


def _validate_pdf_upload(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not name.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")


def _row_to_pydantic(row: ScannedRow) -> TrackingScannerRow:
    data = row.to_dict()
    return TrackingScannerRow(**data)


def _safe_csv_filename(stem: str) -> str:
    safe = "".join(c for c in (stem or "tracking") if c.isalnum() or c in (" ", "-", "_")).strip()
    safe = safe.replace(" ", "_") or "tracking"
    return f"{safe}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"


@router.post("/tracking-scanner/scan", response_model=TrackingScannerResponse)
@handle_api_errors("scan tracking PDF")
async def scan_tracking_pdf(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Parse a PDF and return extracted (shipment_id, tracking_number) pairs."""
    _validate_pdf_upload(file)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")
    if len(raw) > _MAX_PDF_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"PDF exceeds {_MAX_PDF_BYTES // (1024 * 1024)} MB size limit.",
        )

    try:
        rows = extract_pairs_from_pdf(raw, source_file=file.filename or "")
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Failed to scan tracking PDF: %s", file.filename)
        raise HTTPException(status_code=400, detail=f"Could not parse PDF: {exc}")

    pyd_rows = [_row_to_pydantic(r) for r in rows]
    matched = sum(1 for r in rows if r.tracking_number and r.shipment_id)
    needs_review = sum(1 for r in rows if r.status == "needs_review")

    return TrackingScannerResponse(
        filename=file.filename or "",
        page_count_estimate=len(rows) * 2,
        pair_count=len(rows),
        matched_count=matched,
        needs_review_count=needs_review,
        rows=pyd_rows,
    )


@router.post("/tracking-scanner/export-csv")
@handle_api_errors("export tracking CSV")
async def export_tracking_csv(
    payload: TrackingScannerExportRequest,
    current_user: dict = Depends(get_current_user),
):
    """Render an already-extracted (and optionally edited) row set to CSV."""
    if not payload.rows:
        raise HTTPException(status_code=400, detail="No rows provided to export.")

    rows = [
        ScannedRow(
            source_file=r.source_file,
            odd_page=r.odd_page,
            even_page=r.even_page,
            vendor=r.vendor,
            shipment_id=r.shipment_id,
            box_code=r.box_code,
            tracking_number=r.tracking_number,
            tracking_number_raw=r.tracking_number_raw,
            carrier=r.carrier,
            status=r.status,
            notes=[r.notes] if r.notes else [],
        )
        for r in payload.rows
    ]
    csv_bytes = rows_to_csv_bytes(rows)
    filename = _safe_csv_filename(payload.filename or "tracking_extract")
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _history_summary_from_row(row: dict) -> TrackingHistorySummary:
    return TrackingHistorySummary(
        id=row["id"],
        user_id=row["user_id"],
        name=row.get("name"),
        source_count=row.get("source_count", 0),
        file_count=row.get("file_count", 0),
        pair_count=row.get("pair_count", 0),
        matched_count=row.get("matched_count", 0),
        needs_review_count=row.get("needs_review_count", 0),
        row_count=row.get("row_count", 0),
        created_at=row["created_at"],
    )


@router.get("/tracking-scanner/history", response_model=List[TrackingHistorySummary])
@handle_api_errors("list tracking scan history")
async def list_tracking_history(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    response = (
        db.table("tracking_scan_history")
        .select(
            "id,user_id,name,source_count,file_count,pair_count,matched_count,needs_review_count,row_count,created_at"
        )
        .eq("user_id", current_user["id"])
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    return [_history_summary_from_row(row) for row in (response.data or [])]


@router.get("/tracking-scanner/history/{history_id}", response_model=TrackingHistoryDetail)
@handle_api_errors("get tracking scan history detail")
async def get_tracking_history(
    history_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    response = (
        db.table("tracking_scan_history")
        .select("*")
        .eq("id", str(history_id))
        .eq("user_id", current_user["id"])
        .limit(1)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="History record not found")
    row = response.data[0]
    return TrackingHistoryDetail(
        id=row["id"],
        user_id=row["user_id"],
        name=row.get("name"),
        source_count=row.get("source_count", 0),
        file_count=row.get("file_count", 0),
        pair_count=row.get("pair_count", 0),
        matched_count=row.get("matched_count", 0),
        needs_review_count=row.get("needs_review_count", 0),
        row_count=row.get("row_count", 0),
        created_at=row["created_at"],
        rows=[TrackingScannerRow(**item) for item in (row.get("rows") or [])],
    )


@router.post("/tracking-scanner/history", response_model=TrackingHistorySummary, status_code=201)
@handle_api_errors("save tracking scan history")
async def save_tracking_history(
    payload: TrackingHistoryCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    if not payload.rows:
        raise HTTPException(status_code=400, detail="Cannot save empty tracking history.")

    record = {
        "user_id": current_user["id"],
        "name": (payload.name or "").strip() or None,
        "source_count": payload.source_count,
        "file_count": payload.file_count,
        "pair_count": payload.pair_count,
        "matched_count": payload.matched_count,
        "needs_review_count": payload.needs_review_count,
        "row_count": len(payload.rows),
        "rows": [row.model_dump() for row in payload.rows],
    }
    response = db.table("tracking_scan_history").insert(record).execute()
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to save history record")
    return _history_summary_from_row(response.data[0])


@router.delete("/tracking-scanner/history/{history_id}")
@handle_api_errors("delete tracking scan history")
async def delete_tracking_history(
    history_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    response = (
        db.table("tracking_scan_history")
        .delete()
        .eq("id", str(history_id))
        .eq("user_id", current_user["id"])
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="History record not found")
    return {"message": "History record deleted", "id": str(history_id)}
