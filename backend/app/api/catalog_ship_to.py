"""Ship To Address catalog — list, import, and exact Excel template download."""
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_keepa_access_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.models.catalog_ship_to import (
    CatalogShipToImportPreview,
    CatalogShipToImportResult,
    CatalogShipToListResponse,
    CatalogShipToRecordResponse,
)
from app.repositories.catalog_ship_to_repository import CatalogShipToRepository
from app.services.catalog_ship_to_headers import HEADERS, TEMPLATE_FILENAME
from app.services.catalog_ship_to_import import (
    dedupe_by_code,
    parse_ship_to_spreadsheet,
    ship_to_row_to_record,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_IMPORT_BYTES = 25 * 1024 * 1024
_PREVIEW_CODE_LIMIT = 50
_TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent / "static" / "catalog_templates" / TEMPLATE_FILENAME
)


def _validate_xlsx(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".xlsm", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="Upload an .xlsx file matching the Ship To Address template.",
        )


async def _read_upload(file: UploadFile) -> bytes:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_IMPORT_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 25 MB limit.")
    return raw


def _parse_upload(filename: str, raw: bytes) -> tuple[list[dict[str, str]], int]:
    try:
        parsed, invalid = parse_ship_to_spreadsheet(filename, raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    unique = dedupe_by_code(parsed)
    if not unique:
        raise HTTPException(status_code=400, detail="No valid ship-to rows found in file.")
    return unique, invalid


@router.get("/catalog-ship-to/template")
@handle_api_errors("download ship-to address template")
def download_ship_to_template(current_user: dict = Depends(get_keepa_access_user)):
    if not _TEMPLATE_PATH.is_file():
        raise HTTPException(status_code=404, detail="Ship To Address template file is missing.")
    return FileResponse(
        _TEMPLATE_PATH,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=TEMPLATE_FILENAME,
    )


@router.get("/catalog-ship-to", response_model=CatalogShipToListResponse)
@handle_api_errors("list ship-to addresses")
def list_ship_to_addresses(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    repo = CatalogShipToRepository(db)
    items, total = repo.list_records(limit=limit, offset=offset, search=search)
    return CatalogShipToListResponse(
        items=[CatalogShipToRecordResponse(**row) for row in items],
        total=total,
        limit=limit,
        offset=offset,
        columns=list(HEADERS),
    )


@router.post("/catalog-ship-to/import/preview", response_model=CatalogShipToImportPreview)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("preview ship-to address import")
async def preview_ship_to_import(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Report which uploaded codes are new vs replacements before import."""
    _validate_xlsx(file)
    raw = await _read_upload(file)
    unique, invalid = _parse_upload(file.filename or "upload.xlsx", raw)
    codes = [(row.get("Code") or "").strip() for row in unique]
    repo = CatalogShipToRepository(db)
    try:
        existing = repo.find_existing_codes(codes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    existing_set = set(existing)
    return CatalogShipToImportPreview(
        valid_rows=len(unique),
        new_count=len([code for code in codes if code not in existing_set]),
        replace_count=len(existing),
        replace_codes=existing[:_PREVIEW_CODE_LIMIT],
        invalid=invalid,
        total_in_file=len(unique) + invalid,
    )


@router.post("/catalog-ship-to/import", response_model=CatalogShipToImportResult)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("import ship-to addresses")
async def import_ship_to_addresses(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Upsert ship-to rows from the uploaded workbook (replace matching codes)."""
    _validate_xlsx(file)
    raw = await _read_upload(file)
    unique, invalid = _parse_upload(file.filename or "upload.xlsx", raw)
    records = [ship_to_row_to_record(row) for row in unique]
    repo = CatalogShipToRepository(db)
    try:
        result = repo.upsert_all(records)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Ship-to catalog import by %s: %s rows (%s new, %s replaced, %s invalid)",
        current_user.get("email"),
        result["imported"],
        result["inserted"],
        result["replaced"],
        invalid,
    )
    return CatalogShipToImportResult(
        imported=result["imported"],
        inserted=result["inserted"],
        replaced=result["replaced"],
        invalid=invalid,
        total_in_file=len(unique) + invalid,
    )


@router.delete("/catalog-ship-to/{code}")
@handle_api_errors("delete ship-to address")
def delete_ship_to_address(
    code: str,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Delete a ship-to address by code."""
    normalized = (code or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="Code is required.")
    repo = CatalogShipToRepository(db)
    try:
        deleted = repo.delete_by_code(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Ship-to code {normalized} was not found.")
    logger.info("Ship-to code %s deleted by %s", normalized, current_user.get("email"))
    return {"message": "Ship-to address deleted", "code": normalized}
