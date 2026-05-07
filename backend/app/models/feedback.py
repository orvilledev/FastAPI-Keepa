"""Feedback submission models."""

from pydantic import BaseModel, Field
from typing import Optional


class FeedbackCreate(BaseModel):
    """Body for creating feedback."""

    first_name: str = Field(..., min_length=1, max_length=120, description="First name")
    last_name: str = Field(..., min_length=1, max_length=120, description="Surname")
    position: str = Field(..., min_length=1, max_length=200, description="Job title / role position")
    message: Optional[str] = Field(None, max_length=10_000, description="Optional feedback details")


class FeedbackItem(BaseModel):
    """Saved feedback row returned to clients."""

    id: str
    first_name: str
    last_name: str
    submitted_name: str
    position: str
    message: Optional[str] = None
    created_at: str
