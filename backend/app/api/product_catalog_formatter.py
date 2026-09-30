"""Product Catalog Formatter API — shipment-plan exports become one catalog workbook."""
import logging

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import Response

from app.middleware.rate_limiter import RateLimits, limiter
from app.services.product_catalog_formatter import (
    MAX_FILES,
    MAX_UPLOAD_BYTES,
    OUTPUT_FILENAME,
    ProductCatalogFormatterError,
    format_catalogs,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_ACCEPTED_SUFFIXES = (".xls", ".xlsx", ".xlsm", ".csv")


def _safe_disposition_name(filename: str) -> str:
    cleaned = (filename or OUTPUT_FILENAME).replace('"', "").replace("\r", "").replace("\n", "")
    return cleaned or OUTPUT_FILENAME


@router.post("/product-catalog-formatter/format", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("format a product catalog")
async def format_product_catalog(
    request: Request,
    files: list[UploadFile] = File(..., description="Shipment-plan product catalog exports"),
):
    """Merge uploaded shipment-plan files into one catalog with unique UPCs."""
    if not files:
        raise HTTPException(status_code=400, detail="No files were uploaded.")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Upload at most {MAX_FILES} files at a time.")

    uploads: list[tuple[str, bytes]] = []
    for file in files:
        name = file.filename or "upload"
        if not name.lower().endswith(_ACCEPTED_SUFFIXES):
            raise HTTPException(
                status_code=400,
                detail=f'"{name}" is not a supported file. Upload .xlsx, .xlsm, .xls, or .csv.',
            )
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail=f'"{name}" is empty.')
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail=f'"{name}" is too large (max 15 MB).')
        uploads.append((name, raw))

    try:
        result = format_catalogs(uploads)
    except ProductCatalogFormatterError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    safe_name = _safe_disposition_name(result.filename)
    return Response(
        content=result.file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "X-Catalog-Filename": safe_name,
            "X-Catalog-File-Count": str(result.file_count),
            "X-Catalog-Row-Count": str(result.row_count),
            "X-Catalog-Source-Rows": str(result.source_rows),
            "X-Catalog-Duplicates-Removed": str(result.duplicates_removed),
            "X-Catalog-Skipped-Rows": str(result.skipped_rows),
        },
    )
