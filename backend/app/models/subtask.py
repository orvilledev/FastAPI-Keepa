"""Pydantic models for subtasks."""
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class SubtaskCreate(BaseModel):
    """Model for creating a subtask."""
    title: str
    description: Optional[str] = None
    status: Optional[str] = 'pending'
    display_order: Optional[int] = 0


class SubtaskUpdate(BaseModel):
    """Model for updating a subtask."""
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    display_order: Optional[int] = None


class SubtaskResponse(BaseModel):
    """Model for subtask response."""
    id: UUID
    task_id: UUID
    title: str
    description: Optional[str] = None
    status: str
    display_order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

