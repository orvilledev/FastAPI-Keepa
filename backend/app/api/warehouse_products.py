"""Warehouse Scan & Print product catalog API."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_label_station_user
from app.middleware.rate_limiter import limiter, RateLimits
from app.models.warehouse_product import (
    WarehouseProductImportResult,
    WarehouseProductListResponse,
    WarehouseProductLookupResponse,
    WarehouseProductResponse,
)
from app.repositories.warehouse_product_repository import (
    WarehouseProductRepository,
    normalize_upc_key,
)
from app.services.warehouse_product_import import (
    dedupe_by_upc,
    parse_products_spreadsheet,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_IMPORT_BYTES = 15 * 1024 * 1024
_ACCEPTED_SUFFIXES = (".csv", ".xlsx", ".xlsm", ".xls")


def _validate_import_file(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not any(name.endswith(suffix) for suffix in _ACCEPTED_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail="Upload a .csv or .xlsx file with UPC, SKU, fnsku, STYLE NAME, and Condition columns.",
        )


@router.get("/warehouse-products/lookup", response_model=WarehouseProductLookupResponse)
@handle_api_errors("lookup warehouse product")
def lookup_warehouse_product(
    upc: str = Query(..., min_length=1, max_length=64),
    current_user: dict = Depends(get_label_station_user),
    db: Client = Depends(get_supabase),
):
    """Resolve a scanned UPC to FNSKU and label fields (PRODUCTS catalog)."""
    repo = WarehouseProductRepository(db)
    row = repo.lookup(upc)
    if not row:
        raise HTTPException(status_code=404, detail="UPC not found")
    return WarehouseProductLookupResponse(
        upc=row["upc"],
        sku=row.get("sku") or "",
        fnsku=row["fnsku"],
        style_name=row.get("style_name") or "",
        condition=row.get("condition") or "New",
    )


@router.get("/warehouse-products/count")
@handle_api_errors("count warehouse products")
def count_warehouse_products(
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_label_station_user),
    db: Client = Depends(get_supabase),
):
    repo = WarehouseProductRepository(db)
    return {"count": repo.count(search=search)}


@router.get("/warehouse-products", response_model=WarehouseProductListResponse)
@handle_api_errors("list warehouse products")
def list_warehouse_products(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_label_station_user),
    db: Client = Depends(get_supabase),
):
    repo = WarehouseProductRepository(db)
    items, total = repo.list_products(limit=limit, offset=offset, search=search)
    return WarehouseProductListResponse(
        items=[WarehouseProductResponse(**row) for row in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/warehouse-products/import", response_model=WarehouseProductImportResult)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("import warehouse products")
async def import_warehouse_products(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_label_station_user),
    db: Client = Depends(get_supabase),
):
    """Import or upsert rows from a PRODUCTS sheet (.xlsx / .csv)."""
    _validate_import_file(file)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_IMPORT_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 15 MB limit.")

    try:
        parsed, invalid = parse_products_spreadsheet(file.filename or "upload.csv", raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    unique = dedupe_by_upc(parsed)
    if not unique:
        raise HTTPException(status_code=400, detail="No valid product rows found in file.")

    repo = WarehouseProductRepository(db)
    result = repo.upsert_batch(unique)
    logger.info(
        "Warehouse products import by %s: %s rows (%s invalid)",
        current_user.get("email"),
        len(unique),
        invalid,
    )
    return WarehouseProductImportResult(
        imported=result["imported"],
        updated=0,
        skipped=0,
        invalid=invalid,
        total_in_file=len(parsed) + invalid,
    )


@router.delete("/warehouse-products/{upc}")
@handle_api_errors("delete warehouse product")
def delete_warehouse_product(
    upc: str,
    current_user: dict = Depends(get_label_station_user),
    db: Client = Depends(get_supabase),
):
    repo = WarehouseProductRepository(db)
    key = normalize_upc_key(upc)
    if not key:
        raise HTTPException(status_code=400, detail="Invalid UPC")
    if not repo.delete_by_upc(key):
        raise HTTPException(status_code=404, detail="UPC not found")
    return {"message": f"Deleted product {key}"}
