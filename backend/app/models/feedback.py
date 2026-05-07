"""Feedback submission models."""

from pydantic import BaseModel, Field
from typing import Optional


class FeedbackCreate(BaseModel):
    """Body for creating feedback."""

    first_name: str = Field(..., min_length=1, max_length=120, description="First name")
    last_name: str = Field(..., min_length=1, max_length=120, description="Surname")
    position: str = Field(..., min_length=1, max_length=200, description="Job title / role position")
    signature: str = Field(..., min_length=1, max_length=280, description="Typed electronic signature")
    message: Optional[str] = Field(None, max_length=10_000, description="Optional feedback details")


class FeedbackUpdate(FeedbackCreate):
    """Full replace of editable fields when updating feedback (PATCH)."""


class FeedbackItem(BaseModel):
    """Saved feedback row returned to clients."""

    user_id: str
    id: str
    company: str
    first_name: str
    last_name: str
    submitted_name: str
    position: str
    signature: str
    message: Optional[str] = None
    created_at: str
