"""Pydantic models for batch jobs."""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID


class BatchJobCreate(BaseModel):
    """Model for creating a batch job."""
    job_name: str
    upcs: list[str]  # List of UPCs to process


class BatchJobResponse(BaseModel):
    """Model for batch job response."""
    id: UUID
    job_name: str
    status: str
    total_batches: int
    completed_batches: int
    created_by: Optional[UUID]
    created_at: datetime
    completed_at: Optional[datetime]
    error_message: Optional[str]

    class Config:
        from_attributes = True


class UPCBatchResponse(BaseModel):
    """Model for UPC batch response."""
    id: UUID
    batch_job_id: UUID
    batch_number: int
    status: str
    upc_count: int
    processed_count: int
    created_at: datetime
    completed_at: Optional[datetime]
    error_message: Optional[str]

    class Config:
        from_attributes = True


class UPCBatchItemResponse(BaseModel):
    """Model for UPC batch item response."""
    id: UUID
    upc_batch_id: UUID
    upc: str
    keepa_data: Optional[dict]
    status: str
    error_message: Optional[str]
    processed_at: Optional[datetime]

    class Config:
        from_attributes = True

