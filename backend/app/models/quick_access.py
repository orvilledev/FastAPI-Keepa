"""Pydantic models for quick access links."""
from pydantic import BaseModel, HttpUrl
from typing import Optional
from uuid import UUID
from datetime import datetime


class QuickAccessLinkCreate(BaseModel):
    """Model for creating a quick access link."""
    title: str
    url: str
    icon: Optional[str] = None
    display_order: Optional[int] = 0


class QuickAccessLinkUpdate(BaseModel):
    """Model for updating a quick access link."""
    title: Optional[str] = None
    url: Optional[str] = None
    icon: Optional[str] = None
    display_order: Optional[int] = None


class QuickAccessLinkResponse(BaseModel):
    """Model for quick access link response."""
    id: UUID
    user_id: UUID
    title: str
    url: str
    icon: Optional[str] = None
    display_order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

