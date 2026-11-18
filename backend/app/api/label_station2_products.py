"""Label Station II product catalog API.

Scans resolve FNSKU → UPC through the Label Station catalog (warehouse_products),
then UPC → label fields through label_station2_products.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_catalog_manager_user, get_label_station_user
from app.middleware.rate_limiter import limiter, RateLimits
from app.models.label_station2_product import (
    LabelStation2ImportResult,
    LabelStation2ListResponse,
    LabelStation2LookupResponse,
    LabelStation2ProductResponse,
)
from app.repositories.label_station2_product_repository import (
    TABLE,
    LabelStation2NotFound,
    LabelStation2ProductRepository,
)
from app.repositories.warehouse_product_repository import normalize_upc_key
from app.services.label_station2_import import (
    dedupe_by_upc,
    parse_label_station2_spreadsheet,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_IMPORT_BYTES = 15 * 1024 * 1024
_ACCEPTED_SUFFIXES = (".csv", ".xlsx", ".xlsm")
_MISSING_TABLE_DETAIL = (
    "The Label Station II catalog table is missing. Run "
    "backend/database/migrations/create_label_station2_products.sql in the Supabase SQL Editor."
)


def _raise_if_missing_table(exc: Exception) -> None:
    message = str(exc).lower()
    if TABLE in message and (
        "does not exist" in message or "could not find" in message or "relation" in message
    ):
        raise HTTPException(status_code=503, detail=_MISSING_TABLE_DETAIL) from exc


@router.get("/label-station-2/products/lookup", response_model=LabelStation2LookupResponse)
@handle_api_errors("look up Label Station II product")
def lookup_label_station2_product(
    scan: str = Query(..., min_length=1, max_length=64),
    current_user: dict = Depends(get_label_station_user),
    db: Client = Depends(get_supabase),
):
    """Resolve a scanned FNSKU (or UPC / External ID) to Label Station II label fields."""
    repo = LabelStation2ProductRepository(db)
    try:
        row = repo.resolve_scan(scan)
    except LabelStation2NotFound as exc:
        raise HTTPException(status_code=404, detail=exc.message) from exc
    except Exception as exc:
        _raise_if_missing_table(exc)
        raise
    return LabelStation2LookupResponse(
        upc=row["upc"],
        external_id=row.get("external_id") or "",
        description=row.get("description") or "",
        vendor_name=row.get("vendor_name") or "",
        size=row.get("size") or "",
        color=row.get("color") or "",
        mpn=row.get("mpn") or "",
        fnsku=row.get("fnsku") or "",
    )


@router.get("/label-station-2/products/count")
@handle_api_errors("count Label Station II products")
def count_label_station2_products(
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_label_station_user),
    db: Client = Depends(get_supabase),
):
    repo = LabelStation2ProductRepository(db)
    try:
        return {"count": repo.count(search=search)}
    except Exception as exc:
        _raise_if_missing_table(exc)
        raise


@router.get("/label-station-2/products", response_model=LabelStation2ListResponse)
@handle_api_errors("list Label Station II products")
def list_label_station2_products(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_label_station_user),
    db: Client = Depends(get_supabase),
):
    repo = LabelStation2ProductRepository(db)
    try:
        items, total = repo.list_products(limit=limit, offset=offset, search=search)
    except Exception as exc:
        _raise_if_missing_table(exc)
        raise
    return LabelStation2ListResponse(
        items=[LabelStation2ProductResponse(**row) for row in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/label-station-2/products/import", response_model=LabelStation2ImportResult)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("import Label Station II products")
async def import_label_station2_products(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_catalog_manager_user),
    db: Client = Depends(get_supabase),
):
    """Import or upsert the Label Station II sheet (.xlsx / .csv). Rows upsert on UPC."""
    name = (file.filename or "").lower()
    if not name.endswith(_ACCEPTED_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail="Upload a .xlsx or .csv file using the Label Station II template.",
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_IMPORT_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 15 MB limit.")

    try:
        parsed, invalid = parse_label_station2_spreadsheet(file.filename or "upload.xlsx", raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    unique = dedupe_by_upc(parsed)
    if not unique:
        raise HTTPException(status_code=400, detail="No valid product rows found in file.")

    repo = LabelStation2ProductRepository(db)
    try:
        saved = repo.upsert_batch(unique)
    except ValueError as exc:
        _raise_if_missing_table(exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    fnskus = repo.fnsku_by_upcs([row["upc"] for row in unique])
    missing_fnsku = sum(1 for row in unique if not fnskus.get(row["upc"]))
    logger.info(
        "Label Station II import by %s: %s rows (%s invalid, %s without FNSKU)",
        current_user.get("email"),
        saved,
        invalid,
        missing_fnsku,
    )
    return LabelStation2ImportResult(
        imported=saved,
        invalid=invalid,
        total_in_file=len(parsed) + invalid,
        missing_fnsku=missing_fnsku,
    )


@router.delete("/label-station-2/products/{upc}")
@handle_api_errors("delete Label Station II product")
def delete_label_station2_product(
    upc: str,
    current_user: dict = Depends(get_catalog_manager_user),
    db: Client = Depends(get_supabase),
):
    key = normalize_upc_key(upc)
    if not key:
        raise HTTPException(status_code=400, detail="Invalid UPC")
    repo = LabelStation2ProductRepository(db)
    if not repo.delete_by_upc(key):
        raise HTTPException(status_code=404, detail="UPC not found")
    return {"message": f"Deleted product {key}"}
