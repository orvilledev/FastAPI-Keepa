"""Batch processing service for UPCs."""
import asyncio
import logging
from typing import List, Dict, Any, Optional
from uuid import UUID
from datetime import datetime
from decimal import Decimal
from functools import partial
from fastapi import HTTPException
from app.database import get_supabase
from app.repositories.map_repository import MAPRepository
from app.repositories.supabase_read_all import read_all_paginated
from app.services.keepa_client import KeepaClient, MultiKeyKeepaClient
from app.services.price_analyzer import PriceAnalyzer
from app.services.csv_generator import CSVGenerator
from app.services.email_service import EmailService

logger = logging.getLogger(__name__)


class BatchProcessor:
    """Processes UPCs in batches through Keepa API."""
    
    def __init__(self):
        self.db = get_supabase()
        self.map_repo = MAPRepository(self.db)
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
        created_by: UUID,
        email_recipients: str = None,
    ) -> UUID:
        """
        Create a new batch job and split UPCs into batches.
        
        Args:
            job_name: Name of the job
            upcs: List of UPCs to process
            created_by: User ID who created the job
            email_recipients: Optional comma-separated email addresses for this job
            
        Returns:
            Batch job ID
        """
        # Split UPCs into batches
        batches = self.split_upcs_into_batches(upcs)
        total_batches = len(batches)
        
        # Create batch job
        insert_data = {
            "job_name": job_name,
            "status": "pending",
            "total_batches": total_batches,
            "completed_batches": 0,
            "created_by": str(created_by),
        }
        if email_recipients:
            insert_data["email_recipients"] = email_recipients
        
        job_response = self.db.table("batch_jobs").insert(insert_data).execute()
        
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
    
    async def _process_single_item(self, keepa_client: KeepaClient, item: dict, batch_data: dict) -> bool:
        """Process a single UPC item with a given Keepa client."""
        upc = item["upc"]
        item_id = item["id"]
        
        try:
            logger.info(f"[Key {keepa_client.key_index}] Processing UPC: {upc} (item_id: {item_id})")
            self.db.table("upc_batch_items").update({
                "status": "processing"
            }).eq("id", item_id).execute()
            
            keepa_response = await keepa_client.fetch_product_data(upc)
            logger.info(f"[Key {keepa_client.key_index}] Keepa response for UPC {upc}: {'Success' if keepa_response else 'None/Empty'}")
            
            if keepa_response:
                map_price: Optional[Decimal] = None
                try:
                    map_row = self.map_repo.get_map_by_upc(upc)
                    mp = Decimal(str(map_row.get("map_price", 0)))
                    if mp > 0:
                        map_price = mp
                except HTTPException:
                    pass
                except Exception as e:
                    logger.debug(f"No MAP for UPC {upc}: {e}")

                analysis = self.price_analyzer.analyze_product(keepa_response, map_price=map_price)

                self.db.table("upc_batch_items").update({
                    "keepa_data": keepa_response,
                    "status": "completed",
                    "processed_at": datetime.utcnow().isoformat(),
                }).eq("id", item_id).execute()
                
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
            else:
                logger.warning(f"[Key {keepa_client.key_index}] No Keepa data returned for UPC {upc}")
                self.db.table("upc_batch_items").update({
                    "status": "completed",
                    "error_message": "No data found in Keepa",
                    "processed_at": datetime.utcnow().isoformat(),
                }).eq("id", item_id).execute()
            
            return True
            
        except Exception as e:
            logger.error(f"[Key {keepa_client.key_index}] Error processing UPC {upc}: {type(e).__name__}: {str(e)}", exc_info=True)
            self.db.table("upc_batch_items").update({
                "status": "failed",
                "error_message": str(e),
                "processed_at": datetime.utcnow().isoformat(),
            }).eq("id", item_id).execute()
            return True  # Count as processed (attempted)

    async def process_batch(self, batch_id: UUID) -> bool:
        """
        Process a single UPC batch using multiple API keys in parallel.
        
        Args:
            batch_id: UUID of the UPC batch
            
        Returns:
            True if batch processed successfully, False otherwise
        """
        try:
            batch_response = self.db.table("upc_batches").select("*").eq("id", str(batch_id)).execute()
            if not batch_response.data:
                logger.error(f"Batch {batch_id} not found")
                return False
            
            batch_data = batch_response.data[0]
            
            if batch_data.get("status") == "cancelled":
                logger.info(f"Batch {batch_id} is already cancelled, skipping processing")
                return False
            
            self.db.table("upc_batches").update({
                "status": "processing"
            }).eq("id", str(batch_id)).execute()
            
            items_response = self.db.table("upc_batch_items").select("*").eq(
                "upc_batch_id", str(batch_id)
            ).execute()
            
            items = items_response.data
            
            if not items or len(items) == 0:
                logger.error(f"No items found for batch {batch_id}.")
                self.db.table("upc_batches").update({
                    "status": "failed",
                    "error_message": "No batch items found to process",
                }).eq("id", str(batch_id)).execute()
                return False
            
            logger.info(f"Starting to process {len(items)} UPCs in batch {batch_id} using multiple API keys")
            
            multi_client = MultiKeyKeepaClient()
            
            async def process_fn(keepa_client, item):
                return await self._process_single_item(keepa_client, item, batch_data)
            
            processed_count = await multi_client.process_items_parallel(
                items=items,
                process_fn=process_fn,
                batch_id=batch_id,
                db=self.db,
            )
            
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
            
            # Get all batches (paginate past PostgREST ~1000 row default)
            batches = read_all_paginated(
                lambda start, end: self.db.table("upc_batches")
                .select("id, upc_count")
                .eq("batch_job_id", str(job_id))
                .order("batch_number")
                .range(start, end)
                .execute()
            )
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
            
            # Mark job as completed immediately — email is just notification
            self.db.table("batch_jobs").update({
                "status": "completed",
                "completed_at": datetime.utcnow().isoformat(),
            }).eq("id", str(job_id)).execute()
            
            logger.info(f"Job {job_id} completed successfully")
            
            # Generate CSV report and send email (non-blocking)
            try:
                from app.services.report_service import ReportService
                
                job_response = self.db.table("batch_jobs").select("*").eq("id", str(job_id)).execute()
                job_data = job_response.data[0]
                job_name = job_data["job_name"]
                custom_recipients = job_data.get("email_recipients")
                
                report_service = ReportService(self.db)
                csv_bytes, filename, off_price_count = report_service.generate_csv_for_job(job_id, job_name)
                
                total_upcs = sum(batch["upc_count"] for batch in batches)
                
                send_to = custom_recipients or self.email_service.email_to
                logger.info(f"Preparing to send email for job {job_id}: {total_upcs} UPCs, {off_price_count} off-price listings")
                logger.info(f"Email recipients: {send_to} (custom={bool(custom_recipients)})")
                
                loop = asyncio.get_event_loop()
                email_sent = await loop.run_in_executor(
                    None,
                    partial(
                        self.email_service.send_csv_report,
                        csv_bytes=csv_bytes,
                        filename=filename,
                        job_name=job_name,
                        total_upcs=total_upcs,
                        alerts_count=off_price_count,
                        recipient_email=custom_recipients,
                    ),
                )
                
                if email_sent:
                    logger.info(f"Email sent successfully for job {job_id} to {send_to}")
                else:
                    logger.error(f"Failed to send email for job {job_id}.")
                    if getattr(self.email_service, "last_error", None):
                        logger.error(f"Email error: {self.email_service.last_error}")
            except Exception as email_err:
                logger.error(f"Email sending failed for job {job_id}: {email_err}", exc_info=True)
            
            return True
            
        except Exception as e:
            logger.error(f"Error processing job {job_id}: {e}")
            self.db.table("batch_jobs").update({
                "status": "failed",
                "error_message": str(e),
            }).eq("id", str(job_id)).execute()
            return False

