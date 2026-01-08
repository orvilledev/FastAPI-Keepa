"""Job management API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from typing import List
from uuid import UUID
from app.dependencies import get_current_user, get_admin_user, check_is_admin, verify_job_access
from app.models.batch import BatchJobCreate, BatchJobUpdate, BatchJobResponse
from app.database import get_supabase
from app.services.batch_processor import BatchProcessor
from app.repositories.job_repository import JobRepository
from app.services.job_status_service import JobStatusService
from app.utils.error_handler import handle_api_errors
from supabase import Client

router = APIRouter()


@router.post("/jobs", response_model=BatchJobResponse, status_code=201)
@handle_api_errors("create job")
async def create_job(
    job_data: BatchJobCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Create a new batch job (admin only)."""
    processor = BatchProcessor()
    job_id = await processor.create_batch_job(
        job_name=job_data.job_name,
        upcs=job_data.upcs,
        created_by=UUID(current_user["id"])
    )
    
    # Start processing in background
    background_tasks.add_task(processor.process_job, job_id)
    
    # Return job data
    job_repo = JobRepository(db)
    job = job_repo.get_job(job_id)
    return BatchJobResponse(**job)


@router.get("/jobs", response_model=List[BatchJobResponse])
@handle_api_errors("list jobs")
async def list_jobs(
    limit: int = 15,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """List batch jobs with pagination (users see their own, admins see all).
    
    Args:
        limit: Maximum number of jobs to return (default: 15)
        offset: Number of jobs to skip (default: 0)
    """
    is_admin = await check_is_admin(current_user, db)
    job_repo = JobRepository(db)
    jobs = job_repo.list_jobs(
        limit=limit,
        offset=offset,
        user_id=current_user["id"] if not is_admin else None,
        is_admin=is_admin
    )
    return [BatchJobResponse(**job) for job in jobs]


@router.get("/jobs/{job_id}", response_model=BatchJobResponse)
@handle_api_errors("get job")
async def get_job(
    job: dict = Depends(verify_job_access)
):
    """Get batch job details."""
    return BatchJobResponse(**job)


@router.get("/jobs/{job_id}/status", response_model=dict)
@handle_api_errors("get job status")
async def get_job_status(
    job: dict = Depends(verify_job_access),
    db: Client = Depends(get_supabase)
):
    """Get batch job status and progress."""
    job_id = UUID(job["id"])
    job_repo = JobRepository(db)
    
    # Get batch statuses
    batches = job_repo.get_job_batches(job_id)
    
    # Check and update job status if all batches are done
    if job["status"] == "processing":
        JobStatusService.update_job_status_if_all_batches_done(job_id, db)
        # Reload job to get updated status
        job = job_repo.get_job(job_id)
    
    # Count completed batches (including cancelled)
    completed_count = len([b for b in batches if b["status"] in ["completed", "cancelled"]])
    
    return {
        "job_id": str(job_id),
        "status": job["status"],
        "total_batches": job["total_batches"],
        "completed_batches": completed_count,
        "progress_percent": (
            (completed_count / job["total_batches"] * 100)
            if job["total_batches"] > 0 else 0
        ),
        "batches": batches,
    }


@router.post("/jobs/{job_id}/trigger")
@handle_api_errors("trigger job")
async def trigger_job(
    job_id: UUID,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Manually trigger a job (admin only)."""
    job_repo = JobRepository(db)
    job = job_repo.get_job(job_id)
    
    if job["status"] == "processing":
        raise HTTPException(status_code=400, detail="Job is already processing")
    
    # Start processing in background
    processor = BatchProcessor()
    background_tasks.add_task(processor.process_job, job_id)
    
    return {"message": "Job triggered successfully", "job_id": str(job_id)}


@router.put("/jobs/{job_id}", response_model=BatchJobResponse)
@handle_api_errors("update job")
async def update_job(
    job_id: UUID,
    job_data: BatchJobUpdate,
    job: dict = Depends(verify_job_access),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Update a batch job (admin only or job owner)."""
    from app.dependencies import check_is_admin
    
    job_id_uuid = UUID(job["id"])
    job_repo = JobRepository(db)
    
    # Check if user is admin or job owner
    is_admin = await check_is_admin(current_user, db)
    if not is_admin and job["created_by"] != current_user["id"]:
        raise HTTPException(
            status_code=403, 
            detail="You can only edit your own jobs. Admin access required to edit other users' jobs."
        )
    
    # Prevent editing of processing jobs
    if job["status"] == "processing":
        raise HTTPException(
            status_code=400, 
            detail="Cannot edit a job that is currently processing. Please wait for it to complete or stop it first."
        )
    
    # Update the job
    updated_job = job_repo.update_job(
        job_id=job_id_uuid,
        job_name=job_data.job_name,
        description=job_data.description,
        email_recipients=job_data.email_recipients
    )
    
    return BatchJobResponse(**updated_job)


@router.delete("/jobs/{job_id}")
@handle_api_errors("delete job")
async def delete_job(
    job: dict = Depends(verify_job_access),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Delete a job and all related data (admin only, or job owner)."""
    job_id = UUID(job["id"])
    job_repo = JobRepository(db)
    
    # Check if user is admin or job owner
    is_admin = await check_is_admin(current_user, db)
    if not is_admin and job["created_by"] != current_user["id"]:
        raise HTTPException(
            status_code=403, 
            detail="You can only delete your own jobs. Admin access required to delete other users' jobs."
        )
    
    # Prevent deletion of processing jobs (optional safety check)
    if job["status"] == "processing":
        raise HTTPException(
            status_code=400, 
            detail="Cannot delete a job that is currently processing. Please wait for it to complete or stop it first."
        )
    
    # Delete the job (cascade will handle related records)
    job_repo.delete_job(job_id)
    
    return {"message": "Job deleted successfully", "job_id": str(job_id)}
