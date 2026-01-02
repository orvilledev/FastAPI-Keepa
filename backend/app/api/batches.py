"""Batch API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from uuid import UUID
from datetime import datetime
from app.dependencies import get_admin_user, verify_batch_access
from app.models.batch import UPCBatchResponse, UPCBatchItemResponse
from app.database import get_supabase
from app.repositories.batch_repository import BatchRepository
from app.services.job_status_service import JobStatusService
from app.utils.error_handler import handle_api_errors
from supabase import Client

router = APIRouter()


@router.get("/batches/{batch_id}", response_model=UPCBatchResponse)
@handle_api_errors("get batch")
async def get_batch(
    batch: dict = Depends(verify_batch_access)
):
    """Get UPC batch details."""
    return UPCBatchResponse(**batch)


@router.get("/batches/{batch_id}/items", response_model=List[UPCBatchItemResponse])
@handle_api_errors("get batch items")
async def get_batch_items(
    batch: dict = Depends(verify_batch_access),
    db: Client = Depends(get_supabase)
):
    """Get UPC items in a batch."""
    batch_id = UUID(batch["id"])
    batch_repo = BatchRepository(db)
    items = batch_repo.get_batch_items(batch_id)
    return [UPCBatchItemResponse(**item) for item in items]


@router.post("/batches/{batch_id}/stop")
@handle_api_errors("stop batch")
async def stop_batch(
    batch_id: UUID,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Stop/cancel a batch that is pending or currently processing (admin only)."""
    batch_repo = BatchRepository(db)
    batch = batch_repo.get_batch(batch_id)
    
    # Check if batch can be stopped (processing or pending)
    if batch["status"] not in ["processing", "pending"]:
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot stop batch. Current status: {batch['status']}"
        )
    
    # Update batch status to cancelled
    batch_repo.update_batch_status(
        batch_id=batch_id,
        status="cancelled",
        error_message="Cancelled by user",
        completed_at=datetime.utcnow()
    )
    
    # Check if all batches are done and update job status accordingly
    job_id = batch_repo.get_batch_job_id(batch_id)
    JobStatusService.update_job_status_if_all_batches_done(job_id, db)
    
    return {"message": "Batch stopped successfully", "batch_id": str(batch_id)}

