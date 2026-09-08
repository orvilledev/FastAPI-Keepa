"""Shipment Manager API — upload an FBA shipment export, download the WR SKU Update sheet."""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response

from app.dependencies import get_current_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.services.shipment_manager import (
    OUTPUT_FILENAME,
    ShipmentManagerError,
    build_wr_sku_update,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_BYTES = 15 * 1024 * 1024
_ACCEPTED_SUFFIXES = (".csv", ".txt", ".tsv", ".xlsx", ".xlsm")
_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _validate_upload(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not name.endswith(_ACCEPTED_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail="Upload the FBA shipment export as a .csv or .xlsx file.",
        )


def _header_safe(value: str) -> str:
    """HTTP headers are latin-1; drop anything a shipment name might smuggle in."""
    return "".join(char for char in value if 32 <= ord(char) < 127).strip()


@router.post("/shipment-manager/generate", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("generate WR SKU update sheet")
async def generate_wr_sku_update(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Convert an Amazon FBA shipment export into the WR SKU Update workbook."""
    _validate_upload(file)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 15 MB).")

    try:
        result = build_wr_sku_update(file.filename or "shipment.csv", raw)
    except ShipmentManagerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Shipment Manager export by %s: shipment %s, %s SKUs, %s units",
        current_user.get("email"),
        result.shipment_id or "unknown",
        result.sku_count,
        result.total_units,
    )

    headers = {
        "Content-Disposition": f'attachment; filename="{OUTPUT_FILENAME}"',
        "X-Shipment-Filename": OUTPUT_FILENAME,
        "X-Shipment-Id": _header_safe(result.shipment_id),
        "X-Shipment-Name": _header_safe(result.shipment_name),
        "X-Shipment-Ship-To": _header_safe(result.ship_to),
        "X-Shipment-Box-Count": str(result.box_count),
        "X-Shipment-Sku-Count": str(result.sku_count),
        "X-Shipment-Total-Units": str(result.total_units),
        "X-Shipment-Duplicate-Skus": str(result.duplicate_skus),
    }
    return Response(content=result.workbook_bytes, media_type=_XLSX_MEDIA_TYPE, headers=headers)
