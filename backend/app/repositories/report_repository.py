"""Repository for report and price alert database operations."""
from typing import List
from uuid import UUID
from supabase import Client


class ReportRepository:
    """Repository for price_alerts table operations."""
    
    def __init__(self, db: Client):
        self.db = db
        self.table = "price_alerts"
    
    def get_price_alerts(self, job_id: UUID, order_desc: bool = True) -> List[dict]:
        """Get all price alerts for a job."""
        query = self.db.table(self.table).select("*").eq("batch_job_id", str(job_id))
        if order_desc:
            query = query.order("detected_at", desc=True)
        response = query.execute()
        return response.data
    
    def get_total_upcs_for_job(self, job_id: UUID) -> int:
        """Get total UPC count for a job from batches."""
        response = self.db.table("upc_batches").select("upc_count").eq(
            "batch_job_id", str(job_id)
        ).execute()
        return sum(batch["upc_count"] for batch in response.data)

