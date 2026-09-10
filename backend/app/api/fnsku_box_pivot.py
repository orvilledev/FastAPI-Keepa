"""FNSKU Box Pivot API — upload FNSKU + BOX# scans, download the pivot workbook."""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_current_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.repositories.warehouse_product_repository import WarehouseProductRepository
from app.services.fnsku_box_pivot import (
    OUTPUT_FILENAME,
    FnskuBoxPivotError,
    build_template_workbook,
    generate_fnsku_box_pivot,
    parse_fnsku_box_rows,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_BYTES = 15 * 1024 * 1024


def _validate_xlsx_upload(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not (name.endswith(".xlsx") or name.endswith(".xlsm")):
        raise HTTPException(status_code=400, detail="Only .xlsx Excel files are supported.")


def _attachment_filename(name: str) -> str:
    cleaned = (name or OUTPUT_FILENAME).replace('"', "").replace("\r", "").replace("\n", "").strip()
    return cleaned or OUTPUT_FILENAME


@router.get("/fnsku-box-pivot/template")
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("download FNSKU Box Pivot template")
async def download_template(
    request: Request,
    current_user=Depends(get_current_user),
):
    _ = current_user
    content = build_template_workbook()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="FNSKU Box Pivot Template.xlsx"',
            "X-Box-Pivot-Filename": "FNSKU Box Pivot Template.xlsx",
        },
    )


@router.post("/fnsku-box-pivot/generate", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("generate FNSKU Box Pivot workbook")
async def generate_fnsku_box_pivot_file(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Look up each FNSKU in the warehouse catalog and emit scanned data + box pivot."""
    _ = current_user
    _validate_xlsx_upload(file)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 15 MB).")

    try:
        scan_rows = parse_fnsku_box_rows(raw)
    except FnskuBoxPivotError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    unique_fnskus = list(dict.fromkeys(row.fnsku for row in scan_rows))
    repo = WarehouseProductRepository(db)
    catalog_by_fnsku = repo.lookup_by_fnskus(unique_fnskus)

    try:
        result = generate_fnsku_box_pivot(
            raw,
            catalog_by_fnsku,
            filename=OUTPUT_FILENAME,
            scan_rows=scan_rows,
        )
    except FnskuBoxPivotError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    unmatched_preview = ", ".join(result.unmatched_fnskus[:12])
    headers = {
        "Content-Disposition": f'attachment; filename="{_attachment_filename(result.filename)}"',
        "X-Box-Pivot-Filename": result.filename,
        "X-Box-Pivot-Row-Count": str(result.row_count),
        "X-Box-Pivot-Sku-Count": str(result.sku_count),
        "X-Box-Pivot-Unmatched-Count": str(result.unmatched_count),
        "X-Box-Pivot-Unmatched-Fnskus": unmatched_preview,
    }
    return Response(
        content=result.file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )
