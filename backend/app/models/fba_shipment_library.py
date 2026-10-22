"""Pydantic models for FBA Order Checker."""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.fba_shipment_library import (
    MAX_BOX_NUMBER,
    STATUS_NOT_IN_LIST,
    count_progress,
    strip_upc_label,
)


class FbaShipmentUploadResponse(BaseModel):
    id: UUID
    shipment_id: str
    shipment_name: str = ""
    source_filename: str = ""
    line_count: int = 0
    total_shipped: int = 0
    created_by: Optional[UUID] = None
    created_by_email: str = ""
    created_by_name: str = ""
    created_at: datetime
    owned_by_me: bool = False
    is_locked: bool = False
    shared_with: List[UUID] = Field(default_factory=list)
    shared_with_everyone: bool = True
    archived_at: Optional[datetime] = None
    trashed_at: Optional[datetime] = None
    fully_accounted: bool = False

    model_config = ConfigDict(from_attributes=True)


class FbaShipmentLineResponse(BaseModel):
    id: UUID
    line_number: int
    merchant_sku: str
    external_id: str = ""
    shipped: int = 0
    counted: int = 0
    box_counted: Optional[int] = None
    missing: int = 0
    status: str = "Missing Items"
    not_in_list: bool = False

    model_config = ConfigDict(from_attributes=True)

    @field_validator("external_id", mode="before")
    @classmethod
    def _drop_upc_label(cls, value: object) -> str:
        return strip_upc_label("" if value is None else str(value))

    @model_validator(mode="after")
    def _fill_count_progress(self) -> "FbaShipmentLineResponse":
        if self.not_in_list:
            self.missing = 0
            self.status = STATUS_NOT_IN_LIST
            return self
        self.missing, self.status = count_progress(self.shipped, self.counted)
        return self


class FbaShipmentUploadListResponse(BaseModel):
    items: List[FbaShipmentUploadResponse]
    total: int
    limit: int
    offset: int


class FbaShipmentDetailResponse(BaseModel):
    upload: FbaShipmentUploadResponse
    lines: List[FbaShipmentLineResponse]
    unknown_lines: List[FbaShipmentLineResponse] = []
    total: int
    limit: int
    offset: int
    box_units: Optional[int] = None


class FbaShipmentImportResult(BaseModel):
    upload: FbaShipmentUploadResponse


class FbaShipmentScanRequest(BaseModel):
    barcode: str
    box_number: Optional[int] = Field(default=None, ge=1, le=MAX_BOX_NUMBER)


class FbaShipmentScanResult(BaseModel):
    line: FbaShipmentLineResponse
    barcode: str
    box_number: Optional[int] = None
    box_counted: int = 0
    fully_accounted: bool = False


class FbaShareUser(BaseModel):
    id: UUID
    name: str
    email: str = ""


class FbaShipmentAccessRequest(BaseModel):
    locked: bool = False
    everyone: Optional[bool] = None
    user_ids: List[UUID] = Field(default_factory=list)


class FbaShipmentNameRequest(BaseModel):
    shipment_name: str = Field(default="", max_length=200)


class FbaFnskuLabelItem(BaseModel):
    external_id: str
    quantity: int
    upc: str
    sku: str = ""
    fnsku: str
    style_name: str = ""
    condition: str = "New"


class FbaFnskuLabelBox(BaseModel):
    box_number: int
    items: List[FbaFnskuLabelItem]


class FbaFnskuLabelsResponse(BaseModel):
    boxes: List[FbaFnskuLabelBox]
    label_count: int


class FbaBoxNumberRequest(BaseModel):
    box_number: int = Field(ge=1, le=MAX_BOX_NUMBER)


class FbaShipmentUnit(BaseModel):
    unit_number: int
    scan_id: Optional[str] = None
    box_number: Optional[int] = None


class FbaShipmentUnitsResponse(BaseModel):
    units: List[FbaShipmentUnit]


class FbaBoxUnitUpdate(BaseModel):
    unit_number: int
    scan_id: str
    box_number: int
