"""DNK AllInventory API — upload PMSH01 available inventory, download PO-split workbook."""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response

from app.dependencies import get_current_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.services.dnk_all_inventory import DnkAllInventoryError, generate_dnk_all_inventory
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_BYTES = 25 * 1024 * 1024


def _validate_xlsx_upload(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not (name.endswith(".xlsx") or name.endswith(".xlsm")):
        raise HTTPException(status_code=400, detail="Only .xlsx Excel files are supported.")


@router.post("/dnk-all-inventory/generate", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("generate DNK AllInventory workbook")
async def generate_dnk_all_inventory_file(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Split a PMSH01 AvailInventory export into master + one sheet per PONumber."""
    _ = current_user
    _validate_xlsx_upload(file)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 25 MB).")

    try:
        result = generate_dnk_all_inventory(raw, file.filename or "PMSH01-AvailInventory.xlsx")
    except DnkAllInventoryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    headers = {
        "Content-Disposition": f'attachment; filename="{result.filename}"',
        "X-Dnk-Filename": result.filename,
        "X-Dnk-Row-Count": str(result.row_count),
        "X-Dnk-Po-Count": str(result.po_count),
        "X-Dnk-Available-Lines": str(result.available_gt_zero),
        "X-Dnk-Date-Stamp": result.date_stamp,
    }
    return Response(
        content=result.file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )
