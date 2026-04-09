"""Repository for batch job database operations."""
import logging
from typing import List, Optional
from uuid import UUID
from supabase import Client
from fastapi import HTTPException
from datetime import datetime

from app.repositories.supabase_read_all import read_all_paginated

logger = logging.getLogger(__name__)

# Large JSONB rows (keepa_data) can exceed Postgres statement_timeout if deleted in one CASCADE.
_DELETE_CHUNK_SIZE = 150


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
    
    def update_job(
        self,
        job_id: UUID,
        job_name: Optional[str] = None,
        description: Optional[str] = None,
        email_recipients: Optional[str] = None
    ) -> dict:
        """Update job information."""
        update_data = {}
        if job_name is not None:
            update_data["job_name"] = job_name
        if description is not None:
            update_data["description"] = description if description.strip() else None
        if email_recipients is not None:
            update_data["email_recipients"] = email_recipients if email_recipients.strip() else None
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        response = self.db.table(self.table).update(update_data).eq("id", str(job_id)).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Job not found")
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
        return read_all_paginated(
            lambda start, end: self.db.table("upc_batches")
            .select("id, batch_number, status, processed_count, upc_count")
            .eq("batch_job_id", str(job_id))
            .order("batch_number")
            .range(start, end)
            .execute()
        )

    def _delete_in_chunks_by_eq(
        self, table: str, filter_column: str, filter_value: str
    ) -> int:
        """
        Delete rows where filter_column = filter_value, in small batches.
        Returns number of rows removed.
        """
        removed = 0
        chunk = _DELETE_CHUNK_SIZE
        while True:
            resp = (
                self.db.table(table)
                .select("id")
                .eq(filter_column, filter_value)
                .order("id")
                .range(0, chunk - 1)
                .execute()
            )
            rows = resp.data or []
            if not rows:
                break
            ids = [str(r["id"]) for r in rows]
            self.db.table(table).delete().in_("id", ids).execute()
            removed += len(ids)
            if len(rows) < chunk:
                break
        return removed

    def delete_job(self, job_id: UUID) -> None:
        """
        Delete a job and all related data.

        Uses chunked deletes so Postgres does not hit statement_timeout on
        huge CASCADE (JSONB on price_alerts / upc_batch_items).
        """
        self.get_job(job_id)
        jid = str(job_id)

        n_alerts = self._delete_in_chunks_by_eq("price_alerts", "batch_job_id", jid)
        if n_alerts:
            logger.info("Deleted %s price_alerts rows for job %s", n_alerts, jid)

        batch_rows = read_all_paginated(
            lambda start, end: self.db.table("upc_batches")
            .select("id")
            .eq("batch_job_id", jid)
            .order("id")
            .range(start, end)
            .execute()
        )
        n_items = 0
        for batch in batch_rows:
            bid = str(batch["id"])
            n_items += self._delete_in_chunks_by_eq("upc_batch_items", "upc_batch_id", bid)
        if n_items:
            logger.info("Deleted %s upc_batch_items rows for job %s", n_items, jid)

        n_batches = self._delete_in_chunks_by_eq("upc_batches", "batch_job_id", jid)
        if n_batches:
            logger.info("Deleted %s upc_batches rows for job %s", n_batches, jid)

        self.db.table(self.table).delete().eq("id", jid).execute()

