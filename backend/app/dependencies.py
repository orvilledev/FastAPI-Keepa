"""FastAPI dependencies."""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import Client
from app.database import get_supabase
from app.config import settings
from uuid import UUID
import httpx
import logging

logger = logging.getLogger(__name__)

security = HTTPBearer()


def _ensure_profile_row_for_access(db: Client, user_data: dict) -> dict:
    """Ensure a profile exists for access checks; new signups default to inactive pending approval."""
    from datetime import datetime

    user_id = user_data.get("id")
    user_email = (user_data.get("email") or "").lower()
    response = db.table("profiles").select("*").eq("id", user_id).execute()
    if response.data:
        return response.data[0]

    is_legacy_superadmin = user_email == "orvillebarba@gmail.com"
    profile_data = {
        "id": user_id,
        "email": user_data.get("email"),
        "role": "superadmin" if is_legacy_superadmin else "user",
        "is_active": True if is_legacy_superadmin else False,
        "has_keepa_access": True if is_legacy_superadmin else False,
        "can_manage_tools": True if is_legacy_superadmin else False,
        "can_assign_tasks": True if is_legacy_superadmin else False,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    created = db.table("profiles").insert(profile_data).execute()
    if created.data:
        return created.data[0]

    retry = db.table("profiles").select("*").eq("id", user_id).execute()
    if retry.data:
        return retry.data[0]
    return profile_data


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Client = Depends(get_supabase)
) -> dict:
    """Verify JWT token and return current user."""
    token = credentials.credentials
    
    try:
        # Verify token with Supabase by making HTTP request to auth endpoint
        auth_url = f"{settings.supabase_url}/auth/v1/user"
        headers = {
            "Authorization": f"Bearer {token}",
            "apikey": settings.supabase_key,
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.get(auth_url, headers=headers, timeout=10.0)
            
            if response.status_code != 200:
                logger.warning(f"Supabase auth returned status {response.status_code}: {response.text}")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication credentials",
                )
            
            user_data = response.json()
            if not user_data or "id" not in user_data:
                logger.warning("Invalid user data from Supabase auth")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication credentials",
                )
            
            profile = _ensure_profile_row_for_access(db, user_data)
            is_active = profile.get("is_active", False)
            user_email = (user_data.get("email") or "").lower()
            role = (profile.get("role") or "").lower()
            is_superadmin = user_email == "orvillebarba@gmail.com" or role == "superadmin"
            if not is_active and not is_superadmin:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Your account is pending superadmin approval.",
                )
            return user_data
    except HTTPException:
        raise
    except httpx.TimeoutException:
        logger.error("Timeout connecting to Supabase auth")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service unavailable",
        )
    except Exception as e:
        # Log the actual error for debugging
        logger.error(f"Authentication error: {type(e).__name__}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )


async def get_admin_user(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
) -> dict:
    """Verify user is admin."""
    # Check user role in profiles table
    profile_response = db.table("profiles").select("role").eq("id", current_user["id"]).execute()
    
    if not profile_response.data or profile_response.data[0].get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )
    
    return current_user


def is_superadmin_user(current_user: dict, db: Client) -> bool:
    """True if this user may perform superadmin-only actions (legacy email or profiles.role)."""
    user_email = (current_user.get("email") or "").lower()
    if user_email == "orvillebarba@gmail.com":
        return True
    profile_response = db.table("profiles").select("role").eq("id", current_user["id"]).execute()
    if profile_response.data and profile_response.data[0].get("role") == "superadmin":
        return True
    return False


async def get_superadmin_user(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
) -> dict:
    """Verify user is superadmin (legacy email or profiles.role = superadmin)."""
    if not is_superadmin_user(current_user, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superadmin can perform this action"
        )

    return current_user


async def get_keepa_access_user(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
) -> dict:
    """Verify user has MSW Overwatch access (has_keepa_access = true)."""
    # Check user's Keepa access in profiles table
    profile_response = db.table("profiles").select("has_keepa_access, role").eq("id", current_user["id"]).execute()
    
    if not profile_response.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    profile = profile_response.data[0]
    has_keepa_access = profile.get("has_keepa_access", False)
    is_admin = profile.get("role") == "admin"
    
    # Allow if user has Keepa access OR is admin
    if not has_keepa_access and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="MSW Overwatch access required"
        )
    
    return current_user


async def get_tools_manager_user(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
) -> dict:
    """Verify user can manage Public Tools and Job Aids (can_manage_tools = true or admin)."""
    # Check user's tools management permission in profiles table
    profile_response = db.table("profiles").select("can_manage_tools, role").eq("id", current_user["id"]).execute()
    
    if not profile_response.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    profile = profile_response.data[0]
    can_manage_tools = profile.get("can_manage_tools", False)
    is_admin = profile.get("role") == "admin"
    
    # Allow if user has can_manage_tools permission OR is admin
    if not can_manage_tools and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission to manage tools required"
        )
    
    return current_user


async def get_job_runner_user(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
) -> dict:
    """Verify user can run Express jobs (can_run_jobs = true, has_keepa_access = true, or admin)."""
    profile_response = db.table("profiles").select("can_run_jobs, has_keepa_access, role").eq("id", current_user["id"]).execute()
    
    if not profile_response.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    profile = profile_response.data[0]
    can_run_jobs = profile.get("can_run_jobs", False)
    has_keepa_access = profile.get("has_keepa_access", False)
    is_admin = profile.get("role") == "admin"
    
    if not can_run_jobs and not has_keepa_access and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Express job access required. Contact an admin to enable this permission."
        )
    
    return current_user


async def check_is_admin(
    current_user: dict,
    db: Client
) -> bool:
    """
    Check if current user is admin.
    
    Args:
        current_user: Current user dict
        db: Supabase client
        
    Returns:
        True if user is admin, False otherwise
    """
    profile_response = db.table("profiles").select("role").eq("id", current_user["id"]).execute()
    return profile_response.data and profile_response.data[0].get("role") == "admin"


async def verify_job_access(
    job_id: UUID,
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase)
) -> dict:
    """
    Verify user has access to job and return job data.
    
    Args:
        job_id: UUID of the job
        current_user: Current authenticated user
        db: Supabase client
        
    Returns:
        Job data dictionary
        
    Raises:
        HTTPException: 404 if job not found, 403 if user doesn't have access
    """
    job_response = db.table("batch_jobs").select("*").eq("id", str(job_id)).execute()
    
    if not job_response.data:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = job_response.data[0]
    
    return job


async def verify_batch_access(
    batch_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
) -> dict:
    """
    Verify user has access to batch and return batch data.
    
    Args:
        batch_id: UUID of the batch
        current_user: Current authenticated user
        db: Supabase client
        
    Returns:
        Batch data dictionary
        
    Raises:
        HTTPException: 404 if batch not found, 403 if user doesn't have access
    """
    batch_response = db.table("upc_batches").select("*").eq("id", str(batch_id)).execute()
    
    if not batch_response.data:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    batch = batch_response.data[0]
    
    # Check permissions - verify user has access to the parent job
    job_response = db.table("batch_jobs").select("created_by").eq(
        "id", batch["batch_job_id"]
    ).execute()
    
    if not job_response.data:
        raise HTTPException(status_code=404, detail="Parent job not found")
    
    job = job_response.data[0]
    
    is_admin = await check_is_admin(current_user, db)
    
    if not is_admin and job["created_by"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized to view this batch")
    
    return batch

