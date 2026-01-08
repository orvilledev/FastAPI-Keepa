"""MAP (Minimum Advertised Price) management API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from decimal import Decimal
from app.dependencies import get_current_user, get_admin_user
from app.models.map import MAPResponse, MAPCreate, MAPUpdate
from app.database import get_supabase
from app.repositories.map_repository import MAPRepository
from app.utils.error_handler import handle_api_errors
from supabase import Client
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/map", response_model=dict, status_code=201)
@handle_api_errors("add MAP entries")
async def add_maps(
    maps: List[dict],
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """
    Add MAP entries to the database (admin only).
    
    Accepts a list of dicts with 'upc' and 'map_price' keys.
    Format: [{"upc": "123456789", "map_price": 29.99}, ...]
    Duplicates will be updated.
    """
    if not maps:
        raise HTTPException(status_code=400, detail="No MAP entries provided")
    
    # Validate entries
    valid_maps = []
    invalid_count = 0
    
    for map_entry in maps:
        if not isinstance(map_entry, dict):
            invalid_count += 1
            continue
        
        upc = map_entry.get('upc', '').strip() if map_entry.get('upc') else ''
        map_price = map_entry.get('map_price')
        
        if not upc:
            invalid_count += 1
            continue
        
        try:
            price = Decimal(str(map_price))
            if price < 0:
                invalid_count += 1
                continue
            valid_maps.append({"upc": upc, "map_price": price})
        except (ValueError, TypeError):
            invalid_count += 1
    
    if not valid_maps:
        raise HTTPException(status_code=400, detail="No valid MAP entries provided")
    
    # Insert MAP entries using repository
    map_repo = MAPRepository(db)
    result = map_repo.add_maps_bulk(valid_maps)
    
    logger.info(f"Added {result['added']} MAP entries, updated {result['updated']}, {result['invalid']} invalid")
    
    return {
        "message": "MAP entries processed successfully",
        "added": result["added"],
        "updated": result["updated"],
        "invalid": invalid_count + result["invalid"],
        "errors": result.get("errors")
    }


@router.get("/map", response_model=List[MAPResponse])
@handle_api_errors("list MAP entries")
async def list_maps(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
    limit: int = 100,
    offset: int = 0,
    search: str = None
):
    """List all MAP entries in the database (authenticated users).
    
    Args:
        search: Optional UPC search term (searches across all entries, not just current page)
    """
    map_repo = MAPRepository(db)
    maps = map_repo.list_maps(limit=limit, offset=offset, search_upc=search)
    return [MAPResponse(**map_entry) for map_entry in maps]


@router.get("/map/count", response_model=dict)
@handle_api_errors("get MAP count")
async def get_map_count(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
    search: str = None
):
    """Get total count of MAP entries in the database.
    
    Args:
        search: Optional UPC search term to count matching entries
    """
    map_repo = MAPRepository(db)
    if search:
        count = map_repo.search_maps_count(search_upc=search)
    else:
        count = map_repo.get_map_count()
    return {"count": count}


@router.get("/map/{upc}", response_model=MAPResponse)
@handle_api_errors("get MAP by UPC")
async def get_map_by_upc(
    upc: str,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get MAP entry by UPC."""
    map_repo = MAPRepository(db)
    map_entry = map_repo.get_map_by_upc(upc)
    return MAPResponse(**map_entry)


@router.delete("/map/{upc}", response_model=dict)
@handle_api_errors("delete MAP entry")
async def delete_map(
    upc: str,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Delete a MAP entry from the database (admin only)."""
    map_repo = MAPRepository(db)
    map_repo.delete_map(upc)
    return {"message": f"MAP entry for UPC {upc} deleted successfully"}


@router.delete("/map", response_model=dict)
@handle_api_errors("delete all MAP entries")
async def delete_all_maps(
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Delete all MAP entries from the database (admin only)."""
    map_repo = MAPRepository(db)
    map_repo.delete_all_maps()
    return {"message": "All MAP entries deleted successfully"}

