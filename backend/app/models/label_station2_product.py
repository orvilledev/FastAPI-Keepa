"""Pydantic models for the Label Station II product catalog."""
from datetime import datetime
from typing import List
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class LabelStation2ProductResponse(BaseModel):
    id: UUID
    upc: str
    external_id: str = ""
    description: str = ""
    vendor_name: str = ""
    size: str = ""
    color: str = ""
    mpn: str = ""
    # Looked up from the Label Station (warehouse_products) catalog by UPC.
    fnsku: str = ""
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LabelStation2LookupResponse(BaseModel):
    upc: str
    external_id: str = ""
    description: str = ""
    vendor_name: str = ""
    size: str = ""
    color: str = ""
    mpn: str = ""
    fnsku: str = ""


class LabelStation2ImportResult(BaseModel):
    imported: int
    invalid: int
    total_in_file: int
    # Imported UPCs that have no FNSKU in the Label Station catalog yet.
    missing_fnsku: int


class LabelStation2ListResponse(BaseModel):
    items: List[LabelStation2ProductResponse]
    total: int
    limit: int
    offset: int
