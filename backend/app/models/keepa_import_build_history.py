"""Pydantic models for Keepa Import File build history."""
from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel

BuildStatus = Literal["building", "complete", "failed", "cancelled"]


class KeepaImportBuildHistorySummary(BaseModel):
    id: UUID
    user_id: UUID
    created_by_name: Optional[str] = None
    category: str
    status: BuildStatus
    upc_count: int
    completed_upcs: int
    progress_percent: int
    phase: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None
    filename: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class KeepaImportBuildContentRow(BaseModel):
    upc: str
    title: Optional[str] = None
    buy_box_seller: Optional[str] = None
    buy_box_price: Optional[str] = None
    asin: Optional[str] = None
    amazon_url: Optional[str] = None


class KeepaImportGlobalBusyStatus(BaseModel):
    busy: bool
    build_id: Optional[UUID] = None
    category: Optional[str] = None
    created_by_name: Optional[str] = None
    progress_percent: Optional[int] = None
    message: Optional[str] = None


class KeepaImportBuildContentsResponse(BaseModel):
    build_id: UUID
    filename: Optional[str] = None
    category: str
    total: int
    offset: int
    limit: int
    rows: list[KeepaImportBuildContentRow]
