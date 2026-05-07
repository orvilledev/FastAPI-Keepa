"""Tracking Extractor API endpoints.

Accepts a multi-page PDF whose odd pages carry a text-based FBA shipment
label and whose even pages carry an image-based UPS shipping label, and
returns either a JSON list of extracted rows or a CSV file.
"""
import io
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.dependencies import get_current_user
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


class TrackingScannerRow(BaseModel):
    source_file: str
    odd_page: Optional[int]
    even_page: Optional[int]
    vendor: str = ""
    shipment_id: str = ""
    box_code: str = ""
    tracking_number: str = ""
    tracking_number_raw: str = ""
    carrier: str = ""
    status: str = "ok"
    notes: str = ""


class TrackingScannerResponse(BaseModel):
    filename: str
    page_count_estimate: int
    pair_count: int
    matched_count: int
    needs_review_count: int
    rows: List[TrackingScannerRow]


class TrackingScannerExportRequest(BaseModel):
    filename: Optional[str] = None
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
