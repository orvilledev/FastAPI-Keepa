"""Pydantic models for price alerts."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID
from decimal import Decimal


class PriceAlertResponse(BaseModel):
    """Model for price alert response."""
    id: UUID
    batch_job_id: UUID
    upc: str
    seller_name: Optional[str]
    current_price: Optional[Decimal]
    historical_price: Optional[Decimal]
    price_change_percent: Optional[Decimal]
    keepa_data: Optional[dict]
    detected_at: datetime

    class Config:
        from_attributes = True

