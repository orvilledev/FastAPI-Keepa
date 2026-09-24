"""Pydantic models for registered shipments and their FBA uploads."""
from datetime import datetime
import re
from typing import Any, Dict, List, Literal, Optional
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


class ShipmentChecklistEntry(BaseModel):
    """One checklist step's completion state and who marked it done."""

    completed: bool = False
    completed_by: str = ""
    completed_by_name: str = ""
    completed_at: Optional[datetime] = None

    @field_validator("completed_by", "completed_by_name", mode="before")
    @classmethod
    def coerce_text(cls, value: object) -> str:
        if value is None:
            return ""
        return str(value).strip()

    @field_validator("completed_at", mode="before")
    @classmethod
    def coerce_completed_at(cls, value: object) -> Optional[datetime]:
        if value is None or value == "":
            return None
        return value  # type: ignore[return-value]


class ShipmentChecklistStep(BaseModel):
    """One step in a vendor checklist template."""

    id: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=300)

    @field_validator("id", mode="before")
    @classmethod
    def normalize_id(cls, value: object) -> str:
        return str(value or "").strip().lower()

    @field_validator("label")
    @classmethod
    def strip_label(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("Checklist step label is required.")
        return cleaned


class ShipmentChecklistStepInput(BaseModel):
    """Template step from the editor; id is optional and generated when missing."""

    id: Optional[str] = Field(default=None, max_length=64)
    label: str = Field(..., min_length=1, max_length=300)

    @field_validator("id", mode="before")
    @classmethod
    def normalize_id(cls, value: object) -> Optional[str]:
        if value is None or value == "":
            return None
        return str(value).strip().lower() or None

    @field_validator("label")
    @classmethod
    def strip_label(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("Checklist step label is required.")
        return cleaned


class ShipmentChecklistTemplateUpdate(BaseModel):
    """Replace the checklist template for one vendor (superadmin)."""

    steps: List[ShipmentChecklistStepInput] = Field(default_factory=list)


class ShipmentChecklistTemplateResponse(BaseModel):
    vendor: str
    steps: List[ShipmentChecklistStep] = Field(default_factory=list)


class ShipmentChecklistUpdate(BaseModel):
    """Toggle one checklist step on a shipment that has a vendor checklist."""

    item_id: str = Field(..., min_length=1, max_length=64)
    completed: bool
    # Superadmin only: override the displayed completer name.
    completed_by_name: Optional[str] = Field(default=None, max_length=120)

    @field_validator("item_id")
    @classmethod
    def strip_item_id(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("Checklist item id is required.")
        return cleaned

    @field_validator("completed_by_name", mode="before")
    @classmethod
    def strip_completed_by_name(cls, value: object) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None


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


class ShipmentFolderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    shipment_ids: List[UUID] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("Folder name is required.")
        return cleaned


class ShipmentFolderUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("Folder name is required.")
        return cleaned


class ShipmentFolderMembers(BaseModel):
    shipment_ids: List[UUID] = Field(..., min_length=1)


class ShipmentFolderResponse(BaseModel):
    id: UUID
    name: str
    sort_order: int = 0
    created_by: UUID
    created_by_email: str = ""
    created_at: datetime
    updated_at: datetime
    shipment_count: int = 0
    starred: bool = False

    model_config = ConfigDict(from_attributes=True)


class ShipmentMoveRequest(BaseModel):
    direction: Literal["up", "down"]


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
    folder_id: Optional[UUID] = None
    folder_name: Optional[str] = None
    sort_order: int = 0
    checklist: Dict[str, ShipmentChecklistEntry] = Field(default_factory=dict)
    checklist_steps: List[ShipmentChecklistStep] = Field(default_factory=list)
    can_edit_checklist: bool = False
    created_by: UUID
    created_by_email: str = ""
    created_by_name: str = ""
    created_at: datetime
    updated_at: datetime
    upload_count: int = 0
    contributor_count: int = 0
    row_count: int = 0
    unique_upc_count: int = 0
    total_units: int = 0
    can_delete: bool = False
    starred: bool = False

    model_config = ConfigDict(from_attributes=True)

    @field_validator("checklist", mode="before")
    @classmethod
    def coerce_checklist(cls, value: object) -> Dict[str, Any]:
        if value is None or value == "":
            return {}
        if not isinstance(value, dict):
            return {}
        from app.constants.shipment_checklists import parse_checklist_entry

        return {str(key): parse_checklist_entry(raw) for key, raw in value.items()}

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
