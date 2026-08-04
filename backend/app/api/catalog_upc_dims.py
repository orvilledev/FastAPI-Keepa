"""Superadmin catalog records for UPC and DIMS spreadsheet data."""
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_superadmin_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.models.catalog_upc_dims import (
    CatalogDimsListResponse,
    CatalogDimsRecordResponse,
    CatalogImportResult,
    CatalogUpcListResponse,
    CatalogUpcRecordResponse,
)
from app.repositories.catalog_upc_dims_repository import (
    CatalogDimsRepository,
    CatalogUpcRepository,
)
from app.services.catalog_upc_dims_headers import DIMS_HEADERS, UPC_HEADERS
from app.services.catalog_upc_dims_import import (
    dedupe_by_key,
    dims_row_to_record,
    parse_dims_spreadsheet,
    parse_upc_spreadsheet,
    upc_row_to_record,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_IMPORT_BYTES = 25 * 1024 * 1024
_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "static" / "catalog_templates"


def _validate_xlsx(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".xlsm", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="Upload an .xlsx file matching the UPC / DIMS template.",
        )


async def _read_upload(file: UploadFile) -> bytes:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_IMPORT_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 25 MB limit.")
    return raw


# ── UPC ──────────────────────────────────────────────────────────────────────


@router.get("/catalog-upc/template")
@handle_api_errors("download UPC catalog template")
def download_upc_template(current_user: dict = Depends(get_superadmin_user)):
    path = _TEMPLATE_DIR / "UPC_Template.xlsx"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="UPC template file is missing.")
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="UPC_Template.xlsx",
    )


@router.get("/catalog-upc", response_model=CatalogUpcListResponse)
@handle_api_errors("list catalog UPC records")
def list_catalog_upc(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase),
):
    repo = CatalogUpcRepository(db)
    items, total = repo.list_records(limit=limit, offset=offset, search=search)
    return CatalogUpcListResponse(
        items=[CatalogUpcRecordResponse(**row) for row in items],
        total=total,
        limit=limit,
        offset=offset,
        columns=list(UPC_HEADERS),
    )


@router.post("/catalog-upc/import", response_model=CatalogImportResult)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("import catalog UPC records")
async def import_catalog_upc(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase),
):
    """Replace UPC catalog with the UPC sheet from the uploaded workbook."""
    _validate_xlsx(file)
    raw = await _read_upload(file)
    try:
        parsed, invalid = parse_upc_spreadsheet(file.filename or "upload.xlsx", raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    unique = dedupe_by_key(parsed, "UPC Code")
    if not unique:
        raise HTTPException(status_code=400, detail="No valid UPC rows found in file.")

    records = [upc_row_to_record(row) for row in unique]
    repo = CatalogUpcRepository(db)
    try:
        result = repo.replace_all(records)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Catalog UPC import by %s: %s rows (%s invalid)",
        current_user.get("email"),
        result["imported"],
        invalid,
    )
    return CatalogImportResult(
        imported=result["imported"],
        invalid=invalid,
        total_in_file=len(parsed) + invalid,
        replaced=True,
    )


# ── DIMS ─────────────────────────────────────────────────────────────────────


@router.get("/catalog-dims/template")
@handle_api_errors("download DIMS catalog template")
def download_dims_template(current_user: dict = Depends(get_superadmin_user)):
    path = _TEMPLATE_DIR / "DIMS_Template.xlsx"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="DIMS template file is missing.")
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="DIMS_Template.xlsx",
    )


@router.get("/catalog-dims", response_model=CatalogDimsListResponse)
@handle_api_errors("list catalog DIMS records")
def list_catalog_dims(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase),
):
    repo = CatalogDimsRepository(db)
    items, total = repo.list_records(limit=limit, offset=offset, search=search)
    return CatalogDimsListResponse(
        items=[CatalogDimsRecordResponse(**row) for row in items],
        total=total,
        limit=limit,
        offset=offset,
        columns=list(DIMS_HEADERS),
    )


@router.post("/catalog-dims/import", response_model=CatalogImportResult)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("import catalog DIMS records")
async def import_catalog_dims(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase),
):
    """Replace DIMS catalog with the DIMS sheet from the uploaded workbook."""
    _validate_xlsx(file)
    raw = await _read_upload(file)
    try:
        parsed, invalid = parse_dims_spreadsheet(file.filename or "upload.xlsx", raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    unique = dedupe_by_key(parsed, "UPC #")
    if not unique:
        raise HTTPException(status_code=400, detail="No valid DIMS rows found in file.")

    records = [dims_row_to_record(row) for row in unique]
    repo = CatalogDimsRepository(db)
    try:
        result = repo.replace_all(records)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Catalog DIMS import by %s: %s rows (%s invalid)",
        current_user.get("email"),
        result["imported"],
        invalid,
    )
    return CatalogImportResult(
        imported=result["imported"],
        invalid=invalid,
        total_in_file=len(parsed) + invalid,
        replaced=True,
    )
