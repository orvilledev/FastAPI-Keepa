"""Pydantic models for quick access links and shared categories."""
from pydantic import BaseModel, Field
from typing import List, Optional
from uuid import UUID
from datetime import datetime


class QuickAccessLinkCreate(BaseModel):
    """Model for creating a quick access link."""
    title: str
    url: str
    icon: Optional[str] = None
    display_order: Optional[int] = 0
    group_id: Optional[UUID] = None


class QuickAccessLinkUpdate(BaseModel):
    """Model for updating a quick access link."""
    title: Optional[str] = None
    url: Optional[str] = None
    icon: Optional[str] = None
    display_order: Optional[int] = None
    group_id: Optional[UUID] = None
    place_in_group: bool = False


class QuickAccessLinkResponse(BaseModel):
    """Model for quick access link response."""
    id: UUID
    user_id: UUID
    title: str
    url: str
    icon: Optional[str] = None
    display_order: int
    created_at: datetime
    updated_at: datetime
    group_id: Optional[UUID] = None
    added_by_email: Optional[str] = None
    added_by_name: Optional[str] = None
    can_edit: bool = True

    class Config:
        from_attributes = True


class QuickAccessGroupCreate(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class QuickAccessGroupUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class QuickAccessShareUpdate(BaseModel):
    emails: List[str] = Field(default_factory=list)


class QuickAccessPerson(BaseModel):
    id: UUID
    email: str
    display_name: Optional[str] = None


class QuickAccessGroupMember(BaseModel):
    user_id: UUID
    email: str
    display_name: Optional[str] = None


class QuickAccessGroupResponse(BaseModel):
    id: UUID
    title: str
    owner_id: UUID
    owner_email: str
    owner_name: Optional[str] = None
    is_owner: bool
    members: List[QuickAccessGroupMember]
    links: List[QuickAccessLinkResponse]
