"""Pydantic models for UPCs."""
from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import List
from datetime import datetime
from uuid import UUID

from app.utils.vendor_code import is_valid_vendor_code, normalize_vendor_code


class UPCCreate(BaseModel):
    """Model for creating UPC."""
    upc: str
    category: str = "dnk"

    @field_validator("category")
    @classmethod
    def validate_category_field(cls, v: str) -> str:
        nv = normalize_vendor_code(v)
        if not nv:
            return "dnk"
        if not is_valid_vendor_code(nv):
            raise ValueError(
                "Invalid category code. Use 1–32 lowercase letters, digits, hyphens, or underscores; "
                "must start with a letter or digit."
            )
        return nv


class UPCsCreateRequest(BaseModel):
    """Model for creating multiple UPCs."""
    upcs: List[str] = Field(..., description="List of UPC codes to add")
    category: str = Field(default="dnk", description="Vendor category code (e.g. dnk, clk, or custom)")

    @field_validator("category")
    @classmethod
    def validate_category_field(cls, v: str) -> str:
        nv = normalize_vendor_code(v)
        if not nv:
            return "dnk"
        if not is_valid_vendor_code(nv):
            raise ValueError(
                "Invalid category code. Use 1–32 lowercase letters, digits, hyphens, or underscores; "
                "must start with a letter or digit."
            )
        return nv

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "upcs": ["888362146945", "888362147041"],
                "category": "clk"
            }
        }
    )


class UPCResponse(BaseModel):
    """Model for UPC response."""
    id: UUID
    upc: str
    category: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

