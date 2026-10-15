"""Pydantic models for the FBA Shipment Library."""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from app.services.fba_shipment_library import strip_upc_label


class FbaShipmentUploadResponse(BaseModel):
    id: UUID
    shipment_id: str
    source_filename: str = ""
    line_count: int = 0
    total_shipped: int = 0
    created_by: Optional[UUID] = None
    created_by_email: str = ""
    created_by_name: str = ""
    created_at: datetime
    owned_by_me: bool = False

    model_config = ConfigDict(from_attributes=True)


class FbaShipmentLineResponse(BaseModel):
    id: UUID
    line_number: int
    merchant_sku: str
    external_id: str = ""
    shipped: int = 0

    model_config = ConfigDict(from_attributes=True)

    @field_validator("external_id", mode="before")
    @classmethod
    def _drop_upc_label(cls, value: object) -> str:
        return strip_upc_label("" if value is None else str(value))


class FbaShipmentUploadListResponse(BaseModel):
    items: List[FbaShipmentUploadResponse]
    total: int
    limit: int
    offset: int


class FbaShipmentDetailResponse(BaseModel):
    upload: FbaShipmentUploadResponse
    lines: List[FbaShipmentLineResponse]
    total: int
    limit: int
    offset: int


class FbaShipmentImportResult(BaseModel):
    upload: FbaShipmentUploadResponse
