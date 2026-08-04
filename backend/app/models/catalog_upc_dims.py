"""Pydantic models for catalog UPC / DIMS records."""
from datetime import datetime
from typing import Any, Dict, List
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CatalogImportResult(BaseModel):
    imported: int
    invalid: int
    total_in_file: int
    replaced: bool = True


class CatalogUpcRecordResponse(BaseModel):
    id: UUID
    upc_code: str
    scs: str = ""
    vendor_name: str = ""
    display_name: str = ""
    netsuite_style_name: str = ""
    status: str = ""
    row_data: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CatalogUpcListResponse(BaseModel):
    items: List[CatalogUpcRecordResponse]
    total: int
    limit: int
    offset: int
    columns: List[str]


class CatalogDimsRecordResponse(BaseModel):
    id: UUID
    upc_number: str
    sku: str = ""
    brand: str = ""
    description: str = ""
    current_season: str = ""
    item_status: str = ""
    row_data: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CatalogDimsListResponse(BaseModel):
    items: List[CatalogDimsRecordResponse]
    total: int
    limit: int
    offset: int
    columns: List[str]
