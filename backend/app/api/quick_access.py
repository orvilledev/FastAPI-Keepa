"""Quick Access Links API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from uuid import UUID
from app.dependencies import get_current_user
from app.models.quick_access import QuickAccessLinkCreate, QuickAccessLinkUpdate, QuickAccessLinkResponse
from app.database import get_supabase
from app.utils.error_handler import handle_api_errors
from supabase import Client

router = APIRouter()


@router.get("/quick-access", response_model=List[QuickAccessLinkResponse])
@handle_api_errors("get quick access links")
async def get_quick_access_links(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all quick access links for the current user."""
    response = db.table("quick_access_links").select("*").eq("user_id", current_user["id"]).order("display_order", desc=False).order("created_at", desc=False).execute()
    return [QuickAccessLinkResponse(**link) for link in response.data]


@router.post("/quick-access", response_model=QuickAccessLinkResponse, status_code=201)
@handle_api_errors("create quick access link")
async def create_quick_access_link(
    link_data: QuickAccessLinkCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Create a new quick access link for the current user."""
    link_dict = link_data.model_dump()
    link_dict["user_id"] = current_user["id"]
    
    response = db.table("quick_access_links").insert(link_dict).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create quick access link")
    
    return QuickAccessLinkResponse(**response.data[0])


@router.put("/quick-access/{link_id}", response_model=QuickAccessLinkResponse)
@handle_api_errors("update quick access link")
async def update_quick_access_link(
    link_id: UUID,
    link_data: QuickAccessLinkUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Update a quick access link (user can only update their own links)."""
    # Check if link exists and belongs to user
    check_response = db.table("quick_access_links").select("*").eq("id", str(link_id)).eq("user_id", current_user["id"]).execute()
    
    if not check_response.data:
        raise HTTPException(status_code=404, detail="Quick access link not found")
    
    # Update link
    update_data = {k: v for k, v in link_data.model_dump().items() if v is not None}
    update_data["updated_at"] = "now()"
    
    response = db.table("quick_access_links").update(update_data).eq("id", str(link_id)).eq("user_id", current_user["id"]).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to update quick access link")
    
    return QuickAccessLinkResponse(**response.data[0])


@router.delete("/quick-access/{link_id}")
@handle_api_errors("delete quick access link")
async def delete_quick_access_link(
    link_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Delete a quick access link (user can only delete their own links)."""
    response = db.table("quick_access_links").delete().eq("id", str(link_id)).eq("user_id", current_user["id"]).execute()
    
    if not response.data:
        raise HTTPException(status_code=404, detail="Quick access link not found")
    
    return {"message": "Quick access link deleted successfully"}

