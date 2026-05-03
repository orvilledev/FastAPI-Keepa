"""Batch processing service for UPCs."""
import asyncio
import logging
import time
from typing import List, Dict, Optional
from uuid import UUID
from datetime import datetime
from decimal import Decimal
from functools import partial
from fastapi import HTTPException
from app.config import settings
from app.database import get_supabase
from app.repositories.map_repository import MAPRepository
from app.repositories.supabase_read_all import read_all_paginated
from app.utils.vendor_code import resolve_map_vendor_type
from app.utils.notifications import create_notification, create_completion_notifications_for_all_profiles
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
        self.db_retry_attempts = 3
        self.db_retry_base_delay = 1.0

    @staticmethod
    def _is_transient_db_error(error: Exception) -> bool:
        """Return True when Supabase/PostgREST failure appears transient."""
        message = str(error).lower()
        transient_markers = (
            "json could not be generated",
            "bad gateway",
            "502",
            "cloudflare",
            "gateway",
            "timed out",
            "timeout",
        )
        return any(marker in message for marker in transient_markers)

    def _execute_with_retry(self, operation, operation_name: str):
        """Execute a DB operation with retries for transient upstream errors."""
        for attempt in range(1, self.db_retry_attempts + 1):
            try:
                return operation()
            except Exception as error:
                is_retryable = self._is_transient_db_error(error)
                is_last_attempt = attempt >= self.db_retry_attempts
                if not is_retryable or is_last_attempt:
                    raise
                delay = self.db_retry_base_delay * (2 ** (attempt - 1))
                logger.warning(
                    f"{operation_name} failed with transient error "
                    f"(attempt {attempt}/{self.db_retry_attempts}): {error}. "
                    f"Retrying in {delay:.1f}s..."
                )
                time.sleep(delay)

    def _get_job_status(self, job_id: UUID) -> Optional[str]:
        """Load current job status (lowercased) for cancellation checks."""
        try:
            resp = self._execute_with_retry(
                lambda: self.db.table("batch_jobs").select("status").eq("id", str(job_id)).limit(1).execute(),
                "load job status",
            )
            if resp.data:
                return str(resp.data[0].get("status") or "").strip().lower()
        except Exception as e:
            logger.warning(f"Could not load job status for {job_id}: {e}")
        return None

    def _notify_job_event(
        self,
        *,
        user_id: str,
        notification_type: str,
        title: str,
        message: str,
        priority: str = "info",
        job_id: Optional[UUID] = None,
        metadata: Optional[Dict] = None,
        action_label: Optional[str] = None,
        action_url: Optional[str] = None,
    ) -> None:
        """Best-effort notification creation for job lifecycle events."""
        if not user_id:
            return
        try:
            create_notification(
                db=self.db,
                user_id=UUID(str(user_id)),
                notification_type=notification_type,
                title=title,
                message=message,
                priority=priority,
                related_id=job_id,
                related_type="job" if job_id else None,
                metadata=metadata or {},
                action_label=action_label,
                action_url=action_url,
            )
        except Exception as notify_err:
            logger.warning("Failed to create job notification: %s", notify_err)
    
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
        keepa_offers_limit: int = 0,
        map_vendor_type: Optional[str] = None,
        off_price_scope: str = "buybox_only",
    ) -> UUID:
        """
        Create a new batch job and split UPCs into batches.
        
        Args:
            job_name: Name of the job
            upcs: List of UPCs to process
            created_by: User ID who created the job
            email_recipients: Optional comma-separated email addresses for this job
            map_vendor_type: MAP vendor code (map_prices.vendor_type), e.g. dnk, clk, obz; None uses default (dnk)

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
            "map_vendor_type": resolve_map_vendor_type(map_vendor_type),
            "keepa_offers_limit": max(0, min(500, int(keepa_offers_limit))),
            "off_price_scope": off_price_scope or "buybox_only",
        }
        if email_recipients:
            insert_data["email_recipients"] = email_recipients
        
        job_response = self._execute_with_retry(
            lambda: self.db.table("batch_jobs").insert(insert_data).execute(),
            "create batch job",
        )
        
        job_id = UUID(job_response.data[0]["id"])
        
        # Create UPC batches and batch items
        for batch_num, batch_upcs in enumerate(batches, start=1):
            # Create UPC batch
            upc_batch_response = self._execute_with_retry(
                lambda: self.db.table("upc_batches").insert({
                    "batch_job_id": str(job_id),
                    "batch_number": batch_num,
                    "status": "pending",
                    "upc_count": len(batch_upcs),
                    "processed_count": 0,
                }).execute(),
                "create upc batch",
            )
            
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
            
            self._execute_with_retry(
                lambda: self.db.table("upc_batch_items").insert(batch_items).execute(),
                "create upc batch items",
            )
        
        logger.info(f"Created batch job {job_id} with {total_batches} batches")
        return job_id
    
    async def _process_single_item(
        self,
        keepa_client: KeepaClient,
        item: dict,
        batch_data: dict,
        map_vendor_type: str,
        off_price_scope: str,
        map_prices_by_upc: Optional[Dict[str, Decimal]] = None,
    ) -> bool:
        """Process a single UPC item with a given Keepa client."""
        upc = item["upc"]
        item_id = item["id"]
        
        try:
            logger.info(f"[Key {keepa_client.key_index}] Processing UPC: {upc} (item_id: {item_id})")
            self._execute_with_retry(
                lambda: self.db.table("upc_batch_items").update({
                    "status": "processing"
                }).eq("id", item_id).execute(),
                "mark batch item processing",
            )
            
            keepa_response = await keepa_client.fetch_product_data(upc)
            logger.info(f"[Key {keepa_client.key_index}] Keepa response for UPC {upc}: {'Success' if keepa_response else 'None/Empty'}")
            
            if keepa_response:
                map_price: Optional[Decimal] = (
                    (map_prices_by_upc or {}).get(upc)
                    if map_prices_by_upc is not None
                    else None
                )
                if map_price is None:
                    try:
                        map_row = self.map_repo.get_map_by_upc(upc, vendor_type=map_vendor_type)
                        mp = Decimal(str(map_row.get("map_price", 0)))
                        if mp > 0:
                            map_price = mp
                    except HTTPException:
                        pass
                    except Exception as e:
                        logger.debug(f"No MAP for UPC {upc}: {e}")

                analysis = self.price_analyzer.analyze_product(
                    keepa_response,
                    map_price=map_price,
                    off_price_scope=off_price_scope,
                )

                self._execute_with_retry(
                    lambda: self.db.table("upc_batch_items").update({
                        "keepa_data": keepa_response,
                        "status": "completed",
                        "processed_at": datetime.utcnow().isoformat(),
                    }).eq("id", item_id).execute(),
                    "mark batch item completed",
                )
                
                batch_job_id = batch_data["batch_job_id"]
                for seller in analysis.get("off_price_sellers", []):
                    self._execute_with_retry(
                        lambda: self.db.table("price_alerts").insert({
                            "batch_job_id": batch_job_id,
                            "upc": upc,
                            "seller_name": seller.get("seller_name"),
                            "current_price": float(seller.get("current_price", 0)),
                            "historical_price": float(seller.get("historical_price", 0)),
                            "price_change_percent": float(seller.get("price_change_percent", 0)),
                            "keepa_data": keepa_response,
                        }).execute(),
                        "insert price alert",
                    )
            else:
                logger.warning(f"[Key {keepa_client.key_index}] No Keepa data returned for UPC {upc}")
                self._execute_with_retry(
                    lambda: self.db.table("upc_batch_items").update({
                        "status": "completed",
                        "error_message": "No data found in Keepa",
                        "processed_at": datetime.utcnow().isoformat(),
                    }).eq("id", item_id).execute(),
                    "mark batch item no data",
                )
            
            return True
            
        except Exception as e:
            logger.error(f"[Key {keepa_client.key_index}] Error processing UPC {upc}: {type(e).__name__}: {str(e)}", exc_info=True)
            error_message = str(e)
            self._execute_with_retry(
                lambda: self.db.table("upc_batch_items").update({
                    "status": "failed",
                    "error_message": error_message,
                    "processed_at": datetime.utcnow().isoformat(),
                }).eq("id", item_id).execute(),
                "mark batch item failed",
            )
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
            batch_response = self._execute_with_retry(
                lambda: self.db.table("upc_batches").select("*").eq("id", str(batch_id)).execute(),
                "load upc batch",
            )
            if not batch_response.data:
                logger.error(f"Batch {batch_id} not found")
                return False
            
            batch_data = batch_response.data[0]

            job_vendor = resolve_map_vendor_type(None)
            job_offers_limit: Optional[int] = None
            job_off_price_scope = "buybox_only"
            job_id_for_batch = batch_data.get("batch_job_id")
            if job_id_for_batch:
                job_row = self._execute_with_retry(
                    lambda: (
                        self.db.table("batch_jobs")
                        .select("map_vendor_type, keepa_offers_limit, off_price_scope")
                        .eq("id", str(job_id_for_batch))
                        .limit(1)
                        .execute()
                    ),
                    "load job vendor type",
                )
                if job_row.data:
                    job_vendor = resolve_map_vendor_type(job_row.data[0].get("map_vendor_type"))
                    raw_offers_limit = job_row.data[0].get("keepa_offers_limit")
                    raw_off_price_scope = job_row.data[0].get("off_price_scope")
                    if raw_off_price_scope in {"buybox_only", "buybox_and_non_buybox_below_map"}:
                        job_off_price_scope = raw_off_price_scope
                    if raw_offers_limit is None:
                        raise ValueError(
                            "Missing keepa_offers_limit on batch job. "
                            "Per-job offers limit is required and fallback is disabled."
                        )
                    try:
                        job_offers_limit = max(0, min(500, int(raw_offers_limit)))
                    except Exception as parse_err:
                        raise ValueError(
                            f"Invalid keepa_offers_limit value on batch job: {raw_offers_limit}"
                        ) from parse_err

            if job_offers_limit is None:
                raise ValueError(
                    "Could not resolve keepa_offers_limit for this batch job."
                )

            if batch_data.get("status") == "cancelled":
                logger.info(f"Batch {batch_id} is already cancelled, skipping processing")
                return False
            
            self._execute_with_retry(
                lambda: self.db.table("upc_batches").update({
                    "status": "processing"
                }).eq("id", str(batch_id)).execute(),
                "mark batch processing",
            )
            
            items_response = self._execute_with_retry(
                lambda: self.db.table("upc_batch_items").select("*").eq(
                    "upc_batch_id", str(batch_id)
                ).execute(),
                "load batch items",
            )
            
            items = items_response.data
            
            if not items or len(items) == 0:
                logger.error(f"No items found for batch {batch_id}.")
                self._execute_with_retry(
                    lambda: self.db.table("upc_batches").update({
                        "status": "failed",
                        "error_message": "No batch items found to process",
                    }).eq("id", str(batch_id)).execute(),
                    "mark batch failed no items",
                )
                return False
            
            logger.info(f"Starting to process {len(items)} UPCs in batch {batch_id} using multiple API keys")
            
            upcs_for_batch = [str(i.get("upc", "")).strip() for i in items if i.get("upc")]
            map_prices_by_upc = self.map_repo.get_map_prices_by_upcs(
                upcs_for_batch,
                vendor_type=job_vendor,
            )
            logger.info(
                "Preloaded MAP prices for %s/%s UPCs in batch %s",
                len(map_prices_by_upc),
                len(upcs_for_batch),
                batch_id,
            )

            multi_client = MultiKeyKeepaClient()
            
            async def process_fn(keepa_client, item):
                return await self._process_single_item(
                    keepa_client,
                    item,
                    batch_data,
                    job_vendor,
                    job_off_price_scope,
                    map_prices_by_upc=map_prices_by_upc,
                )
            
            processed_count = await multi_client.process_items_parallel(
                items=items,
                process_fn=process_fn,
                batch_id=batch_id,
                db=self.db,
                offers_limit=job_offers_limit,
            )

            final_batch_status = self._execute_with_retry(
                lambda: self.db.table("upc_batches").select("status").eq("id", str(batch_id)).limit(1).execute(),
                "reload batch status",
            )
            if final_batch_status.data and final_batch_status.data[0].get("status") == "cancelled":
                logger.info(f"Batch {batch_id} was cancelled during processing; skipping completion update")
                return False

            self._execute_with_retry(
                lambda: self.db.table("upc_batches").update({
                    "status": "completed",
                    "processed_count": processed_count,
                    "completed_at": datetime.utcnow().isoformat(),
                }).eq("id", str(batch_id)).execute(),
                "mark batch completed",
            )
            
            logger.info(f"Batch {batch_id} processed successfully ({processed_count} items)")
            return True
            
        except Exception as e:
            logger.error(f"Error processing batch {batch_id}: {e}")
            error_message = str(e)
            self._execute_with_retry(
                lambda: self.db.table("upc_batches").update({
                    "status": "failed",
                    "error_message": error_message,
                }).eq("id", str(batch_id)).execute(),
                "mark batch failed",
            )
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
            self._execute_with_retry(
                lambda: self.db.table("batch_jobs").update({
                    "status": "processing"
                }).eq("id", str(job_id)).execute(),
                "mark job processing",
            )
            
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
                latest_status = self._get_job_status(job_id)
                if latest_status == "cancelled":
                    logger.info(f"Job {job_id} was cancelled; stopping remaining batches")
                    break

                batch_id = UUID(batch["id"])
                success = await self.process_batch(batch_id)
                
                if success:
                    completed_batches += 1
                    # Update job progress
                    self.db.table("batch_jobs").update({
                        "completed_batches": completed_batches
                    }).eq("id", str(job_id)).execute()
                
                # Optional delay between batches (set to 0 for fastest throughput)
                inter_delay = max(0.0, float(settings.batch_inter_delay_seconds))
                if inter_delay > 0:
                    await asyncio.sleep(inter_delay)

            final_job_status = self._get_job_status(job_id)
            if final_job_status == "cancelled":
                logger.info(f"Job {job_id} remains cancelled; skipping completion + report/email")
                try:
                    cancelled_job_resp = self._execute_with_retry(
                        lambda: self.db.table("batch_jobs").select("id, job_name, created_by").eq("id", str(job_id)).limit(1).execute(),
                        "load cancelled job metadata",
                    )
                    if cancelled_job_resp.data:
                        cancelled_job = cancelled_job_resp.data[0]
                        self._notify_job_event(
                            user_id=cancelled_job.get("created_by"),
                            notification_type="run_cancelled",
                            title=f"Run cancelled: {cancelled_job.get('job_name', 'Express Job')}",
                            message="The run was cancelled before completion.",
                            priority="warning",
                            job_id=job_id,
                            action_label="View Dashboard",
                            action_url="/dashboard",
                        )
                except Exception as cancel_notify_err:
                    logger.warning("Could not notify cancelled run for %s: %s", job_id, cancel_notify_err)
                return True
            if final_job_status is None:
                logger.info(f"Job {job_id} no longer exists; skipping completion + report/email")
                return True

            # Mark job as completed immediately — email is just notification
            self._execute_with_retry(
                lambda: self.db.table("batch_jobs").update({
                    "status": "completed",
                    "completed_at": datetime.utcnow().isoformat(),
                }).eq("id", str(job_id)).execute(),
                "mark job completed",
            )
            
            logger.info(f"Job {job_id} completed successfully")

            post_complete_status = self._get_job_status(job_id)
            if post_complete_status != "completed":
                logger.info(
                    f"Job {job_id} status is {post_complete_status!r} after completion update; "
                    "skipping report/email notification"
                )
                return True
            
            # Generate report and send email (failures logged separately)
            from app.services.report_service import ReportService

            job_response = self._execute_with_retry(
                lambda: self.db.table("batch_jobs").select("*").eq("id", str(job_id)).execute(),
                "load completed job metadata",
            )
            job_data = job_response.data[0]
            job_name = job_data["job_name"]
            job_creator = job_data.get("created_by")
            custom_recipients = job_data.get("email_recipients")
            total_upcs = sum(batch["upc_count"] for batch in batches)
            job_map_vendor = resolve_map_vendor_type(job_data.get("map_vendor_type"))
            job_off_price_scope = job_data.get("off_price_scope") or "buybox_only"

            try:
                report_service = ReportService(self.db)
                csv_bytes, filename, off_price_count = report_service.generate_csv_for_job(
                    job_id,
                    job_name,
                    map_vendor_type=job_map_vendor,
                    off_price_scope=job_off_price_scope,
                )
            except Exception as report_err:
                logger.error(
                    f"Report generation failed for job {job_id}: {report_err}",
                    exc_info=True,
                )
            else:
                send_to = custom_recipients or self.email_service.email_to
                logger.info(
                    f"Preparing to send email for job {job_id}: {total_upcs} UPCs, "
                    f"{off_price_count} off-price listings"
                )
                logger.info(f"Email recipients: {send_to} (custom={bool(custom_recipients)})")

                try:
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
                except Exception as email_err:
                    logger.error(
                        f"Email sending failed for job {job_id}: {email_err}",
                        exc_info=True,
                    )
                else:
                    if email_sent:
                        logger.info(f"Email sent successfully for job {job_id} to {send_to}")
                    else:
                        logger.error(f"Failed to send email for job {job_id}.")
                        if getattr(self.email_service, "last_error", None):
                            logger.error(f"Email error: {self.email_service.last_error}")

            completion_meta = {
                "job_name": job_name,
                "total_upcs": total_upcs,
                "completed_batches": completed_batches,
                "off_price_scope": job_off_price_scope,
                "created_by": str(job_creator) if job_creator else None,
            }
            initiated = job_data.get("initiated_by")
            if initiated:
                completion_meta["initiated_by"] = initiated
            create_completion_notifications_for_all_profiles(
                self.db,
                notification_type="run_completed",
                title=f"Run completed: {job_name}",
                message=f"Run finished successfully ({total_upcs} UPCs processed). Visible to the whole team.",
                priority="info",
                related_id=job_id,
                related_type="job",
                metadata=completion_meta,
                action_label="View Express Jobs",
                action_url="/jobs",
            )
            
            return True
            
        except Exception as e:
            logger.error(f"Error processing job {job_id}: {e}")
            if self._get_job_status(job_id) == "cancelled":
                logger.info(f"Job {job_id} is cancelled; skipping failure overwrite")
                return False
            error_message = str(e)
            self._execute_with_retry(
                lambda: self.db.table("batch_jobs").update({
                    "status": "failed",
                    "error_message": error_message,
                }).eq("id", str(job_id)).execute(),
                "mark job failed",
            )
            try:
                failed_job_resp = self._execute_with_retry(
                    lambda: self.db.table("batch_jobs").select("id, job_name, created_by").eq("id", str(job_id)).limit(1).execute(),
                    "load failed job metadata",
                )
                if failed_job_resp.data:
                    failed_job = failed_job_resp.data[0]
                    self._notify_job_event(
                        user_id=failed_job.get("created_by"),
                        notification_type="run_failed",
                        title=f"Run failed: {failed_job.get('job_name', 'Express Job')}",
                        message=f"Express job failed. Reason: {error_message}",
                        priority="critical",
                        job_id=job_id,
                        metadata={"error_message": error_message},
                        action_label="View Dashboard",
                        action_url="/dashboard",
                    )
            except Exception as fail_notify_err:
                logger.warning("Could not notify failed run for %s: %s", job_id, fail_notify_err)
            return False

