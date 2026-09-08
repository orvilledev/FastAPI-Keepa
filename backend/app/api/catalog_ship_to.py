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
    CatalogShipToImportResult,
    CatalogShipToListResponse,
    CatalogShipToRecordResponse,
)
from app.repositories.catalog_ship_to_repository import CatalogShipToRepository
from app.services.catalog_ship_to_headers import HEADERS, TEMPLATE_FILENAME
from app.services.catalog_ship_to_import import parse_ship_to_spreadsheet, ship_to_row_to_record
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
            detail="Upload an .xlsx file matching the Ship To Address template.",
        )


async def _read_upload(file: UploadFile) -> bytes:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_IMPORT_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 25 MB limit.")
    return raw


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


@router.post("/catalog-ship-to/import", response_model=CatalogShipToImportResult)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("import ship-to addresses")
async def import_ship_to_addresses(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Replace the ship-to catalog with rows from the uploaded workbook."""
    _validate_xlsx(file)
    raw = await _read_upload(file)
    try:
        parsed, invalid = parse_ship_to_spreadsheet(file.filename or "upload.xlsx", raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not parsed:
        raise HTTPException(status_code=400, detail="No valid ship-to rows found in file.")

    records = [ship_to_row_to_record(row) for row in parsed]
    repo = CatalogShipToRepository(db)
    try:
        result = repo.replace_all(records)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Ship-to catalog import by %s: %s rows (%s invalid)",
        current_user.get("email"),
        result["imported"],
        invalid,
    )
    return CatalogShipToImportResult(
        imported=result["imported"],
        invalid=invalid,
        total_in_file=len(parsed) + invalid,
        replaced=True,
    )
