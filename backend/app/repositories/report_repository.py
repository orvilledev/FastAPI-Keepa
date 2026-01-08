"""Repository for report and price alert database operations."""
from typing import List, Dict, Any
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
    
    def get_all_processed_upcs_for_job(self, job_id: UUID) -> List[dict]:
        """
        Get all processed UPCs for a job with their Keepa data.
        Returns list of upc_batch_items with keepa_data.
        """
        # Get all batches for this job
        batches_response = self.db.table("upc_batches").select("id").eq(
            "batch_job_id", str(job_id)
        ).execute()
        
        batch_ids = [batch["id"] for batch in batches_response.data]
        
        if not batch_ids:
            return []
        
        # Get all processed items with keepa_data
        all_items = []
        for batch_id in batch_ids:
            items_response = self.db.table("upc_batch_items").select(
                "upc, keepa_data, status"
            ).eq("upc_batch_id", batch_id).eq("status", "completed").execute()
            all_items.extend(items_response.data)
        
        return all_items
    
    def get_price_alerts_by_upc(self, job_id: UUID) -> Dict[str, List[dict]]:
        """
        Get price alerts grouped by UPC for quick lookup.
        Returns dict mapping UPC to list of price alerts.
        """
        alerts = self.get_price_alerts(job_id, order_desc=False)
        alerts_by_upc = {}
        for alert in alerts:
            upc = alert.get("upc")
            if upc:
                if upc not in alerts_by_upc:
                    alerts_by_upc[upc] = []
                alerts_by_upc[upc].append(alert)
        return alerts_by_upc
    
    def get_total_upcs_for_job(self, job_id: UUID) -> int:
        """Get total UPC count for a job from batches."""
        response = self.db.table("upc_batches").select("upc_count").eq(
            "batch_job_id", str(job_id)
        ).execute()
        return sum(batch["upc_count"] for batch in response.data)

