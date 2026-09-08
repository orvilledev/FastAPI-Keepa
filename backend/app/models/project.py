"""Pydantic models for the per-user Projects tracker."""
from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

ProjectStatus = Literal[
    "planning",
    "in_progress",
    "on_hold",
    "complete",
    "deployed",
    "cancelled",
]

PROJECT_STATUSES: tuple[str, ...] = (
    "planning",
    "in_progress",
    "on_hold",
    "complete",
    "deployed",
    "cancelled",
)

DONE_STATUSES = frozenset({"complete", "deployed", "cancelled"})


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=10_000)
    status: ProjectStatus = "in_progress"

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("Name is required.")
        return cleaned

    @field_validator("notes")
    @classmethod
    def strip_notes(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=10_000)
    status: Optional[ProjectStatus] = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Name is required.")
        return cleaned

    @field_validator("notes")
    @classmethod
    def strip_notes(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value.strip()


class ProjectResponse(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    notes: Optional[str] = None
    status: ProjectStatus
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True
