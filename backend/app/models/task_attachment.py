"""Pydantic models for task attachments."""
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class TaskAttachmentResponse(BaseModel):
    """Model for task attachment response."""
    id: UUID
    task_id: UUID
    uploaded_by: UUID
    file_name: str
    file_url: str
    file_size: int
    file_type: str
    file_category: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

