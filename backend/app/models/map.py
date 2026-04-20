"""Pydantic models for MAP (Minimum Advertised Price)."""
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from uuid import UUID
from decimal import Decimal

# Default vendor when none is provided; any valid vendor code (see app.utils.vendor_code) may be stored.
DEFAULT_MAP_VENDOR_TYPE = "dnk"


class MAPCreate(BaseModel):
    """Model for creating MAP entry."""
    upc: str
    map_price: Decimal
    vendor_type: str = Field(default=DEFAULT_MAP_VENDOR_TYPE, min_length=1, max_length=32)


class MAPUpdate(BaseModel):
    """Model for updating MAP entry."""
    map_price: Decimal


class MAPResponse(BaseModel):
    """Model for MAP response."""
    id: UUID
    upc: str
    map_price: Decimal
    vendor_type: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MAPDeleteByUPCsBody(BaseModel):
    """Bulk delete: remove all MAP rows for each UPC (any vendor_type)."""
    upcs: List[str]


class MAPDeleteByUPCsResponse(BaseModel):
    deleted_rows: int
    upcs_requested: int
    upcs_not_found: List[str]

