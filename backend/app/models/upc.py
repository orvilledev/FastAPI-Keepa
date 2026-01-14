"""Pydantic models for UPCs."""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Literal, List
from datetime import datetime
from uuid import UUID


class UPCCreate(BaseModel):
    """Model for creating UPC."""
    upc: str
    category: Literal["dnk", "clk"] = "dnk"


class UPCsCreateRequest(BaseModel):
    """Model for creating multiple UPCs."""
    upcs: List[str] = Field(..., description="List of UPC codes to add")
    category: Literal["dnk", "clk"] = Field(default="dnk", description="Category: 'dnk' or 'clk'")

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

