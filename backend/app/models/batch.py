"""Pydantic models for batch jobs."""
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Literal
from datetime import datetime
from uuid import UUID

from app.models.map import DEFAULT_MAP_VENDOR_TYPE
from app.utils.vendor_code import (
    is_valid_vendor_code,
    normalize_vendor_code,
    resolve_map_vendor_type,
)


OffPriceScope = Literal[
    "buybox_only",
    "buybox_and_non_buybox_below_map",
]


class BatchJobCreate(BaseModel):
    """Model for creating a batch job."""
    job_name: str
    upcs: list[str]  # List of UPCs to process
    email_recipients: Optional[str] = None
    keepa_offers_limit: int = Field(
        ge=0,
        le=500,
        description="Per-job Keepa offers limit (0-500). Required for deterministic processing.",
    )
    map_vendor_type: Optional[str] = Field(
        default=None,
        description="MAP vendor code (map_prices.vendor_type); omit for default (dnk)",
    )
    off_price_scope: OffPriceScope = Field(
        default="buybox_and_non_buybox_below_map",
        description=(
            "Off-price detection scope: "
            "'buybox_only' or 'buybox_and_non_buybox_below_map'"
        ),
    )

    @field_validator("map_vendor_type")
    @classmethod
    def validate_map_vendor_type(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not str(v).strip():
            return None
        nv = normalize_vendor_code(v)
        if not is_valid_vendor_code(nv):
            raise ValueError(
                "Invalid map_vendor_type. Use 1–32 lowercase letters, digits, hyphens, or underscores; "
                "must start with a letter or digit."
            )
        return nv


class BatchJobUpdate(BaseModel):
    """Model for updating a batch job."""
    job_name: Optional[str] = None
    description: Optional[str] = None
    email_recipients: Optional[str] = None


class BatchJobResponse(BaseModel):
    """Model for batch job response."""
    id: UUID
    job_name: str
    status: str
    total_batches: int
    completed_batches: int
    total_upcs: int = 0
    created_by: Optional[UUID]
    initiated_by: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime]
    error_message: Optional[str]
    description: Optional[str] = None
    email_recipients: Optional[str] = None
    keepa_offers_limit: Optional[int] = None
    map_vendor_type: str = Field(default=DEFAULT_MAP_VENDOR_TYPE)
    off_price_scope: OffPriceScope = "buybox_and_non_buybox_below_map"

    @field_validator("map_vendor_type", mode="before")
    @classmethod
    def normalize_response_map_vendor(cls, v: object) -> str:
        if v is None:
            return resolve_map_vendor_type(None)
        if isinstance(v, str):
            return resolve_map_vendor_type(v)
        return resolve_map_vendor_type(str(v))

    class Config:
        from_attributes = True


class UPCBatchResponse(BaseModel):
    """Model for UPC batch response."""
    id: UUID
    batch_job_id: UUID
    batch_number: int
    status: str
    upc_count: int
    processed_count: int
    created_at: datetime
    completed_at: Optional[datetime]
    error_message: Optional[str]

    class Config:
        from_attributes = True


class UPCBatchItemResponse(BaseModel):
    """Model for UPC batch item response."""
    id: UUID
    upc_batch_id: UUID
    upc: str
    keepa_data: Optional[dict]
    status: str
    error_message: Optional[str]
    processed_at: Optional[datetime]

    class Config:
        from_attributes = True

