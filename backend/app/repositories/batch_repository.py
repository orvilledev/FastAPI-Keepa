"""Repository for batch database operations."""
from typing import List, Optional
from uuid import UUID
from supabase import Client
from fastapi import HTTPException
from datetime import datetime


class BatchRepository:
    """Repository for upc_batches table operations."""
    
    def __init__(self, db: Client):
        self.db = db
        self.table = "upc_batches"
    
    def get_batch(self, batch_id: UUID) -> dict:
        """Get a batch by ID."""
        response = self.db.table(self.table).select("*").eq("id", str(batch_id)).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Batch not found")
        return response.data[0]
    
    def get_batch_items(self, batch_id: UUID) -> List[dict]:
        """Get all items for a batch."""
        response = self.db.table("upc_batch_items").select("*").eq(
            "upc_batch_id", str(batch_id)
        ).order("upc").execute()
        return response.data
    
    def get_batches_by_job(self, job_id: UUID) -> List[dict]:
        """Get all batches for a job."""
        response = self.db.table(self.table).select("status").eq(
            "batch_job_id", str(job_id)
        ).execute()
        return response.data
    
    def create_batch(
        self, 
        batch_job_id: UUID, 
        batch_number: int, 
        upc_count: int
    ) -> dict:
        """Create a new UPC batch."""
        response = self.db.table(self.table).insert({
            "batch_job_id": str(batch_job_id),
            "batch_number": batch_number,
            "status": "pending",
            "upc_count": upc_count,
            "processed_count": 0,
        }).execute()
        return response.data[0]
    
    def update_batch_status(
        self, 
        batch_id: UUID, 
        status: str, 
        processed_count: Optional[int] = None,
        error_message: Optional[str] = None,
        completed_at: Optional[datetime] = None
    ) -> None:
        """Update batch status."""
        update_data = {"status": status}
        if processed_count is not None:
            update_data["processed_count"] = processed_count
        if error_message is not None:
            update_data["error_message"] = error_message
        if completed_at:
            update_data["completed_at"] = completed_at.isoformat()
        
        self.db.table(self.table).update(update_data).eq("id", str(batch_id)).execute()
    
    def get_batch_job_id(self, batch_id: UUID) -> UUID:
        """Get the job ID for a batch."""
        batch = self.get_batch(batch_id)
        return UUID(batch["batch_job_id"])

