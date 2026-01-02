"""Pydantic models for dashboard widgets."""
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class DashboardWidgetCreate(BaseModel):
    """Model for creating a dashboard widget preference."""
    widget_id: str
    display_order: int
    is_visible: Optional[bool] = True


class DashboardWidgetUpdate(BaseModel):
    """Model for updating a dashboard widget preference."""
    display_order: Optional[int] = None
    is_visible: Optional[bool] = None


class DashboardWidgetResponse(BaseModel):
    """Model for dashboard widget response."""
    id: UUID
    user_id: UUID
    widget_id: str
    display_order: int
    is_visible: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DashboardWidgetOrderUpdate(BaseModel):
    """Model for updating widget order in bulk."""
    widgets: list[dict]  # List of {widget_id: str, display_order: int}

