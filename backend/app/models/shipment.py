"""Pydantic models for registered shipments and their FBA uploads."""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ShipmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=10_000)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("Shipment name is required.")
        return cleaned

    @field_validator("notes")
    @classmethod
    def strip_notes(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value.strip() or None


class ShipmentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=10_000)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Shipment name is required.")
        return cleaned

    @field_validator("notes")
    @classmethod
    def strip_notes(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value.strip()


class ShipmentUploadResponse(BaseModel):
    id: UUID
    shipment_id: UUID
    filename: str = ""
    amazon_shipment_id: str = ""
    amazon_shipment_name: str = ""
    ship_to: str = ""
    box_count: int = 0
    row_count: int = 0
    total_units: int = 0
    uploaded_by: UUID
    uploaded_by_email: str = ""
    uploaded_by_name: str = ""
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ShipmentResponse(BaseModel):
    id: UUID
    name: str
    notes: Optional[str] = None
    created_by: UUID
    created_by_email: str = ""
    created_by_name: str = ""
    created_at: datetime
    updated_at: datetime
    upload_count: int = 0
    contributor_count: int = 0
    row_count: int = 0
    unique_upc_count: int = 0
    can_delete: bool = False

    model_config = ConfigDict(from_attributes=True)


class ShipmentCompiledRow(BaseModel):
    sku: str = ""
    description: str = ""
    upc: str = ""
    fnsku: str = ""


class ShipmentDetailResponse(ShipmentResponse):
    uploads: List[ShipmentUploadResponse] = Field(default_factory=list)
    compiled_rows: List[ShipmentCompiledRow] = Field(default_factory=list)


class ShipmentUploadResult(BaseModel):
    upload: ShipmentUploadResponse
    rows_added: int
    duplicates_in_file: int
    duplicates_against_shipment: int
    unique_upc_count: int
