"""FBA Upload Compare API — Output vs AMZ upload → Result workbook."""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_old_skus_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.repositories.catalog_old_skus_repository import CatalogOldSkusRepository
from app.services.fba_upload_compare import (
    DEFAULT_RESULT_FILENAME,
    FbaUploadCompareError,
    generate_fba_upload_compare,
    parse_amz_upload,
    parse_output_workbook,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_BYTES = 15 * 1024 * 1024


def _validate_xlsx(file: UploadFile, label: str) -> None:
    name = (file.filename or "").lower()
    if not (name.endswith(".xls") or name.endswith(".xlsx") or name.endswith(".xlsm")):
        raise HTTPException(
            status_code=400,
            detail=f"Only .xls or .xlsx Excel files are supported for the {label}.",
        )


async def _read_upload(file: UploadFile, label: str) -> bytes:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail=f"{label} file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"{label} file is too large (max 15 MB).")
    return raw


@router.post("/fba-upload-compare/generate", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("compare FBA Output vs AMZ upload")
async def generate_fba_upload_compare_file(
    request: Request,
    output_file: UploadFile = File(..., description="FBA Box Contents Output.xlsx"),
    amz_file: UploadFile = File(..., description="Amazon Upload file - AMZ.xlsx"),
    current_user=Depends(get_old_skus_user),
    db: Client = Depends(get_supabase),
):
    """Compare Output vs AMZ upload, remap Old SKUs, and return the Result workbook."""
    _ = current_user
    _validate_xlsx(output_file, "Output")
    _validate_xlsx(amz_file, "AMZ upload")

    output_bytes = await _read_upload(output_file, "Output")
    amz_bytes = await _read_upload(amz_file, "AMZ upload")

    try:
        parsed_output = parse_output_workbook(output_bytes)
        parsed_amz = parse_amz_upload(amz_bytes)
    except FbaUploadCompareError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    output_upcs = sorted({row.identifier for row in parsed_output.rows})
    amz_ids = sorted({row.sku_id for row in parsed_amz.skus})
    # Prefer looking up by Output UPCs; also include AMZ ids that may already be Old SKUs
    repo = CatalogOldSkusRepository(db)
    try:
        catalog_rows = repo.lookup_by_upcs_and_old_skus(output_upcs, amz_ids)
    except Exception as exc:
        logger.error("Old SKUs lookup failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to look up Old SKUs catalog mappings.",
        ) from exc

    try:
        result = generate_fba_upload_compare(
            output_bytes,
            amz_bytes,
            catalog_rows,
            output_filename=output_file.filename,
            amz_filename=amz_file.filename,
        )
    except FbaUploadCompareError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    safe_name = result.filename or DEFAULT_RESULT_FILENAME
    return Response(
        content=result.file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "X-Fba-Filename": safe_name,
            "X-Fba-Row-Count": str(result.row_count),
            "X-Fba-Box-Count": str(result.box_count),
            "X-Fba-Upc-Count": str(result.upc_count),
            "X-Fba-Total-Qty": str(result.total_qty),
            "X-Fba-Remapped-Count": str(result.remapped_count),
            "X-Fba-Missing-Count": str(result.missing_count),
            "X-Fba-Added-Count": str(result.added_count),
            "X-Fba-Added-Qty": str(result.added_qty),
            "X-Fba-Removed-Count": str(result.removed_count),
            "X-Fba-Removed-Qty": str(result.removed_qty),
            "X-Fba-Last-Box": str(result.last_box),
            "X-Fba-Shipment-Id": result.shipment_id,
        },
    )
