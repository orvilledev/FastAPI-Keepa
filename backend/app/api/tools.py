"""Public Tools API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from uuid import UUID
from app.dependencies import get_current_user, get_admin_user, get_keepa_access_user, get_tools_manager_user
from app.models.public_tool import PublicToolCreate, PublicToolUpdate, PublicToolResponse
from app.models.user_tool import UserToolCreate, UserToolUpdate, UserToolResponse
from app.models.job_aid import JobAidCreate, JobAidUpdate, JobAidResponse
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
    current_user: dict = Depends(get_tools_manager_user),
    db: Client = Depends(get_supabase)
):
    """Create a new public tool (tools management permission required)."""
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
    current_user: dict = Depends(get_tools_manager_user),
    db: Client = Depends(get_supabase)
):
    """Update a public tool (tools management permission required)."""
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
    current_user: dict = Depends(get_tools_manager_user),
    db: Client = Depends(get_supabase)
):
    """Delete a public tool (tools management permission required)."""
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
    existing = db.table("user_toolbox").select("*").eq("user_id", current_user["id"]).eq("tool_id", str(tool_id)).eq("tool_type", "public_tool").execute()
    
    if existing.data:
        return {"message": "Tool already in your toolbox", "starred": True}
    
    # Add to toolbox
    db.table("user_toolbox").insert({
        "user_id": current_user["id"],
        "tool_id": str(tool_id),
        "tool_type": "public_tool"
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
    db.table("user_toolbox").delete().eq("user_id", current_user["id"]).eq("tool_id", str(tool_id)).eq("tool_type", "public_tool").execute()
    
    return {"message": "Tool removed from your toolbox", "starred": False}


@router.get("/tools/my-toolbox")
@handle_api_errors("get my toolbox")
async def get_my_toolbox(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get user's starred tools and job aids (my toolbox)."""
    # Get user's starred tool IDs (both public tools and job aids)
    toolbox_response = db.table("user_toolbox").select("tool_id, tool_type").eq("user_id", current_user["id"]).execute()
    
    if not toolbox_response.data:
        return {"public_tools": [], "job_aids": []}
    
    # Separate public tools and job aids
    public_tool_ids = [item["tool_id"] for item in toolbox_response.data if item.get("tool_type") == "public_tool"]
    job_aid_ids = [item["tool_id"] for item in toolbox_response.data if item.get("tool_type") == "job_aid"]
    
    # Get the actual tools
    public_tools = []
    if public_tool_ids:
        tools_response = db.table("public_tools").select("*").in_("id", public_tool_ids).order("created_at", desc=True).execute()
        public_tools = [PublicToolResponse(**tool) for tool in tools_response.data]
    
    # Get the actual job aids
    job_aids = []
    if job_aid_ids:
        aids_response = db.table("job_aids").select("*").in_("id", job_aid_ids).order("created_at", desc=True).execute()
        job_aids = [JobAidResponse(**aid) for aid in aids_response.data]
    
    return {"public_tools": public_tools, "job_aids": job_aids}


@router.get("/tools/public/starred")
@handle_api_errors("get starred tool IDs")
async def get_starred_tool_ids(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all public tool IDs that are starred by the current user."""
    response = db.table("user_toolbox").select("tool_id").eq("user_id", current_user["id"]).eq("tool_type", "public_tool").execute()
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


# Job Aids endpoints
@router.get("/tools/job-aids", response_model=List[JobAidResponse])
@handle_api_errors("get job aids")
async def get_job_aids(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all job aids (any authenticated user can view)."""
    response = db.table("job_aids").select("*").order("created_at", desc=True).execute()
    return [JobAidResponse(**aid) for aid in response.data]


@router.post("/tools/job-aids", response_model=JobAidResponse, status_code=201)
@handle_api_errors("create job aid")
async def create_job_aid(
    aid_data: JobAidCreate,
    current_user: dict = Depends(get_tools_manager_user),
    db: Client = Depends(get_supabase)
):
    """Create a new job aid (tools management permission required)."""
    aid_dict = aid_data.model_dump()
    aid_dict["created_by"] = current_user["id"]
    
    response = db.table("job_aids").insert(aid_dict).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create job aid")
    
    return JobAidResponse(**response.data[0])


@router.put("/tools/job-aids/{aid_id}", response_model=JobAidResponse)
@handle_api_errors("update job aid")
async def update_job_aid(
    aid_id: UUID,
    aid_data: JobAidUpdate,
    current_user: dict = Depends(get_tools_manager_user),
    db: Client = Depends(get_supabase)
):
    """Update a job aid (tools management permission required)."""
    # Check if aid exists
    check_response = db.table("job_aids").select("*").eq("id", str(aid_id)).execute()
    
    if not check_response.data:
        raise HTTPException(status_code=404, detail="Job aid not found")
    
    # Update aid
    update_data = {k: v for k, v in aid_data.model_dump().items() if v is not None}
    update_data["updated_at"] = "now()"
    
    response = db.table("job_aids").update(update_data).eq("id", str(aid_id)).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to update job aid")
    
    return JobAidResponse(**response.data[0])


@router.delete("/tools/job-aids/{aid_id}")
@handle_api_errors("delete job aid")
async def delete_job_aid(
    aid_id: UUID,
    current_user: dict = Depends(get_tools_manager_user),
    db: Client = Depends(get_supabase)
):
    """Delete a job aid (tools management permission required)."""
    # Check if aid exists
    check_response = db.table("job_aids").select("*").eq("id", str(aid_id)).execute()
    
    if not check_response.data:
        raise HTTPException(status_code=404, detail="Job aid not found")
    
    # Delete aid
    db.table("job_aids").delete().eq("id", str(aid_id)).execute()
    
    return {"message": "Job aid deleted successfully", "aid_id": str(aid_id)}


@router.post("/tools/job-aids/{aid_id}/star")
@handle_api_errors("star job aid")
async def star_job_aid(
    aid_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Add a job aid to user's toolbox (star it)."""
    # Check if job aid exists
    aid_response = db.table("job_aids").select("*").eq("id", str(aid_id)).execute()
    
    if not aid_response.data:
        raise HTTPException(status_code=404, detail="Job aid not found")
    
    # Check if already starred
    existing = db.table("user_toolbox").select("*").eq("user_id", current_user["id"]).eq("tool_id", str(aid_id)).eq("tool_type", "job_aid").execute()
    
    if existing.data:
        return {"message": "Job aid already in your toolbox", "starred": True}
    
    # Add to toolbox
    db.table("user_toolbox").insert({
        "user_id": current_user["id"],
        "tool_id": str(aid_id),
        "tool_type": "job_aid"
    }).execute()
    
    return {"message": "Job aid added to your toolbox", "starred": True}


@router.delete("/tools/job-aids/{aid_id}/star")
@handle_api_errors("unstar job aid")
async def unstar_job_aid(
    aid_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Remove a job aid from user's toolbox (unstar it)."""
    # Remove from toolbox
    db.table("user_toolbox").delete().eq("user_id", current_user["id"]).eq("tool_id", str(aid_id)).eq("tool_type", "job_aid").execute()
    
    return {"message": "Job aid removed from your toolbox", "starred": False}


@router.get("/tools/job-aids/starred")
@handle_api_errors("get starred job aid IDs")
async def get_starred_job_aid_ids(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all job aid IDs that are starred by the current user."""
    response = db.table("user_toolbox").select("tool_id").eq("user_id", current_user["id"]).eq("tool_type", "job_aid").execute()
    starred_ids = [item["tool_id"] for item in response.data]
    return {"starred_ids": starred_ids}

