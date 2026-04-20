"""Pydantic models for email recipient pool and saved lists."""
from typing import List, Optional
from pydantic import BaseModel, Field


class EmailPoolEntryCreate(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)


class EmailPoolEntryResponse(BaseModel):
    id: str
    email: str


class EmailListCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    emails: List[str] = Field(default_factory=list)


class EmailListUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    emails: Optional[List[str]] = None


class EmailListResponse(BaseModel):
    id: str
    name: str
    emails: List[str]


class RegisteredEmailsResponse(BaseModel):
    emails: List[str]
