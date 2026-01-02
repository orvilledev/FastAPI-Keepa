"""Job management API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from typing import List
from uuid import UUID
from app.dependencies import get_current_user, get_admin_user
from app.models.batch import BatchJobCreate, BatchJobResponse
from app.database import get_supabase
from app.services.batch_processor import BatchProcessor
from supabase import Client

router = APIRouter()


@router.post("/jobs", response_model=BatchJobResponse, status_code=201)
async def create_job(
    job_data: BatchJobCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Create a new batch job (admin only)."""
    try:
        processor = BatchProcessor()
        job_id = await processor.create_batch_job(
            job_name=job_data.job_name,
            upcs=job_data.upcs,
            created_by=UUID(current_user["id"])
        )
        
        # Start processing in background
        background_tasks.add_task(processor.process_job, job_id)
        
        # Return job data
        job_response = db.table("batch_jobs").select("*").eq("id", str(job_id)).execute()
        return BatchJobResponse(**job_response.data[0])
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create job: {str(e)}")


@router.get("/jobs", response_model=List[BatchJobResponse])
async def list_jobs(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """List all batch jobs (users see their own, admins see all)."""
    try:
        # Check if user is admin
        profile_response = db.table("profiles").select("role").eq("id", current_user["id"]).execute()
        is_admin = profile_response.data and profile_response.data[0].get("role") == "admin"
        
        if is_admin:
            # Admins see all jobs
            jobs_response = db.table("batch_jobs").select("*").order("created_at", desc=True).execute()
        else:
            # Users see only their jobs
            jobs_response = db.table("batch_jobs").select("*").eq(
                "created_by", current_user["id"]
            ).order("created_at", desc=True).execute()
        
        return [BatchJobResponse(**job) for job in jobs_response.data]
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list jobs: {str(e)}")


@router.get("/jobs/{job_id}", response_model=BatchJobResponse)
async def get_job(
    job_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get batch job details."""
    try:
        job_response = db.table("batch_jobs").select("*").eq("id", str(job_id)).execute()
        
        if not job_response.data:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job = job_response.data[0]
        
        # Check permissions
        profile_response = db.table("profiles").select("role").eq("id", current_user["id"]).execute()
        is_admin = profile_response.data and profile_response.data[0].get("role") == "admin"
        
        if not is_admin and job["created_by"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized to view this job")
        
        return BatchJobResponse(**job)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get job: {str(e)}")


@router.get("/jobs/{job_id}/status", response_model=dict)
async def get_job_status(
    job_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get batch job status and progress."""
    try:
        job_response = db.table("batch_jobs").select("*").eq("id", str(job_id)).execute()
        
        if not job_response.data:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job = job_response.data[0]
        
        # Check permissions
        profile_response = db.table("profiles").select("role").eq("id", current_user["id"]).execute()
        is_admin = profile_response.data and profile_response.data[0].get("role") == "admin"
        
        if not is_admin and job["created_by"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not authorized to view this job")
        
        # Get batch statuses
        batches_response = db.table("upc_batches").select(
            "id, batch_number, status, processed_count, upc_count"
        ).eq("batch_job_id", str(job_id)).order("batch_number").execute()
        
        batches = batches_response.data
        
        return {
            "job_id": str(job_id),
            "status": job["status"],
            "total_batches": job["total_batches"],
            "completed_batches": job["completed_batches"],
            "progress_percent": (
                (job["completed_batches"] / job["total_batches"] * 100)
                if job["total_batches"] > 0 else 0
            ),
            "batches": batches,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get job status: {str(e)}")


@router.post("/jobs/{job_id}/trigger")
async def trigger_job(
    job_id: UUID,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Manually trigger a job (admin only)."""
    try:
        job_response = db.table("batch_jobs").select("*").eq("id", str(job_id)).execute()
        
        if not job_response.data:
            raise HTTPException(status_code=404, detail="Job not found")
        
        job = job_response.data[0]
        
        if job["status"] == "processing":
            raise HTTPException(status_code=400, detail="Job is already processing")
        
        # Start processing in background
        processor = BatchProcessor()
        background_tasks.add_task(processor.process_job, job_id)
        
        return {"message": "Job triggered successfully", "job_id": str(job_id)}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trigger job: {str(e)}")

