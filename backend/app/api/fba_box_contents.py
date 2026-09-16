"""FBA Box Contents API — upload FBA Carton Detail, download Box Contents workbook."""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response

from app.dependencies import get_fba_box_contents_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.services.fba_box_contents import (
    DEFAULT_OUTPUT_FILENAME,
    FbaBoxContentsError,
    generate_fba_box_contents,
    sanitize_download_filename,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_BYTES = 15 * 1024 * 1024


def _validate_upload(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not (name.endswith(".xls") or name.endswith(".xlsx") or name.endswith(".xlsm")):
        raise HTTPException(
            status_code=400,
            detail="Only FBA Carton Detail .xls or .xlsx Excel files are supported.",
        )


@router.post("/fba-box-contents/generate", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("generate FBA Box Contents workbook")
async def generate_fba_box_contents_file(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_fba_box_contents_user),
):
    """Turn an FBA Carton Detail dump into Box Contents + Dimensions Excel."""
    _ = current_user
    _validate_upload(file)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 15 MB).")

    try:
        result = generate_fba_box_contents(raw, file.filename or DEFAULT_OUTPUT_FILENAME)
    except FbaBoxContentsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    safe_name = sanitize_download_filename(result.filename, DEFAULT_OUTPUT_FILENAME)
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_name}"',
        "X-Fba-Filename": safe_name,
        "X-Fba-Row-Count": str(result.row_count),
        "X-Fba-Box-Count": str(result.box_count),
        "X-Fba-Upc-Count": str(result.upc_count),
        "X-Fba-Total-Qty": str(result.total_qty),
        "X-Fba-Shipment-Id": result.shipment_id,
    }
    return Response(
        content=result.file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )
