"""Pydantic models for registered shipments and their FBA uploads."""
from datetime import datetime
import re
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

_VENDOR_RE = re.compile(r"^[A-Z0-9]{2,8}$")

ShipmentStatus = Literal["open", "in_progress", "ready", "closed"]
SHIPMENT_STATUSES: tuple[ShipmentStatus, ...] = ("open", "in_progress", "ready", "closed")


def _normalize_vendor(value: Optional[str], *, required: bool) -> str:
    cleaned = (value or "").strip().upper()
    if not cleaned:
        if required:
            raise ValueError("Vendor is required (for example NFA, DNK, or SMW).")
        return ""
    if not _VENDOR_RE.match(cleaned):
        raise ValueError("Vendor must be 2–8 letters or digits, like NFA, DNK, or SMW.")
    return cleaned


def _normalize_status(value: Optional[str]) -> ShipmentStatus:
    cleaned = (value or "").strip().lower().replace(" ", "_").replace("-", "_")
    if cleaned not in SHIPMENT_STATUSES:
        raise ValueError(
            "Status must be one of: Open, In Progress, Ready, or Closed."
        )
    return cleaned  # type: ignore[return-value]


class ShipmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    vendor: str = Field(..., min_length=1, max_length=8)
    notes: Optional[str] = Field(default=None, max_length=10_000)
    status: ShipmentStatus = "open"

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("Shipment name is required.")
        return cleaned

    @field_validator("vendor")
    @classmethod
    def strip_vendor(cls, value: str) -> str:
        return _normalize_vendor(value, required=True)

    @field_validator("notes")
    @classmethod
    def strip_notes(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, value: object) -> ShipmentStatus:
        if value is None or value == "":
            return "open"
        return _normalize_status(str(value))


class ShipmentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    vendor: Optional[str] = Field(default=None, max_length=8)
    notes: Optional[str] = Field(default=None, max_length=10_000)
    status: Optional[ShipmentStatus] = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Shipment name is required.")
        return cleaned

    @field_validator("vendor")
    @classmethod
    def strip_vendor(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return _normalize_vendor(value, required=True)

    @field_validator("notes")
    @classmethod
    def strip_notes(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value.strip()

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, value: object) -> Optional[ShipmentStatus]:
        if value is None or value == "":
            return None
        return _normalize_status(str(value))


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
    vendor: str = ""
    status: ShipmentStatus = "open"
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

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, value: object) -> ShipmentStatus:
        if value is None or value == "":
            return "open"
        try:
            return _normalize_status(str(value))
        except ValueError:
            return "open"


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
