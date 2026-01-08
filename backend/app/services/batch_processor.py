"""Batch processing service for UPCs."""
import asyncio
import logging
from typing import List, Dict, Any
from uuid import UUID
from datetime import datetime
from app.database import get_supabase
from app.services.keepa_client import KeepaClient
from app.services.price_analyzer import PriceAnalyzer
from app.services.csv_generator import CSVGenerator
from app.services.email_service import EmailService

logger = logging.getLogger(__name__)


class BatchProcessor:
    """Processes UPCs in batches through Keepa API."""
    
    def __init__(self):
        self.db = get_supabase()
        self.price_analyzer = PriceAnalyzer()
        self.csv_generator = CSVGenerator()
        self.email_service = EmailService()
        self.batch_size = 119  # ~119 UPCs per batch (2500 / 21 ≈ 119)
        self.total_batches = 21
    
    def split_upcs_into_batches(self, upcs: List[str]) -> List[List[str]]:
        """
        Split list of UPCs into batches.
        
        Args:
            upcs: List of UPC codes
            
        Returns:
            List of batches, each containing up to batch_size UPCs
        """
        batches = []
        for i in range(0, len(upcs), self.batch_size):
            batch = upcs[i:i + self.batch_size]
            batches.append(batch)
        return batches
    
    async def create_batch_job(
        self,
        job_name: str,
        upcs: List[str],
        created_by: UUID
    ) -> UUID:
        """
        Create a new batch job and split UPCs into batches.
        
        Args:
            job_name: Name of the job
            upcs: List of UPCs to process
            created_by: User ID who created the job
            
        Returns:
            Batch job ID
        """
        # Split UPCs into batches
        batches = self.split_upcs_into_batches(upcs)
        total_batches = len(batches)
        
        # Create batch job
        job_response = self.db.table("batch_jobs").insert({
            "job_name": job_name,
            "status": "pending",
            "total_batches": total_batches,
            "completed_batches": 0,
            "created_by": str(created_by),
        }).execute()
        
        job_id = UUID(job_response.data[0]["id"])
        
        # Create UPC batches and batch items
        for batch_num, batch_upcs in enumerate(batches, start=1):
            # Create UPC batch
            upc_batch_response = self.db.table("upc_batches").insert({
                "batch_job_id": str(job_id),
                "batch_number": batch_num,
                "status": "pending",
                "upc_count": len(batch_upcs),
                "processed_count": 0,
            }).execute()
            
            upc_batch_id = UUID(upc_batch_response.data[0]["id"])
            
            # Create batch items
            batch_items = [
                {
                    "upc_batch_id": str(upc_batch_id),
                    "upc": upc,
                    "status": "pending",
                }
                for upc in batch_upcs
            ]
            
            self.db.table("upc_batch_items").insert(batch_items).execute()
        
        logger.info(f"Created batch job {job_id} with {total_batches} batches")
        return job_id
    
    async def process_batch(self, batch_id: UUID) -> bool:
        """
        Process a single UPC batch.
        
        Args:
            batch_id: UUID of the UPC batch
            
        Returns:
            True if batch processed successfully, False otherwise
        """
        try:
            # Get batch data
            batch_response = self.db.table("upc_batches").select("*").eq("id", str(batch_id)).execute()
            if not batch_response.data:
                logger.error(f"Batch {batch_id} not found")
                return False
            
            batch_data = batch_response.data[0]
            
            # Check if batch is already cancelled
            if batch_data.get("status") == "cancelled":
                logger.info(f"Batch {batch_id} is already cancelled, skipping processing")
                return False
            
            # Update batch status
            self.db.table("upc_batches").update({
                "status": "processing"
            }).eq("id", str(batch_id)).execute()
            
            # Get batch items
            items_response = self.db.table("upc_batch_items").select("*").eq(
                "upc_batch_id", str(batch_id)
            ).execute()
            
            items = items_response.data
            processed_count = 0
            
            # Check if items exist
            if not items or len(items) == 0:
                logger.error(f"No items found for batch {batch_id}. Batch items query returned empty.")
                self.db.table("upc_batches").update({
                    "status": "failed",
                    "error_message": "No batch items found to process",
                }).eq("id", str(batch_id)).execute()
                return False
            
            # Process each UPC with Keepa API
            logger.info(f"Starting to process {len(items)} UPCs in batch {batch_id}")
            async with KeepaClient() as keepa_client:
                for item in items:
                    # Check if batch has been cancelled
                    batch_check = self.db.table("upc_batches").select("status").eq("id", str(batch_id)).execute()
                    if batch_check.data and batch_check.data[0].get("status") == "cancelled":
                        logger.info(f"Batch {batch_id} was cancelled, stopping processing")
                        # Update processed count before stopping
                        self.db.table("upc_batches").update({
                            "processed_count": processed_count,
                        }).eq("id", str(batch_id)).execute()
                        return False
                    
                    upc = item["upc"]
                    item_id = item["id"]
                    
                    try:
                        logger.info(f"Processing UPC: {upc} (item_id: {item_id})")
                        # Update item status
                        self.db.table("upc_batch_items").update({
                            "status": "processing"
                        }).eq("id", item_id).execute()
                        
                        # Fetch Keepa data
                        logger.info(f"Fetching Keepa data for UPC: {upc}")
                        keepa_response = await keepa_client.fetch_product_data(upc)
                        logger.info(f"Keepa API response for UPC {upc}: {'Success' if keepa_response else 'None/Empty'}")
                        
                        if keepa_response:
                            # Analyze for off-price sellers
                            analysis = self.price_analyzer.analyze_product(keepa_response)
                            
                            # Update item with Keepa data
                            self.db.table("upc_batch_items").update({
                                "keepa_data": keepa_response,
                                "status": "completed",
                                "processed_at": datetime.utcnow().isoformat(),
                            }).eq("id", item_id).execute()
                            
                            # Store price alerts
                            batch_job_id = batch_data["batch_job_id"]
                            for seller in analysis.get("off_price_sellers", []):
                                self.db.table("price_alerts").insert({
                                    "batch_job_id": batch_job_id,
                                    "upc": upc,
                                    "seller_name": seller.get("seller_name"),
                                    "current_price": float(seller.get("current_price", 0)),
                                    "historical_price": float(seller.get("historical_price", 0)),
                                    "price_change_percent": float(seller.get("price_change_percent", 0)),
                                    "keepa_data": keepa_response,
                                }).execute()
                            
                            processed_count += 1
                            logger.info(f"Successfully processed UPC {upc}, processed_count now: {processed_count}")
                        else:
                            # No data found
                            logger.warning(f"No Keepa data returned for UPC {upc}")
                            self.db.table("upc_batch_items").update({
                                "status": "completed",
                                "error_message": "No data found in Keepa",
                                "processed_at": datetime.utcnow().isoformat(),
                            }).eq("id", item_id).execute()
                            processed_count += 1
                            logger.info(f"Marked UPC {upc} as completed (no data), processed_count now: {processed_count}")
                            
                    except Exception as e:
                        logger.error(f"Error processing UPC {upc}: {type(e).__name__}: {str(e)}", exc_info=True)
                        self.db.table("upc_batch_items").update({
                            "status": "failed",
                            "error_message": str(e),
                            "processed_at": datetime.utcnow().isoformat(),
                        }).eq("id", item_id).execute()
                        processed_count += 1  # Count failed attempts too
                        logger.info(f"Marked UPC {upc} as failed, processed_count now: {processed_count}")
            
            # Update batch status
            self.db.table("upc_batches").update({
                "status": "completed",
                "processed_count": processed_count,
                "completed_at": datetime.utcnow().isoformat(),
            }).eq("id", str(batch_id)).execute()
            
            logger.info(f"Batch {batch_id} processed successfully ({processed_count} items)")
            return True
            
        except Exception as e:
            logger.error(f"Error processing batch {batch_id}: {e}")
            self.db.table("upc_batches").update({
                "status": "failed",
                "error_message": str(e),
            }).eq("id", str(batch_id)).execute()
            return False
    
    async def process_job(self, job_id: UUID) -> bool:
        """
        Process all batches in a job sequentially.
        
        Args:
            job_id: UUID of the batch job
            
        Returns:
            True if job processed successfully, False otherwise
        """
        try:
            # Update job status
            self.db.table("batch_jobs").update({
                "status": "processing"
            }).eq("id", str(job_id)).execute()
            
            # Get all batches for this job
            batches_response = self.db.table("upc_batches").select("id, upc_count").eq(
                "batch_job_id", str(job_id)
            ).order("batch_number").execute()
            
            batches = batches_response.data
            completed_batches = 0
            
            # Process batches sequentially with rate limiting
            for batch in batches:
                batch_id = UUID(batch["id"])
                success = await self.process_batch(batch_id)
                
                if success:
                    completed_batches += 1
                    # Update job progress
                    self.db.table("batch_jobs").update({
                        "completed_batches": completed_batches
                    }).eq("id", str(job_id)).execute()
                
                # Rate limiting delay between batches (1-2 seconds)
                await asyncio.sleep(1.5)
            
            # Generate comprehensive CSV report using ReportService
            from app.services.report_service import ReportService
            
            job_response = self.db.table("batch_jobs").select("*").eq("id", str(job_id)).execute()
            job_data = job_response.data[0]
            job_name = job_data["job_name"]
            
            report_service = ReportService(self.db)
            csv_bytes, filename = report_service.generate_csv_for_job(job_id, job_name)
            
            # Get alerts count for email
            alerts_response = self.db.table("price_alerts").select("*").eq(
                "batch_job_id", str(job_id)
            ).execute()
            alerts = alerts_response.data
            
            # Send email with CSV
            total_upcs = sum(batch["upc_count"] for batch in batches)
            
            logger.info(f"Preparing to send email for job {job_id}: {total_upcs} UPCs, {len(alerts)} alerts")
            logger.info(f"Email service configuration: from={self.email_service.email_from}, to={self.email_service.email_to}, host={self.email_service.smtp_host}")
            
            email_sent = self.email_service.send_csv_report(
                csv_bytes=csv_bytes,
                filename=filename,
                job_name=job_name,
                total_upcs=total_upcs,
                alerts_count=len(alerts)
            )
            
            if email_sent:
                logger.info(f"Email sent successfully for job {job_id} to {self.email_service.email_to}")
            else:
                logger.error(f"Failed to send email for job {job_id}. Check email configuration and logs above for details.")
                logger.error(f"Email config check: from={bool(self.email_service.email_from)}, password={'*' if self.email_service.email_password else 'MISSING'}, to={bool(self.email_service.email_to)}")
            
            # Update job status
            self.db.table("batch_jobs").update({
                "status": "completed",
                "completed_at": datetime.utcnow().isoformat(),
            }).eq("id", str(job_id)).execute()
            
            logger.info(f"Job {job_id} completed successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error processing job {job_id}: {e}")
            self.db.table("batch_jobs").update({
                "status": "failed",
                "error_message": str(e),
            }).eq("id", str(job_id)).execute()
            return False

