"""Authentication API endpoints."""
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, status, Body
from app.dependencies import (
    get_current_user,
    get_superadmin_user,
    ensure_mfa_exempt_profile_access,
    is_mfa_exempt_user,
    is_superadmin_user,
    is_warehouse_role,
    MFA_EXEMPT_STATION_GRANTS,
    security,
)
from app.database import get_supabase
from app.middleware.rate_limiter import limiter, RateLimits
from app.models.user import ProfileUpdate, ProfileResponse
from app.utils.error_handler import handle_api_errors
from app.utils.jwt_utils import get_jwt_aal
from supabase import Client
from pydantic import BaseModel
from typing import List, Optional
from app.maintenance import get_maintenance_state, set_maintenance_state
from fastapi.security import HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)

router = APIRouter()


def _lift_auth_ban(db: Client, user_id: str) -> None:
    """Remove a Supabase Auth ban so the user can sign in again."""
    from gotrue.errors import AuthApiError

    try:
        db.auth.admin.update_user_by_id(user_id, {"ban_duration": "none"})
    except AuthApiError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not restore login for this user: {getattr(e, 'message', str(e))}",
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not restore login for this user: {str(e)}",
        ) from e


def _default_profile_data(user_id: str, email: str | None) -> dict:
    """Build a new profiles row for a Supabase Auth user."""
    from datetime import datetime

    user_email = (email or "").lower()
    is_legacy_superadmin = user_email == "orvillebarba@gmail.com"
    now = datetime.utcnow().isoformat()
    return {
        "id": user_id,
        "email": email,
        "role": "superadmin" if is_legacy_superadmin else "user",
        "is_active": True if is_legacy_superadmin else False,
        "has_keepa_access": True if is_legacy_superadmin else False,
        "can_manage_tools": True if is_legacy_superadmin else False,
        "can_assign_tasks": True if is_legacy_superadmin else False,
        "created_at": now,
        "updated_at": now,
        **(
            MFA_EXEMPT_STATION_GRANTS
            if is_mfa_exempt_user({"email": email})
            else {}
        ),
    }


def _sync_missing_profiles_from_auth(db: Client) -> int:
    """Create profiles rows for Auth users created outside the app (e.g. Supabase dashboard)."""
    existing = db.table("profiles").select("id").execute()
    existing_ids = {row["id"] for row in (existing.data or [])}

    page = 1
    per_page = 200
    created = 0

    while True:
        try:
            auth_users = db.auth.admin.list_users(page=page, per_page=per_page)
        except Exception as exc:
            logger.warning("Profile sync: could not list auth users: %s", exc)
            break

        if not auth_users:
            break

        for auth_user in auth_users:
            user_id = auth_user.id
            if user_id in existing_ids:
                continue
            try:
                ins = db.table("profiles").insert(
                    _default_profile_data(user_id, auth_user.email)
                ).execute()
                if ins.data:
                    existing_ids.add(user_id)
                    created += 1
            except Exception as exc:
                logger.warning("Profile sync: failed to create profile for %s: %s", user_id, exc)

        if len(auth_users) < per_page:
            break
        page += 1

    if created:
        logger.info("Profile sync: created %s missing profile row(s) from auth.users", created)
    return created


def _ensure_profile_row(db: Client, current_user: dict) -> dict:
    """Return the profiles row for this user; insert a default row if missing (e.g. new signup)."""
    response = db.table("profiles").select("*").eq("id", current_user["id"]).execute()
    if response.data:
        return ensure_mfa_exempt_profile_access(db, current_user, response.data[0])

    profile_data = _default_profile_data(current_user["id"], current_user.get("email"))
    create_response = db.table("profiles").insert(profile_data).execute()
    if create_response.data:
        return create_response.data[0]

    # Concurrent signup: another request may have inserted first.
    retry = db.table("profiles").select("*").eq("id", current_user["id"]).execute()
    if retry.data:
        return ensure_mfa_exempt_profile_access(db, current_user, retry.data[0])

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to create profile",
    )


class DisplayNameUpdate(BaseModel):
    display_name: str


