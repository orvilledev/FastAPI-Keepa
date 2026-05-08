"""Pydantic models for Tracking Scanner history."""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class TrackingScannerRow(BaseModel):
    source_file: str
    odd_page: Optional[int]
    even_page: Optional[int]
    vendor: str = ""
    shipment_id: str = ""
    box_code: str = ""
    tracking_number: str = ""
    tracking_number_raw: str = ""
    carrier: str = ""
    status: str = "ok"
    notes: str = ""


class TrackingHistoryCreate(BaseModel):
    name: Optional[str] = None
    source_count: int = 0
    file_count: int = 0
    pair_count: int = 0
    matched_count: int = 0
    needs_review_count: int = 0
    rows: List[TrackingScannerRow] = Field(default_factory=list)


class TrackingHistorySummary(BaseModel):
    id: UUID
    user_id: UUID
    name: Optional[str] = None
    source_count: int
    file_count: int
    pair_count: int
    matched_count: int
    needs_review_count: int
    row_count: int
    created_at: datetime


class TrackingHistoryDetail(TrackingHistorySummary):
    rows: List[TrackingScannerRow] = Field(default_factory=list)

