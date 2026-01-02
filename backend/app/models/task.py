"""Pydantic models for tasks."""
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class TaskCreate(BaseModel):
    """Model for creating a task."""
    title: str
    description: Optional[str] = None
    status: Optional[str] = 'pending'
    priority: Optional[str] = 'medium'
    due_date: Optional[datetime] = None


class TaskUpdate(BaseModel):
    """Model for updating a task."""
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[datetime] = None


class TaskResponse(BaseModel):
    """Model for task response."""
    id: UUID
    user_id: UUID
    title: str
    description: Optional[str] = None
    status: str
    priority: str
    due_date: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

