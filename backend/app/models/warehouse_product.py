"""Pydantic models for warehouse Scan & Print product catalog."""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class WarehouseProductResponse(BaseModel):
    id: UUID
    upc: str
    sku: str = ""
    fnsku: str
    style_name: str
    condition: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WarehouseProductLookupResponse(BaseModel):
    upc: str
    fnsku: str
    style_name: str
    condition: str


class WarehouseProductImportResult(BaseModel):
    imported: int
    updated: int
    skipped: int
    invalid: int
    total_in_file: int


class WarehouseProductListResponse(BaseModel):
    items: List[WarehouseProductResponse]
    total: int
    limit: int
    offset: int


class WarehouseProductUpsertItem(BaseModel):
    upc: str
    sku: str = ""
    fnsku: str
    style_name: str = ""
    condition: str = "New"
