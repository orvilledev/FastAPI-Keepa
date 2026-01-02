"""UPC management API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from app.dependencies import get_current_user, get_admin_user
from app.models.upc import UPCResponse
from app.database import get_supabase
from app.repositories.upc_repository import UPCRepository
from app.utils.error_handler import handle_api_errors
from supabase import Client
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/upcs", response_model=dict, status_code=201)
@handle_api_errors("add UPCs")
async def add_upcs(
    upcs: List[str],
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """
    Add UPCs to the database for daily scheduler processing (admin only).
    
    Accepts a list of UPC strings. Duplicates are automatically skipped.
    """
    if not upcs:
        raise HTTPException(status_code=400, detail="No UPCs provided")
    
    # Clean and validate UPCs
    valid_upcs = []
    invalid_upcs = []
    
    for upc in upcs:
        upc_clean = upc.strip()
        if upc_clean:
            # Basic validation (adjust as needed)
            if upc_clean.isdigit() and len(upc_clean) >= 8:
                valid_upcs.append(upc_clean)
            else:
                invalid_upcs.append(upc_clean)
    
    if not valid_upcs:
        raise HTTPException(status_code=400, detail="No valid UPCs provided")
    
    # Insert UPCs using repository
    upc_repo = UPCRepository(db)
    added_count = 0
    duplicate_count = 0
    errors = []
    
    for upc in valid_upcs:
        try:
            if upc_repo.add_upc(upc):
                added_count += 1
            else:
                duplicate_count += 1
        except Exception as e:
            errors.append(f"UPC {upc}: {str(e)}")
    
    logger.info(f"Added {added_count} UPCs, {duplicate_count} duplicates skipped")
    
    return {
        "message": "UPCs processed successfully",
        "added": added_count,
        "duplicates_skipped": duplicate_count,
        "invalid": len(invalid_upcs),
        "errors": errors if errors else None,
        "invalid_upcs": invalid_upcs if invalid_upcs else None
    }


@router.get("/upcs", response_model=List[UPCResponse])
@handle_api_errors("list UPCs")
async def list_upcs(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
    limit: int = 100,
    offset: int = 0
):
    """List all UPCs in the database (authenticated users)."""
    upc_repo = UPCRepository(db)
    upcs = upc_repo.list_upcs(limit=limit, offset=offset)
    return [UPCResponse(**upc) for upc in upcs]


@router.get("/upcs/count", response_model=dict)
@handle_api_errors("get UPC count")
async def get_upc_count(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get total count of UPCs in the database."""
    upc_repo = UPCRepository(db)
    count = upc_repo.get_upc_count()
    return {"count": count}


@router.delete("/upcs/{upc}", response_model=dict)
@handle_api_errors("delete UPC")
async def delete_upc(
    upc: str,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Delete a UPC from the database (admin only)."""
    upc_repo = UPCRepository(db)
    upc_repo.delete_upc(upc)
    return {"message": f"UPC {upc} deleted successfully"}


@router.delete("/upcs", response_model=dict)
@handle_api_errors("delete all UPCs")
async def delete_all_upcs(
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Delete all UPCs from the database (admin only)."""
    upc_repo = UPCRepository(db)
    upc_repo.delete_all_upcs()
    return {"message": "All UPCs deleted successfully"}

