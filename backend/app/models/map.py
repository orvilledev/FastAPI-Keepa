"""Pydantic models for MAP (Minimum Advertised Price)."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID
from decimal import Decimal


class MAPCreate(BaseModel):
    """Model for creating MAP entry."""
    upc: str
    map_price: Decimal


class MAPUpdate(BaseModel):
    """Model for updating MAP entry."""
    map_price: Decimal


class MAPResponse(BaseModel):
    """Model for MAP response."""
    id: UUID
    upc: str
    map_price: Decimal
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

