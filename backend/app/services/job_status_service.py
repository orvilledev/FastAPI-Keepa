"""Service for managing job status updates."""
from uuid import UUID
from datetime import datetime
from supabase import Client
import logging

logger = logging.getLogger(__name__)


class JobStatusService:
    """Service for updating job status based on batch completion."""
    
    @staticmethod
    def update_job_status_if_all_batches_done(job_id: UUID, db: Client) -> None:
        """
        Check if all batches are done (cancelled, completed, or failed) and update job status accordingly.
        
        Args:
            job_id: UUID of the batch job
            db: Supabase client
        """
        try:
            # Get all batches for this job
            batches_response = db.table("upc_batches").select("status").eq(
                "batch_job_id", str(job_id)
            ).execute()
            
            batches = batches_response.data
            
            if not batches:
                return
            
            # Check if all batches are in a terminal state (not pending or processing)
            active_statuses = ["pending", "processing"]
            all_done = all(batch["status"] not in active_statuses for batch in batches)
            
            if all_done:
                # Get current job status
                job_response = db.table("batch_jobs").select("status").eq("id", str(job_id)).execute()
                current_status = job_response.data[0]["status"] if job_response.data else None
                
                # Only update if job is still processing
                if current_status == "processing":
                    # Count completed batches (including cancelled as "completed" for job purposes)
                    completed_count = len([b for b in batches if b["status"] in ["completed", "cancelled"]])
                    
                    # Update job status to completed
                    db.table("batch_jobs").update({
                        "status": "completed",
                        "completed_batches": completed_count,
                        "completed_at": datetime.utcnow().isoformat(),
                    }).eq("id", str(job_id)).execute()
                    
                    logger.info(f"Job {job_id} status updated to 'completed' - all batches are done")
        except Exception as e:
            logger.error(f"Error updating job status: {e}", exc_info=True)

