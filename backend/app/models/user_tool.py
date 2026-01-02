"""Pydantic models for user tools."""
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class UserToolCreate(BaseModel):
    """Model for creating a user tool."""
    name: str
    description: Optional[str] = None
    url: str
    category: Optional[str] = None
    icon: Optional[str] = None
    developer: Optional[str] = None


class UserToolUpdate(BaseModel):
    """Model for updating a user tool."""
    name: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    category: Optional[str] = None
    icon: Optional[str] = None
    developer: Optional[str] = None


class UserToolResponse(BaseModel):
    """Model for user tool response."""
    id: UUID
    user_id: UUID
    name: str
    description: Optional[str] = None
    url: str
    category: Optional[str] = None
    icon: Optional[str] = None
    developer: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

