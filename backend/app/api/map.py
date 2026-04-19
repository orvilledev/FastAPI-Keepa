"""MAP (Minimum Advertised Price) management API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from decimal import Decimal
from app.dependencies import get_current_user, get_keepa_access_user
from app.models.map import DEFAULT_MAP_VENDOR_TYPE, MAPResponse
from app.database import get_supabase
from app.repositories.map_repository import MAPRepository, _validate_vendor_type
from app.utils.error_handler import handle_api_errors
from supabase import Client
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


def _parse_map_entry(map_entry: dict) -> Optional[dict]:
    """Validate one MAP dict from client; returns {upc, map_price, vendor_type} or None."""
    if not isinstance(map_entry, dict):
        return None
    upc = map_entry.get("upc", "").strip() if map_entry.get("upc") else ""
    map_price = map_entry.get("map_price")
    raw_vendor = map_entry.get("vendor_type")
    if raw_vendor is None or (isinstance(raw_vendor, str) and not raw_vendor.strip()):
        return None
    if not upc:
        return None
    try:
        price = Decimal(str(map_price))
        if price < 0:
            return None
        v = _validate_vendor_type(str(raw_vendor))
        return {"upc": upc, "map_price": price, "vendor_type": v}
    except HTTPException:
        return None
    except (ValueError, TypeError):
        return None


@router.post("/map/check-duplicates", response_model=dict)
@handle_api_errors("check MAP duplicates")
async def check_map_duplicates(
    maps: List[dict],
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """
    Check which MAP entries already exist (same UPC + vendor_type).

    Each item must include upc, map_price, and vendor_type (dnk or clk).
    """
    if not maps:
        raise HTTPException(status_code=400, detail="No MAP entries provided")

    valid_maps = []
    invalid_count = 0

    for map_entry in maps:
        parsed = _parse_map_entry(map_entry)
        if not parsed:
            invalid_count += 1
            continue
        valid_maps.append(parsed)

    if not valid_maps:
        raise HTTPException(
            status_code=400,
            detail="No valid MAP entries provided. Each entry needs upc, map_price, and vendor_type (dnk or clk).",
        )

    map_repo = MAPRepository(db)
    duplicate_descriptors = map_repo.check_duplicates(valid_maps)

    return {
        "duplicate_upcs": duplicate_descriptors,
        "duplicate_count": len(duplicate_descriptors),
        "total_entries": len(valid_maps),
        "invalid": invalid_count,
    }


@router.post("/map", response_model=dict, status_code=201)
@handle_api_errors("add MAP entries")
async def add_maps(
    maps: List[dict],
    replace_duplicates: bool = False,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """
    Add MAP entries. Each dict must have upc, map_price, and vendor_type (dnk or clk).
    """
    if not maps:
        raise HTTPException(status_code=400, detail="No MAP entries provided")

    valid_maps = []
    invalid_count = 0

    for map_entry in maps:
        parsed = _parse_map_entry(map_entry)
        if not parsed:
            invalid_count += 1
            continue
        valid_maps.append({"upc": parsed["upc"], "map_price": parsed["map_price"], "vendor_type": parsed["vendor_type"]})

    if not valid_maps:
        raise HTTPException(
            status_code=400,
            detail="No valid MAP entries provided. Each entry needs upc, map_price, and vendor_type (dnk or clk).",
        )

    map_repo = MAPRepository(db)
    result = map_repo.add_maps_bulk(valid_maps, replace_duplicates=replace_duplicates)

    total_rejected = result.get("rejected", 0)
    total_added = result.get("added", 0)

    if replace_duplicates:
        logger.info(f"Added/updated {total_added} MAP entries (with replacement), {result['invalid']} invalid")
        response = {
            "message": "MAP entries processed successfully",
            "added": total_added,
            "rejected": 0,
            "replaced": total_rejected if total_rejected > 0 else 0,
            "invalid": invalid_count + result["invalid"],
            "errors": result.get("errors"),
        }
    else:
        logger.info(f"Added {total_added} MAP entries, rejected {total_rejected} duplicates, {result['invalid']} invalid")
        response = {
            "message": "MAP entries processed successfully"
            if total_rejected == 0
            else f"MAP entries processed with {total_rejected} duplicate(s) rejected",
            "added": total_added,
            "rejected": total_rejected,
            "invalid": invalid_count + result["invalid"],
            "errors": result.get("errors"),
        }

        if result.get("duplicate_upcs"):
            response["duplicate_upcs"] = result["duplicate_upcs"]

    return response


@router.get("/map", response_model=List[MAPResponse])
@handle_api_errors("list MAP entries")
async def list_maps(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
    limit: int = 100,
    offset: int = 0,
    search: str = None,
    vendor_type: Optional[str] = Query(None, description="Filter by vendor: dnk or clk"),
):
    """List MAP entries with optional UPC search and vendor filter."""
    map_repo = MAPRepository(db)
    maps = map_repo.list_maps(limit=limit, offset=offset, search_upc=search, vendor_type=vendor_type)
    return [MAPResponse(**map_entry) for map_entry in maps]


@router.get("/map/count", response_model=dict)
@handle_api_errors("get MAP count")
async def get_map_count(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
    search: str = None,
    vendor_type: Optional[str] = Query(None, description="Count only this vendor"),
):
    """Get MAP count with optional UPC search and vendor filter."""
    map_repo = MAPRepository(db)
    if search or (vendor_type and vendor_type.strip()):
        count = map_repo.search_maps_count(search_upc=search, vendor_type=vendor_type)
    else:
        count = map_repo.get_map_count()
    return {"count": count}


@router.get("/map/{upc}", response_model=MAPResponse)
@handle_api_errors("get MAP by UPC")
async def get_map_by_upc(
    upc: str,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
    vendor_type: str = Query(DEFAULT_MAP_VENDOR_TYPE, description="Vendor: dnk or clk"),
):
    """Get MAP entry by UPC and vendor type."""
    map_repo = MAPRepository(db)
    map_entry = map_repo.get_map_by_upc(upc, vendor_type=vendor_type)
    return MAPResponse(**map_entry)


@router.delete("/map/{upc}", response_model=dict)
@handle_api_errors("delete MAP entry")
async def delete_map(
    upc: str,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
    vendor_type: str = Query(DEFAULT_MAP_VENDOR_TYPE, description="Vendor: dnk or clk"),
):
    """Delete a MAP entry for UPC + vendor."""
    map_repo = MAPRepository(db)
    map_repo.delete_map(upc, vendor_type=vendor_type)
    return {"message": f"MAP entry for UPC {upc} ({vendor_type}) deleted successfully"}


@router.delete("/map", response_model=dict)
@handle_api_errors("delete MAP entries")
async def delete_all_maps(
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
    vendor_type: Optional[str] = Query(
        None,
        description="If set, delete only this vendor's MAP rows. If omitted, delete all MAP rows.",
    ),
):
    """Delete all MAP entries, or only those for the given vendor."""
    map_repo = MAPRepository(db)
    map_repo.delete_all_maps(vendor_type=vendor_type)
    if vendor_type and vendor_type.strip():
        return {"message": f"All MAP entries for vendor {vendor_type.strip().lower()} deleted successfully"}
    return {"message": "All MAP entries deleted successfully"}
