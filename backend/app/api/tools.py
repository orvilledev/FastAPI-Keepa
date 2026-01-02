"""Public Tools API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from uuid import UUID
from app.dependencies import get_current_user, get_admin_user
from app.models.public_tool import PublicToolCreate, PublicToolUpdate, PublicToolResponse
from app.models.user_tool import UserToolCreate, UserToolUpdate, UserToolResponse
from app.database import get_supabase
from app.utils.error_handler import handle_api_errors
from supabase import Client

router = APIRouter()


@router.get("/tools/public", response_model=List[PublicToolResponse])
@handle_api_errors("get public tools")
async def get_public_tools(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all public tools (any authenticated user can view)."""
    response = db.table("public_tools").select("*").order("created_at", desc=True).execute()
    return [PublicToolResponse(**tool) for tool in response.data]


@router.post("/tools/public", response_model=PublicToolResponse, status_code=201)
@handle_api_errors("create public tool")
async def create_public_tool(
    tool_data: PublicToolCreate,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Create a new public tool (admin only)."""
    tool_dict = tool_data.model_dump()
    tool_dict["created_by"] = current_user["id"]
    
    response = db.table("public_tools").insert(tool_dict).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create public tool")
    
    return PublicToolResponse(**response.data[0])


@router.put("/tools/public/{tool_id}", response_model=PublicToolResponse)
@handle_api_errors("update public tool")
async def update_public_tool(
    tool_id: UUID,
    tool_data: PublicToolUpdate,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Update a public tool (admin only)."""
    # Check if tool exists
    check_response = db.table("public_tools").select("*").eq("id", str(tool_id)).execute()
    
    if not check_response.data:
        raise HTTPException(status_code=404, detail="Public tool not found")
    
    # Update tool
    update_data = {k: v for k, v in tool_data.model_dump().items() if v is not None}
    update_data["updated_at"] = "now()"
    
    response = db.table("public_tools").update(update_data).eq("id", str(tool_id)).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to update public tool")
    
    return PublicToolResponse(**response.data[0])


@router.delete("/tools/public/{tool_id}")
@handle_api_errors("delete public tool")
async def delete_public_tool(
    tool_id: UUID,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Delete a public tool (admin only)."""
    # Check if tool exists
    check_response = db.table("public_tools").select("*").eq("id", str(tool_id)).execute()
    
    if not check_response.data:
        raise HTTPException(status_code=404, detail="Public tool not found")
    
    # Delete tool
    db.table("public_tools").delete().eq("id", str(tool_id)).execute()
    
    return {"message": "Public tool deleted successfully", "tool_id": str(tool_id)}


@router.post("/tools/public/{tool_id}/star")
@handle_api_errors("star tool")
async def star_tool(
    tool_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Add a tool to user's toolbox (star it)."""
    # Check if tool exists
    tool_response = db.table("public_tools").select("*").eq("id", str(tool_id)).execute()
    
    if not tool_response.data:
        raise HTTPException(status_code=404, detail="Public tool not found")
    
    # Check if already starred
    existing = db.table("user_toolbox").select("*").eq("user_id", current_user["id"]).eq("tool_id", str(tool_id)).execute()
    
    if existing.data:
        return {"message": "Tool already in your toolbox", "starred": True}
    
    # Add to toolbox
    db.table("user_toolbox").insert({
        "user_id": current_user["id"],
        "tool_id": str(tool_id)
    }).execute()
    
    return {"message": "Tool added to your toolbox", "starred": True}


@router.delete("/tools/public/{tool_id}/star")
@handle_api_errors("unstar tool")
async def unstar_tool(
    tool_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Remove a tool from user's toolbox (unstar it)."""
    # Remove from toolbox
    db.table("user_toolbox").delete().eq("user_id", current_user["id"]).eq("tool_id", str(tool_id)).execute()
    
    return {"message": "Tool removed from your toolbox", "starred": False}


@router.get("/tools/my-toolbox", response_model=List[PublicToolResponse])
@handle_api_errors("get my toolbox")
async def get_my_toolbox(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get user's starred tools (my toolbox)."""
    # Get user's starred tool IDs
    toolbox_response = db.table("user_toolbox").select("tool_id").eq("user_id", current_user["id"]).execute()
    
    if not toolbox_response.data:
        return []
    
    tool_ids = [item["tool_id"] for item in toolbox_response.data]
    
    # Get the actual tools
    tools_response = db.table("public_tools").select("*").in_("id", tool_ids).order("created_at", desc=True).execute()
    
    return [PublicToolResponse(**tool) for tool in tools_response.data]


@router.get("/tools/public/starred")
@handle_api_errors("get starred tool IDs")
async def get_starred_tool_ids(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all tool IDs that are starred by the current user."""
    response = db.table("user_toolbox").select("tool_id").eq("user_id", current_user["id"]).execute()
    starred_ids = [item["tool_id"] for item in response.data]
    return {"starred_ids": starred_ids}


# User Tools endpoints (personal tools)
@router.get("/tools/user", response_model=List[UserToolResponse])
@handle_api_errors("get user tools")
async def get_user_tools(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all personal tools for the current user."""
    response = db.table("user_tools").select("*").eq("user_id", current_user["id"]).order("created_at", desc=True).execute()
    
    # Ensure UUIDs are strings
    tools = []
    for tool in response.data:
        tool_data = tool.copy()
        for key in ['id', 'user_id']:
            if key in tool_data and not isinstance(tool_data[key], str):
                tool_data[key] = str(tool_data[key])
        tools.append(UserToolResponse(**tool_data))
    
    return tools


@router.post("/tools/user", response_model=UserToolResponse, status_code=201)
@handle_api_errors("create user tool")
async def create_user_tool(
    tool_data: UserToolCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Create a new personal tool for the current user."""
    tool_dict = tool_data.model_dump()
    tool_dict["user_id"] = current_user["id"]
    
    response = db.table("user_tools").insert(tool_dict).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create user tool")
    
    # Ensure UUIDs are strings
    tool_data_resp = response.data[0].copy()
    for key in ['id', 'user_id']:
        if key in tool_data_resp and not isinstance(tool_data_resp[key], str):
            tool_data_resp[key] = str(tool_data_resp[key])
    
    return UserToolResponse(**tool_data_resp)


@router.put("/tools/user/{tool_id}", response_model=UserToolResponse)
@handle_api_errors("update user tool")
async def update_user_tool(
    tool_id: UUID,
    tool_data: UserToolUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Update a personal tool (user can only update their own tools)."""
    # Check if tool exists and belongs to user
    check_response = db.table("user_tools").select("*").eq("id", str(tool_id)).eq("user_id", current_user["id"]).execute()
    
    if not check_response.data:
        raise HTTPException(status_code=404, detail="User tool not found")
    
    # Update tool
    update_data = {k: v for k, v in tool_data.model_dump().items() if v is not None}
    update_data["updated_at"] = "now()"
    
    response = db.table("user_tools").update(update_data).eq("id", str(tool_id)).eq("user_id", current_user["id"]).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to update user tool")
    
    # Ensure UUIDs are strings
    tool_data_resp = response.data[0].copy()
    for key in ['id', 'user_id']:
        if key in tool_data_resp and not isinstance(tool_data_resp[key], str):
            tool_data_resp[key] = str(tool_data_resp[key])
    
    return UserToolResponse(**tool_data_resp)


@router.delete("/tools/user/{tool_id}")
@handle_api_errors("delete user tool")
async def delete_user_tool(
    tool_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Delete a personal tool (user can only delete their own tools)."""
    response = db.table("user_tools").delete().eq("id", str(tool_id)).eq("user_id", current_user["id"]).execute()
    
    if not response.data:
        raise HTTPException(status_code=404, detail="User tool not found")
    
    return {"message": "User tool deleted successfully"}

