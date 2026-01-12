"""Pydantic models for notifications."""
from pydantic import BaseModel
from typing import Optional, Any
from uuid import UUID
from datetime import datetime


class NotificationCreate(BaseModel):
    """Model for creating a notification."""
    user_id: UUID
    type: str
    title: str
    message: str
    related_id: Optional[UUID] = None
    related_type: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class NotificationUpdate(BaseModel):
    """Model for updating a notification."""
    is_read: Optional[bool] = None


class NotificationResponse(BaseModel):
    """Model for notification response."""
    id: UUID
    user_id: UUID
    type: str
    title: str
    message: str
    related_id: Optional[UUID] = None
    related_type: Optional[str] = None
    is_read: bool
    read_at: Optional[datetime] = None
    metadata: Optional[dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True
