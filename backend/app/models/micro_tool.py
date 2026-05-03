"""Pydantic models for Micro Tools (user-owned external shortcuts)."""
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from uuid import UUID
from datetime import datetime


class MicroToolLink(BaseModel):
    label: str
    url: str


class MicroToolCreate(BaseModel):
    name: str
    description: Optional[str] = None
    url: str
    action_label: Optional[str] = None
    tags: Optional[List[str]] = None
    extra_links: Optional[List[MicroToolLink]] = None

    @field_validator("url")
    @classmethod
    def strip_url(cls, v: str) -> str:
        return (v or "").strip()


class MicroToolUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    action_label: Optional[str] = None
    tags: Optional[List[str]] = None
    extra_links: Optional[List[MicroToolLink]] = None

    @field_validator("url")
    @classmethod
    def strip_url(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return v.strip()


class MicroToolResponse(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    description: Optional[str] = None
    url: str
    action_label: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    extra_links: List[MicroToolLink] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
