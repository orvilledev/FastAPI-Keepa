"""Pydantic models for users."""
from pydantic import BaseModel
from typing import Optional
from uuid import UUID


class UserResponse(BaseModel):
    """Model for user response."""
    id: UUID
    email: Optional[str] = None
    user_metadata: Optional[dict] = None

    class Config:
        from_attributes = True


class ProfileUpdate(BaseModel):
    """Model for updating user profile."""
    full_name: Optional[str] = None
    email: Optional[str] = None
    company_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    country: Optional[str] = None


class ProfileResponse(BaseModel):
    """Model for profile response."""
    id: UUID
    email: Optional[str] = None
    role: Optional[str] = None
    full_name: Optional[str] = None
    company_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    country: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True
