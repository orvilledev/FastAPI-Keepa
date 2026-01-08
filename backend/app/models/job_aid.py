"""Job Aid models."""
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class JobAidCreate(BaseModel):
    """Model for creating a job aid."""
    name: str
    description: Optional[str] = None
    url: str
    video_url: Optional[str] = None
    category: Optional[str] = None
    icon: Optional[str] = None
    developer: Optional[str] = None


class JobAidUpdate(BaseModel):
    """Model for updating a job aid."""
    name: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    video_url: Optional[str] = None
    category: Optional[str] = None
    icon: Optional[str] = None
    developer: Optional[str] = None


class JobAidResponse(BaseModel):
    """Model for job aid response."""
    id: UUID
    name: str
    description: Optional[str] = None
    url: str
    video_url: Optional[str] = None
    category: Optional[str] = None
    icon: Optional[str] = None
    developer: Optional[str] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

