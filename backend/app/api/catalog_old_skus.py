"""Old SKUs catalog — list, import (full replace), and Excel template download."""
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_old_skus_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.models.catalog_old_skus import (
    CatalogOldSkusImportResult,
    CatalogOldSkusListResponse,
    CatalogOldSkusRecordResponse,
)
from app.repositories.catalog_old_skus_repository import CatalogOldSkusRepository
from app.services.catalog_old_skus_headers import HEADERS, TEMPLATE_FILENAME
from app.services.catalog_old_skus_import import (
    dedupe_by_old_sku,
    old_sku_row_to_record,
    parse_old_skus_spreadsheet,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_IMPORT_BYTES = 25 * 1024 * 1024
_TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent / "static" / "catalog_templates" / TEMPLATE_FILENAME
)


def _validate_xlsx(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".xlsm", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="Upload an .xlsx file matching the Old SKUs template.",
        )


async def _read_upload(file: UploadFile) -> bytes:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_IMPORT_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 25 MB limit.")
    return raw


@router.get("/catalog-old-skus/template")
@handle_api_errors("download Old SKUs template")
def download_old_skus_template(current_user: dict = Depends(get_old_skus_user)):
    if not _TEMPLATE_PATH.is_file():
        raise HTTPException(status_code=404, detail="Old SKUs template file is missing.")
    return FileResponse(
        _TEMPLATE_PATH,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=TEMPLATE_FILENAME,
    )


@router.get("/catalog-old-skus", response_model=CatalogOldSkusListResponse)
@handle_api_errors("list Old SKUs catalog")
def list_old_skus(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_old_skus_user),
    db: Client = Depends(get_supabase),
):
    repo = CatalogOldSkusRepository(db)
    items, total = repo.list_records(limit=limit, offset=offset, search=search)
    return CatalogOldSkusListResponse(
        items=[CatalogOldSkusRecordResponse(**row) for row in items],
        total=total,
        limit=limit,
        offset=offset,
        columns=list(HEADERS),
    )


@router.post("/catalog-old-skus/import", response_model=CatalogOldSkusImportResult)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("import Old SKUs catalog")
async def import_old_skus(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_old_skus_user),
    db: Client = Depends(get_supabase),
):
    """Replace the Old SKUs catalog with the uploaded workbook contents."""
    _validate_xlsx(file)
    raw = await _read_upload(file)
    try:
        parsed, invalid = parse_old_skus_spreadsheet(file.filename or "upload.xlsx", raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    unique = dedupe_by_old_sku(parsed)
    if not unique:
        raise HTTPException(status_code=400, detail="No valid Old SKU rows found in file.")

    records = [old_sku_row_to_record(row) for row in unique]
    repo = CatalogOldSkusRepository(db)
    try:
        result = repo.replace_all(records)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Old SKUs catalog import by %s: %s rows (%s invalid)",
        current_user.get("email"),
        result["imported"],
        invalid,
    )
    return CatalogOldSkusImportResult(
        imported=result["imported"],
        invalid=invalid,
        total_in_file=len(unique) + invalid,
        replaced=True,
    )
