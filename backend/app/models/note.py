"""Pydantic models for personal My Space notes."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class NoteCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    content: str = Field(default="", max_length=50_000)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("Title is required.")
        return cleaned

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: str) -> str:
        return value if value is not None else ""


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    content: Optional[str] = Field(default=None, max_length=50_000)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Title is required.")
        return cleaned

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value


class NoteResponse(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    content: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
