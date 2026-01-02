"""Public Tool models."""
from pydantic import BaseModel, HttpUrl
from typing import Optional
from uuid import UUID
from datetime import datetime


class PublicToolCreate(BaseModel):
    """Model for creating a public tool."""
    name: str
    description: Optional[str] = None
    url: str
    category: Optional[str] = None
    icon: Optional[str] = None
    developer: Optional[str] = None


class PublicToolUpdate(BaseModel):
    """Model for updating a public tool."""
    name: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    category: Optional[str] = None
    icon: Optional[str] = None
    developer: Optional[str] = None


class PublicToolResponse(BaseModel):
    """Model for public tool response."""
    id: UUID
    name: str
    description: Optional[str] = None
    url: str
    category: Optional[str] = None
    icon: Optional[str] = None
    developer: Optional[str] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

