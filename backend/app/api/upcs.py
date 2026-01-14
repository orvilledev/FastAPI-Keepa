"""UPC management API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from app.dependencies import get_current_user, get_admin_user
from app.models.upc import UPCResponse, UPCsCreateRequest
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
    request: UPCsCreateRequest,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """
    Add UPCs to the database for daily scheduler processing (admin only).

    Accepts a list of UPC strings and a category ('dnk' or 'clk').
    Duplicate UPCs (both within the request and in the database) are rejected with error messages.
    """
    upcs = request.upcs
    category = request.category

    if not upcs:
        raise HTTPException(status_code=400, detail="No UPCs provided")

    logger.info(f"Adding {len(upcs)} UPCs with category: {category}")
    
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
    
    # Check for duplicates within the same request
    seen_in_request = set()
    request_duplicates = []
    unique_valid_upcs = []
    
    for upc in valid_upcs:
        if upc in seen_in_request:
            request_duplicates.append(upc)
        else:
            seen_in_request.add(upc)
            unique_valid_upcs.append(upc)
    
    # Insert UPCs using repository
    upc_repo = UPCRepository(db)
    added_count = 0
    db_duplicate_count = 0
    errors = []
    duplicate_upcs = []
    
    # Add request duplicates to error list
    for upc in request_duplicates:
        duplicate_upcs.append(upc)
        errors.append(f"UPC {upc}: Duplicate entry in the same request")
    
    # Process unique UPCs from request
    for upc in unique_valid_upcs:
        try:
            upc_repo.add_upc(upc, category=category)
            added_count += 1
        except HTTPException as e:
            if "already exists" in str(e.detail).lower():
                db_duplicate_count += 1
                duplicate_upcs.append(upc)
                errors.append(f"UPC {upc}: Already exists in the database")
            else:
                errors.append(f"UPC {upc}: {str(e.detail)}")
        except Exception as e:
            errors.append(f"UPC {upc}: {str(e)}")

    total_duplicates = len(request_duplicates) + db_duplicate_count

    if total_duplicates > 0 or invalid_upcs:
        logger.warning(
            f"UPC processing completed with issues: {added_count} added, "
            f"{total_duplicates} duplicates ({len(request_duplicates)} in request, {db_duplicate_count} in database), "
            f"{len(invalid_upcs)} invalid"
        )
    else:
        logger.info(f"Successfully added {added_count} UPCs")
    
    # Build response with clear error messages
    response = {
        "message": "UPCs processed successfully" if total_duplicates == 0 else f"UPCs processed with {total_duplicates} duplicate(s) rejected",
        "added": added_count,
        "duplicates_rejected": total_duplicates,
        "invalid": len(invalid_upcs),
        "errors": errors if errors else None,
        "invalid_upcs": invalid_upcs if invalid_upcs else None
    }
    
    if duplicate_upcs:
        response["duplicate_upcs"] = duplicate_upcs
    
    # If there are duplicates, raise an error to make it clear
    if total_duplicates > 0:
        error_message = f"Duplicate UPC entries detected: {total_duplicates} duplicate(s) rejected. "
        if len(request_duplicates) > 0:
            error_message += f"{len(request_duplicates)} duplicate(s) found in the same request. "
        if db_duplicate_count > 0:
            error_message += f"{db_duplicate_count} duplicate(s) already exist in the database."
        response["error_message"] = error_message.strip()
    
    return response


@router.get("/upcs", response_model=List[UPCResponse])
@handle_api_errors("list UPCs")
async def list_upcs(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    category: Optional[str] = Query(None, description="Filter by category: 'dnk' or 'clk'")
):
    """List UPCs in the database, optionally filtered by category (authenticated users)."""
    if category and category not in ["dnk", "clk"]:
        raise HTTPException(status_code=400, detail="Category must be 'dnk' or 'clk'")
    
    try:
        upc_repo = UPCRepository(db)
        upcs = upc_repo.list_upcs(limit=limit, offset=offset, category=category)
        
        # Convert to response models, handling validation errors gracefully
        if not upcs:
            return []
        
        result = []
        for upc in upcs:
            try:
                result.append(UPCResponse(**upc))
            except Exception as e:
                logger.warning(f"Error converting UPC {upc.get('id', 'unknown')} to response model: {e}")
                logger.debug(f"UPC data: {upc}")
                # Skip invalid UPCs rather than failing the entire request
                continue
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing UPCs: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error processing UPC data: {str(e)}"
        )


@router.get("/upcs/count", response_model=dict)
@handle_api_errors("get UPC count")
async def get_upc_count(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
    category: Optional[str] = Query(None, description="Filter by category: 'dnk' or 'clk'")
):
    """Get total count of UPCs in the database, optionally filtered by category."""
    if category and category not in ["dnk", "clk"]:
        raise HTTPException(status_code=400, detail="Category must be 'dnk' or 'clk'")
    
    upc_repo = UPCRepository(db)
    count = upc_repo.get_upc_count(category=category)
    return {"count": count}


@router.delete("/upcs/{upc}", response_model=dict)
@handle_api_errors("delete UPC")
async def delete_upc(
    upc: str,
    category: Optional[str] = Query(None, description="Filter by category: 'dnk' or 'clk'"),
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Delete a UPC from the database, optionally filtered by category (admin only)."""
    if category and category not in ["dnk", "clk"]:
        raise HTTPException(status_code=400, detail="Category must be 'dnk' or 'clk'")
    
    upc_repo = UPCRepository(db)
    upc_repo.delete_upc(upc, category=category)
    return {"message": f"UPC {upc} deleted successfully"}


@router.delete("/upcs", response_model=dict)
@handle_api_errors("delete all UPCs")
async def delete_all_upcs(
    category: Optional[str] = Query(None, description="Filter by category: 'dnk' or 'clk'"),
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Delete all UPCs from the database, optionally filtered by category (admin only)."""
    if category and category not in ["dnk", "clk"]:
        raise HTTPException(status_code=400, detail="Category must be 'dnk' or 'clk'")
    
    upc_repo = UPCRepository(db)
    upc_repo.delete_all_upcs(category=category)
    category_msg = f" for category {category}" if category else ""
    return {"message": f"All UPCs{category_msg} deleted successfully"}

