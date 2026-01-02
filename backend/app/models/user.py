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

