"""Authentication API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from app.dependencies import get_current_user

router = APIRouter()


@router.get("/me")
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """Get current authenticated user information."""
    return {
        "id": current_user.get("id"),
        "email": current_user.get("email"),
        "user_metadata": current_user.get("user_metadata", {}),
    }

