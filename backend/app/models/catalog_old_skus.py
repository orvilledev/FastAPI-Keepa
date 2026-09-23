"""Pydantic models for the Old SKUs catalog."""
from datetime import datetime
from typing import Any, Dict, List
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CatalogOldSkusImportResult(BaseModel):
    imported: int
    invalid: int
    total_in_file: int
    replaced: bool = True


class CatalogOldSkusRecordResponse(BaseModel):
    id: UUID
    old_sku: str
    vendor_name: str = ""
    upc_code: str = ""
    row_data: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CatalogOldSkusListResponse(BaseModel):
    items: List[CatalogOldSkusRecordResponse]
    total: int
    limit: int
    offset: int
    columns: List[str]
