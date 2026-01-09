"""Pydantic models for task validations."""
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class TaskValidationCreate(BaseModel):
    """Model for creating a task validation."""
    task_id: UUID
    validation_type: str  # 'file' or 'text'
    file_name: Optional[str] = None
    file_url: Optional[str] = None
    file_size: Optional[int] = None
    text_content: Optional[str] = None


class TaskValidationUpdate(BaseModel):
    """Model for updating a task validation (approval/rejection)."""
    status: str  # 'approved' or 'rejected'
    review_notes: Optional[str] = None


class TaskValidationResponse(BaseModel):
    """Model for task validation response."""
    id: UUID
    task_id: UUID
    submitted_by: UUID
    validation_type: str
    file_name: Optional[str] = None
    file_url: Optional[str] = None
    file_size: Optional[int] = None
    text_content: Optional[str] = None
    status: str
    reviewed_by: Optional[UUID] = None
    review_notes: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

