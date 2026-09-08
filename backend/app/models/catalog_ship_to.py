"""Pydantic models for the Ship To Address catalog."""
from datetime import datetime
from typing import Any, Dict, List
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CatalogShipToImportResult(BaseModel):
    imported: int
    invalid: int
    total_in_file: int
    replaced: bool = True


class CatalogShipToRecordResponse(BaseModel):
    id: UUID
    code: str
    full_address: str = ""
    address_1: str = ""
    city: str = ""
    state: str = ""
    postal_code: str = ""
    row_data: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CatalogShipToListResponse(BaseModel):
    items: List[CatalogShipToRecordResponse]
    total: int
    limit: int
    offset: int
    columns: List[str]
