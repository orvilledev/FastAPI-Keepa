"""Manifest Generator API — upload a packing sheet, download STA FBA manifests zip."""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response

from app.dependencies import get_current_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.services.manifest_generator import ManifestGeneratorError, build_manifest_zip
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_BYTES = 15 * 1024 * 1024


def _validate_xlsx_upload(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not (name.endswith(".xlsx") or name.endswith(".xlsm")):
        raise HTTPException(status_code=400, detail="Only .xlsx Excel files are supported.")


@router.post("/manifest-generator/generate", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("generate FBA manifests")
async def generate_manifests(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Convert a Manifest Generator packing sheet into Amazon STA pack-group workbooks."""
    _ = current_user
    _validate_xlsx_upload(file)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 15 MB).")

    try:
        result = build_manifest_zip(raw)
    except ManifestGeneratorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    headers = {
        "Content-Disposition": f'attachment; filename="{result.zip_filename}"',
        "X-Manifest-File-Count": str(result.file_count),
        "X-Manifest-Primary-Vendor": result.primary_vendor,
        "X-Manifest-Sku-Count": str(result.sku_count),
        "X-Manifest-Total-Units": str(result.total_units),
        "X-Manifest-Zip-Filename": result.zip_filename,
    }
    return Response(
        content=result.zip_bytes,
        media_type="application/zip",
        headers=headers,
    )
