"""Repository for batch job database operations."""
from typing import List, Optional
from uuid import UUID
from supabase import Client
from fastapi import HTTPException
from datetime import datetime


class JobRepository:
    """Repository for batch_jobs table operations."""
    
    def __init__(self, db: Client):
        self.db = db
        self.table = "batch_jobs"
    
    def get_job(self, job_id: UUID) -> dict:
        """Get a job by ID."""
        response = self.db.table(self.table).select("*").eq("id", str(job_id)).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Job not found")
        return response.data[0]
    
    def list_jobs(
        self, 
        limit: int = 15, 
        offset: int = 0, 
        user_id: Optional[str] = None, 
        is_admin: bool = False
    ) -> List[dict]:
        """List jobs with pagination."""
        query = self.db.table(self.table).select("*").order("created_at", desc=True)
        
        if not is_admin and user_id:
            query = query.eq("created_by", user_id)
        
        response = query.range(offset, offset + limit - 1).execute()
        return response.data
    
    def create_job(
        self, 
        job_name: str, 
        total_batches: int, 
        created_by: UUID
    ) -> dict:
        """Create a new batch job."""
        response = self.db.table(self.table).insert({
            "job_name": job_name,
            "status": "pending",
            "total_batches": total_batches,
            "completed_batches": 0,
            "created_by": str(created_by),
        }).execute()
        return response.data[0]
    
    def update_job_status(
        self, 
        job_id: UUID, 
        status: str, 
        completed_batches: Optional[int] = None,
        completed_at: Optional[datetime] = None
    ) -> None:
        """Update job status."""
        update_data = {"status": status}
        if completed_batches is not None:
            update_data["completed_batches"] = completed_batches
        if completed_at:
            update_data["completed_at"] = completed_at.isoformat()
        
        self.db.table(self.table).update(update_data).eq("id", str(job_id)).execute()
    
    def get_job_batches(self, job_id: UUID) -> List[dict]:
        """Get all batches for a job."""
        response = self.db.table("upc_batches").select(
            "id, batch_number, status, processed_count, upc_count"
        ).eq("batch_job_id", str(job_id)).order("batch_number").execute()
        return response.data
    
    def delete_job(self, job_id: UUID) -> None:
        """Delete a job and all related data (cascades to batches, items, alerts)."""
        # Check if job exists (get_job will raise 404 if not found)
        self.get_job(job_id)
        
        # Delete job (cascade will handle related records)
        self.db.table(self.table).delete().eq("id", str(job_id)).execute()

