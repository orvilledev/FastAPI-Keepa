"""Authentication API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status, Body
from app.dependencies import get_current_user, get_superadmin_user, get_task_assigner_or_superadmin_user
from app.database import get_supabase
from app.models.user import ProfileUpdate, ProfileResponse
from app.utils.error_handler import handle_api_errors
from supabase import Client
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()


class DisplayNameUpdate(BaseModel):
    display_name: str


@router.get("/me")
async def get_current_user_info(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get current authenticated user information including role and Keepa access."""
    # Get user role, display_name, has_keepa_access, can_manage_tools, and can_assign_tasks from profiles table
    profile_response = db.table("profiles").select("role, display_name, has_keepa_access, can_manage_tools, can_assign_tasks").eq("id", current_user["id"]).execute()
    role = profile_response.data[0].get("role", "user") if profile_response.data else "user"
    display_name = None
    has_keepa_access = False
    can_manage_tools = False
    can_assign_tasks = False
    if profile_response.data and len(profile_response.data) > 0:
        display_name = profile_response.data[0].get("display_name")
        # If display_name is empty string, treat as None
        if display_name == "":
            display_name = None
        has_keepa_access = profile_response.data[0].get("has_keepa_access", False) or False
        can_manage_tools = profile_response.data[0].get("can_manage_tools", False) or False
        can_assign_tasks = profile_response.data[0].get("can_assign_tasks", False) or False
    
    return {
        "id": current_user.get("id"),
        "email": current_user.get("email"),
        "role": role,
        "display_name": display_name,
        "has_keepa_access": has_keepa_access,
        "can_manage_tools": can_manage_tools,
        "can_assign_tasks": can_assign_tasks,
        "user_metadata": current_user.get("user_metadata", {}),
    }


@router.get("/profile", response_model=ProfileResponse)
@handle_api_errors("get profile")
async def get_profile(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get current user's profile information. Creates profile if it doesn't exist."""
    response = db.table("profiles").select("*").eq("id", current_user["id"]).execute()
    
    if not response.data:
        # Profile doesn't exist, create a default one
        from datetime import datetime
        profile_data = {
            "id": current_user["id"],
            "email": current_user.get("email"),
            "role": "user",
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }
        create_response = db.table("profiles").insert(profile_data).execute()
        if not create_response.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create profile"
            )
        profile = create_response.data[0]
    else:
        profile = response.data[0]
    
    return ProfileResponse(**profile)


@router.put("/profile", response_model=ProfileResponse)
@handle_api_errors("update profile")
async def update_profile(
    profile_update: ProfileUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Update current user's profile information. Creates profile if it doesn't exist."""
    # Prepare update data (only include fields that are not None)
    update_data = profile_update.model_dump(exclude_unset=True)
    
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update"
        )
    
    # Add updated_at timestamp
    from datetime import datetime
    update_data["updated_at"] = datetime.utcnow().isoformat()
    
    # Check if profile exists
    existing_profile = db.table("profiles").select("id").eq("id", current_user["id"]).execute()
    
    if not existing_profile.data:
        # Profile doesn't exist, create it with the user's ID and email
        profile_data = {
            "id": current_user["id"],
            "email": current_user.get("email") or update_data.get("email"),
            **update_data
        }
        # Remove email from update_data if it's in there, since we're setting it above
        if "email" in update_data:
            profile_data["email"] = update_data["email"]
        
        response = db.table("profiles").insert(profile_data).execute()
    else:
        # Profile exists, update it
        response = db.table("profiles").update(update_data).eq("id", current_user["id"]).execute()
    
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save profile"
        )
    
    return ProfileResponse(**response.data[0])


@router.patch("/me/display-name")
@handle_api_errors("update display name")
async def update_display_name(
    display_name_data: DisplayNameUpdate = Body(...),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Update user's display name."""
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        display_name = display_name_data.display_name
        from datetime import datetime
        
        # Check if profile exists
        existing = db.table("profiles").select("id").eq("id", current_user["id"]).execute()
        
        if existing.data:
            # Update existing profile
            logger.info(f"Updating display_name for user {current_user['id']}")
            response = db.table("profiles").update({
                "display_name": display_name,
                "updated_at": datetime.utcnow().isoformat()
            }).eq("id", current_user["id"]).execute()
        else:
            # Create new profile
            logger.info(f"Creating profile with display_name for user {current_user['id']}")
            response = db.table("profiles").insert({
                "id": current_user["id"],
                "email": current_user.get("email"),
                "display_name": display_name,
                "role": "user",
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }).execute()
        
        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update display name"
            )
        
        logger.info(f"Successfully updated display_name for user {current_user['id']}")
        return {"display_name": display_name, "success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating display name: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error updating display name: {str(e)}"
        )


class UserKeepaAccessUpdate(BaseModel):
    """Model for updating user's Orbit Hub access."""
    user_id: str
    has_keepa_access: bool


@router.get("/users")
@handle_api_errors("get all users")
async def get_all_users(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all users (any authenticated user can view users for task assignment)."""
    try:
        response = db.table("profiles").select("id, email, role, display_name, has_keepa_access, can_manage_tools, can_assign_tasks, created_at").order("created_at", desc=True).execute()
        return {
            "users": response.data or []
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch users: {str(e)}"
        )


@router.put("/users/{user_id}/keepa-access")
@handle_api_errors("update user keepa access")
async def update_user_keepa_access(
    user_id: str,
    has_keepa_access: bool = Body(..., embed=True),
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase)
):
    """Update user's Orbit Hub access (superadmin only)."""
    try:
        from datetime import datetime
        
        # Update the user's has_keepa_access field
        response = db.table("profiles").update({
            "has_keepa_access": has_keepa_access,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", user_id).execute()
        
        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        return {
            "user_id": user_id,
            "has_keepa_access": has_keepa_access,
            "message": "Orbit Hub access updated successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update user access: {str(e)}"
        )


@router.put("/users/{user_id}/tools-access")
@handle_api_errors("update user tools access")
async def update_user_tools_access(
    user_id: str,
    can_manage_tools: bool = Body(..., embed=True),
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase)
):
    """Update user's Public Tools and Job Aids management access (superadmin only)."""
    try:
        from datetime import datetime
        
        # Update the user's can_manage_tools field
        response = db.table("profiles").update({
            "can_manage_tools": can_manage_tools,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", user_id).execute()
        
        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        return {
            "user_id": user_id,
            "can_manage_tools": can_manage_tools,
            "message": "Tools management access updated successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update user access: {str(e)}"
        )


@router.put("/users/{user_id}/tasks-access")
@handle_api_errors("update user tasks access")
async def update_user_tasks_access(
    user_id: str,
    can_assign_tasks: bool = Body(..., embed=True),
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase)
):
    """Update user's task assignment access (superadmin only)."""
    try:
        from datetime import datetime
        
        # Update the user's can_assign_tasks field
        response = db.table("profiles").update({
            "can_assign_tasks": can_assign_tasks,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("id", user_id).execute()
        
        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        return {
            "user_id": user_id,
            "can_assign_tasks": can_assign_tasks,
            "message": "Task assignment access updated successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update user access: {str(e)}"
        )

