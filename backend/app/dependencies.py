"""FastAPI dependencies."""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import Client
from app.database import get_supabase
from app.config import settings
import httpx
import logging

logger = logging.getLogger(__name__)

security = HTTPBearer()


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

