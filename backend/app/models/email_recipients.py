"""Pydantic models for email recipient pool and shared email groups."""
from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class EmailPoolEntryCreate(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    display_name: Optional[str] = Field(None, min_length=1, max_length=120)


class EmailPoolEntryUpdate(BaseModel):
    display_name: Optional[str] = Field(None, min_length=1, max_length=120)


class EmailPoolEntryResponse(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None


EmailMemberRole = Literal["to", "bcc"]


class EmailGroupMember(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    role: EmailMemberRole = "to"


class EmailListCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    members: List[EmailGroupMember] = Field(default_factory=list)
    # Legacy: flat addresses treated as role=to when members is empty.
    emails: List[str] = Field(default_factory=list)


class EmailListUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    members: Optional[List[EmailGroupMember]] = None
    emails: Optional[List[str]] = None


class EmailListResponse(BaseModel):
    id: str
    name: str
    members: List[EmailGroupMember]
    # Flat To+BCC emails for older clients; prefer members.
    emails: List[str]


class RegisteredEmailsResponse(BaseModel):
    emails: List[str]
