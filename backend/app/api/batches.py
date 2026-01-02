"""Batch API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from uuid import UUID
from app.dependencies import get_current_user, get_admin_user
from app.models.batch import UPCBatchResponse, UPCBatchItemResponse
from app.database import get_supabase
from supabase import Client

router = APIRouter()


@router.get("/batches/{batch_id}", response_model=UPCBatchResponse)
async def get_batch(
    batch_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get UPC batch details."""
    try:
        batch_response = db.table("upc_batches").select("*").eq("id", str(batch_id)).execute()
        
        if not batch_response.data:
            raise HTTPException(status_code=404, detail="Batch not found")
        
        batch = batch_response.data[0]
        
        # Check permissions - verify user has access to the parent job
        job_response = db.table("batch_jobs").select("created_by").eq(
            "id", batch["batch_job_id"]
        ).execute()
        
        if not job_response.data:
            raise HTTPException(status_code=404, detail="Parent job not found")
        
        job = job_response.data[0]
        
        profile_response = db.table("profiles").select("role").eq("id", current_user["id"]).execute()
        is_admin = profile_response.data and profile_response.data[0].get("role") == "admin"
        
        if not is_admin and job["created_by"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized to view this batch")
        
        return UPCBatchResponse(**batch)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get batch: {str(e)}")


@router.get("/batches/{batch_id}/items", response_model=List[UPCBatchItemResponse])
async def get_batch_items(
    batch_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get UPC items in a batch."""
    try:
        # Verify batch exists and user has access
        batch_response = db.table("upc_batches").select("batch_job_id").eq("id", str(batch_id)).execute()
        
        if not batch_response.data:
            raise HTTPException(status_code=404, detail="Batch not found")
        
        batch = batch_response.data[0]
        
        # Check permissions
        job_response = db.table("batch_jobs").select("created_by").eq(
            "id", batch["batch_job_id"]
        ).execute()
        
        job = job_response.data[0]
        
        profile_response = db.table("profiles").select("role").eq("id", current_user["id"]).execute()
        is_admin = profile_response.data and profile_response.data[0].get("role") == "admin"
        
        if not is_admin and job["created_by"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized to view this batch")
        
        # Get batch items
        items_response = db.table("upc_batch_items").select("*").eq(
            "upc_batch_id", str(batch_id)
        ).order("upc").execute()
        
        return [UPCBatchItemResponse(**item) for item in items_response.data]
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get batch items: {str(e)}")


@router.post("/batches/{batch_id}/stop")
async def stop_batch(
    batch_id: UUID,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Stop/cancel a batch that is pending or currently processing (admin only)."""
    try:
        # Verify batch exists and get status
        batch_response = db.table("upc_batches").select("*").eq("id", str(batch_id)).execute()
        
        if not batch_response.data:
            raise HTTPException(status_code=404, detail="Batch not found")
        
        batch = batch_response.data[0]
        
        # Check if batch can be stopped (processing or pending)
        if batch["status"] not in ["processing", "pending"]:
            raise HTTPException(
                status_code=400, 
                detail=f"Cannot stop batch. Current status: {batch['status']}"
            )
        
        # Update batch status to cancelled (admin only)
        from datetime import datetime
        db.table("upc_batches").update({
            "status": "cancelled",
            "error_message": "Cancelled by user",
            "completed_at": datetime.utcnow().isoformat(),
        }).eq("id", str(batch_id)).execute()
        
        return {"message": "Batch stopped successfully", "batch_id": str(batch_id)}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop batch: {str(e)}")

