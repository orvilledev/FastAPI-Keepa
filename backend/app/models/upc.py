"""Pydantic models for UPCs."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID


class UPCCreate(BaseModel):
    """Model for creating UPC."""
    upc: str


class UPCResponse(BaseModel):
    """Model for UPC response."""
    id: UUID
    upc: str
    created_at: datetime

    class Config:
        from_attributes = True