@router.get("/me")
def get_current_user_info(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get current authenticated user information including role and Keepa access."""
    # Ensure a profiles row exists so User Management and other profile-backed features see new signups.
    row = _ensure_profile_row(db, current_user)
    role = row.get("role", "user")
    display_name = row.get("display_name")
    if display_name == "":
        display_name = None
    can_manage_tools = row.get("can_manage_tools", False) or False
    can_assign_tasks = row.get("can_assign_tasks", False) or False

    is_superadmin = is_superadmin_user(current_user, db)
    mfa_exempt = is_mfa_exempt_user(current_user)
    has_keepa_access = bool(row.get("has_keepa_access", False))
    is_warehouse_only = is_warehouse_role(row)

    return {
        "id": current_user.get("id"),
        "email": current_user.get("email"),
        "role": role,
        "display_name": display_name,
        "has_keepa_access": has_keepa_access,
        "is_warehouse_only": is_warehouse_only,
        "has_label_station_access": has_keepa_access or is_warehouse_only or is_superadmin,
        "can_manage_tools": can_manage_tools,
        "can_assign_tasks": can_assign_tasks,
        "is_superadmin": is_superadmin,
        "mfa_enabled": bool(row.get("mfa_enabled", False)),
        "mfa_exempt": mfa_exempt,
        "user_metadata": current_user.get("user_metadata", {}),
    }


@router.post("/mfa/confirm-enrollment")
@limiter.limit(RateLimits.WRITE_OPERATIONS)
@handle_api_errors("confirm MFA enrollment")
def confirm_mfa_enrollment(
    request: Request,
    current_user: dict = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Client = Depends(get_supabase),
):
    """Mark MFA as enabled after the user verifies TOTP enrollment (requires AAL2 session)."""
    token_aal = get_jwt_aal(credentials.credentials)
    if token_aal != "aal2":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verify your authenticator code before completing enrollment.",
        )

    row = _ensure_profile_row(db, current_user)
    if row.get("mfa_enabled"):
        return {"message": "Two-factor authentication is already enabled.", "mfa_enabled": True}

    from datetime import datetime

    response = (
        db.table("profiles")
        .update({"mfa_enabled": True, "updated_at": datetime.utcnow().isoformat()})
        .eq("id", current_user["id"])
        .execute()
    )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record MFA enrollment",
        )

    return {"message": "Two-factor authentication enabled.", "mfa_enabled": True}


@router.get("/profile", response_model=ProfileResponse)
@handle_api_errors("get profile")
def get_profile(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get current user's profile information. Creates profile if it doesn't exist."""
    profile = _ensure_profile_row(db, current_user)
    return ProfileResponse(**profile)


@router.put("/profile", response_model=ProfileResponse)
@limiter.limit(RateLimits.WRITE_OPERATIONS)
@handle_api_errors("update profile")
def update_profile(
    request: Request,
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
@limiter.limit(RateLimits.WRITE_OPERATIONS)
@handle_api_errors("update display name")
def update_display_name(
    request: Request,
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
    """Model for updating user's MSW Overwatch access."""
    user_id: str
    has_keepa_access: bool


class MaintenanceUpdate(BaseModel):
    maintenance_mode: bool
    message: Optional[str] = None
    duration_hours: Optional[float] = None


class CreateUserRequest(BaseModel):
    email: str
    password: str
    has_keepa_access: bool = True
    is_active: bool = True


@router.get("/users")
@handle_api_errors("get all users")
def get_all_users(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all users (any authenticated user can view users for task assignment)."""
    try:
        _sync_missing_profiles_from_auth(db)

        response = (
            db.table("profiles")
            .select("id, email, role, display_name, has_keepa_access, can_manage_tools, can_assign_tasks, created_at, is_active")
            .order("created_at", desc=True)
            .execute()
        )
        return {
            "users": response.data or []
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch users: {str(e)}"
        )


@router.post("/users", status_code=status.HTTP_201_CREATED)
@limiter.limit(RateLimits.ADMIN_OPERATIONS)
@handle_api_errors("create user")
def create_user(
    request: Request,
    payload: CreateUserRequest,
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase),
):
    """Create a Supabase Auth user and profiles row (superadmin only)."""
    from gotrue.errors import AuthApiError

    email = payload.email.strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A valid email is required.")
    if len(payload.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters.",
        )

    email_lower = email.lower()
    try:
        page = 1
        while True:
            auth_users = db.auth.admin.list_users(page=page, per_page=200)
            if not auth_users:
                break
            for auth_user in auth_users:
                if (auth_user.email or "").lower() == email_lower:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="A user with this email already exists.",
                    )
            if len(auth_users) < 200:
                break
            page += 1
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Create user: could not check existing auth users: %s", exc)

    try:
        created = db.auth.admin.create_user(
            {
                "email": email,
                "password": payload.password,
                "email_confirm": True,
            }
        )
    except AuthApiError as exc:
        message = getattr(exc, "message", None) or str(exc)
        if "already" in message.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with this email already exists.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not create login for this user: {message}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not create login for this user: {exc}",
        ) from exc

    auth_user = getattr(created, "user", None) or created
    user_id = getattr(auth_user, "id", None) or auth_user.get("id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Auth user was created but no user id was returned.",
        )

    profile_data = _default_profile_data(user_id, email)
    profile_data["is_active"] = payload.is_active
    profile_data["has_keepa_access"] = payload.has_keepa_access

    existing = db.table("profiles").select("id").eq("id", user_id).execute()
    if existing.data:
        from datetime import datetime

        response = (
            db.table("profiles")
            .update(
                {
                    "email": email,
                    "is_active": payload.is_active,
                    "has_keepa_access": payload.has_keepa_access,
                    "updated_at": datetime.utcnow().isoformat(),
                }
            )
            .eq("id", user_id)
            .execute()
        )
    else:
        response = db.table("profiles").insert(profile_data).execute()

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login was created but profile could not be saved.",
        )

    row = response.data[0]
    logger.info("Superadmin %s created user %s", current_user.get("email"), email)
    return {
        "user_id": user_id,
        "email": email,
        "is_active": row.get("is_active", payload.is_active),
        "has_keepa_access": row.get("has_keepa_access", payload.has_keepa_access),
        "message": "User created successfully",
    }


@router.get("/maintenance")
@handle_api_errors("get maintenance mode")
def get_maintenance_mode(
    current_user: dict = Depends(get_superadmin_user),
):
    """Get runtime maintenance mode state (superadmin only)."""
    return get_maintenance_state()


@router.put("/maintenance")
@limiter.limit(RateLimits.ADMIN_OPERATIONS)
@handle_api_errors("update maintenance mode")
def update_maintenance_mode(
    request: Request,
    payload: MaintenanceUpdate,
    current_user: dict = Depends(get_superadmin_user),
):
    """Update runtime maintenance mode state (superadmin only)."""
    return set_maintenance_state(payload.maintenance_mode, payload.message, payload.duration_hours)


@router.put("/users/{user_id}/keepa-access")
@limiter.limit(RateLimits.ADMIN_OPERATIONS)
@handle_api_errors("update user keepa access")
def update_user_keepa_access(
    request: Request,
    user_id: str,
    has_keepa_access: bool = Body(..., embed=True),
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase)
):
    """Update user's MSW Overwatch access (superadmin only)."""
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
            "message": "MSW Overwatch access updated successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update user access: {str(e)}"
        )


@router.put("/users/{user_id}/tools-access")
@limiter.limit(RateLimits.ADMIN_OPERATIONS)
@handle_api_errors("update user tools access")
def update_user_tools_access(
    request: Request,
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


@router.post("/users/{user_id}/deactivate")
@limiter.limit(RateLimits.ADMIN_OPERATIONS)
@handle_api_errors("deactivate user")
def deactivate_user(
    request: Request,
    user_id: str,
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase),
):
    """Ban the user in Supabase Auth and mark their profile inactive (superadmin only)."""
    from datetime import datetime

    from gotrue.errors import AuthApiError

    if user_id == current_user.get("id"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account",
        )

    target = db.table("profiles").select("id, email").eq("id", user_id).execute()
    if not target.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    target_email = (target.data[0].get("email") or "").lower()
    if target_email == "orvillebarba@gmail.com":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account cannot be deactivated",
        )
    if is_mfa_exempt_user({"email": target_email}):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="MFA-exempt shared station accounts cannot be deactivated",
        )

    try:
        db.auth.admin.update_user_by_id(user_id, {"ban_duration": "876000h"})
    except AuthApiError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not deactivate login for this user: {getattr(e, 'message', str(e))}",
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not deactivate login for this user: {str(e)}",
        ) from e

    upd = db.table("profiles").update(
        {
            "is_active": False,
            "has_keepa_access": False,
            "can_manage_tools": False,
            "can_assign_tasks": False,
            "updated_at": datetime.utcnow().isoformat(),
        }
    ).eq("id", user_id).execute()

    if not upd.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login was disabled but profile could not be updated",
        )

    return {"user_id": user_id, "message": "User account has been deactivated"}


@router.post("/users/{user_id}/approve")
@limiter.limit(RateLimits.ADMIN_OPERATIONS)
@handle_api_errors("approve user")
def approve_user(
    request: Request,
    user_id: str,
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase),
):
    """Approve a pending or deactivated user (lifts Auth ban and activates profile)."""
    from datetime import datetime

    profile_response = db.table("profiles").select("id, email").eq("id", user_id).execute()
    if not profile_response.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    _lift_auth_ban(db, user_id)

    profile_row = profile_response.data[0]
    updates: dict[str, object] = {
        "is_active": True,
        "updated_at": datetime.utcnow().isoformat(),
    }
    if is_mfa_exempt_user({"email": profile_row.get("email")}):
        updates.update(MFA_EXEMPT_STATION_GRANTS)

    response = db.table("profiles").update(updates).eq("id", user_id).execute()
    if not response.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return {"user_id": user_id, "message": "User approved successfully"}


@router.put("/users/{user_id}/tasks-access")
@limiter.limit(RateLimits.ADMIN_OPERATIONS)
@handle_api_errors("update user tasks access")
def update_user_tasks_access(
    request: Request,
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

