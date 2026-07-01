"""Pydantic models for Keepa Import File build history."""
from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel

BuildStatus = Literal["building", "complete", "failed", "cancelled"]


class KeepaImportBuildHistorySummary(BaseModel):
    id: UUID
    user_id: UUID
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
