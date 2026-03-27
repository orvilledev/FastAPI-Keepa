"""Seller names API endpoints for managing seller ID to name mappings."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from app.dependencies import get_current_user, get_admin_user
from app.database import get_supabase
from app.repositories.seller_name_repository import SellerNameRepository
from app.utils.error_handler import handle_api_errors
from supabase import Client
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


class SellerNameCreate(BaseModel):
    seller_id: str
    seller_name: str


class SellerNameUpdate(BaseModel):
    seller_name: str


class SellerNameBulkItem(BaseModel):
    seller_id: str
    seller_name: str


class SellerNameBulkRequest(BaseModel):
    sellers: List[SellerNameBulkItem]


@router.get("/sellers")
@handle_api_errors("list seller names")
async def list_seller_names(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """List all seller name mappings."""
    repo = SellerNameRepository(db)
    sellers = repo.get_all_seller_names()
    return {"sellers": sellers, "total": len(sellers)}


@router.post("/sellers", status_code=201)
@handle_api_errors("add seller name")
async def add_seller_name(
    data: SellerNameCreate,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Add a new seller name mapping (admin only)."""
    repo = SellerNameRepository(db)
    result = repo.add_seller_name(data.seller_id, data.seller_name)
    return {"message": "Seller name added", "seller": result}


@router.put("/sellers/{seller_id}")
@handle_api_errors("update seller name")
async def update_seller_name(
    seller_id: str,
    data: SellerNameUpdate,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Update a seller name mapping (admin only)."""
    repo = SellerNameRepository(db)
    result = repo.update_seller_name(seller_id, data.seller_name)
    return {"message": "Seller name updated", "seller": result}


@router.post("/sellers/bulk")
@handle_api_errors("bulk upsert seller names")
async def bulk_upsert_seller_names(
    data: SellerNameBulkRequest,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Bulk add/update seller name mappings (admin only)."""
    repo = SellerNameRepository(db)
    mappings = [{"seller_id": s.seller_id, "seller_name": s.seller_name} for s in data.sellers]
    count = repo.bulk_upsert(mappings)
    return {"message": f"Upserted {count} seller name mappings", "count": count}


@router.delete("/sellers/{seller_id}")
@handle_api_errors("delete seller name")
async def delete_seller_name(
    seller_id: str,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Delete a seller name mapping (admin only)."""
    repo = SellerNameRepository(db)
    repo.delete_seller_name(seller_id)
    return {"message": f"Seller name mapping for {seller_id} deleted"}
