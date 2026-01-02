"""APScheduler setup for daily automated job execution."""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import logging
from pytz import timezone
from app.config import settings
from app.database import get_supabase
from app.services.batch_processor import BatchProcessor
from typing import List

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()
# Taipei timezone (UTC+8)
TAIPEI_TZ = timezone('Asia/Taipei')


async def run_daily_job():
    """Execute daily batch job at 8 PM Taipei time."""
    try:
        from datetime import datetime
        taipei_time = datetime.now(TAIPEI_TZ)
        logger.info(f"Starting daily batch job execution at {taipei_time.strftime('%Y-%m-%d %H:%M:%S %Z')} Taipei time")
        
        db = get_supabase()
        processor = BatchProcessor()
        
        # Get all UPCs from the upcs table
        upcs_response = db.table("upcs").select("upc").execute()
        upcs = [upc["upc"] for upc in upcs_response.data]
        
        if not upcs:
            logger.warning("No UPCs found to process")
            return
        
        logger.info(f"Found {len(upcs)} UPCs to process")
        
        # Get admin user ID (or system user)
        profiles_response = db.table("profiles").select("id").eq("role", "admin").limit(1).execute()
        
        if not profiles_response.data:
            logger.error("No admin user found for automated job")
            return
        
        admin_id = profiles_response.data[0]["id"]
        
        # Create and process job
        from uuid import UUID
        job_name = f"Daily Keepa Report - {taipei_time.strftime('%Y-%m-%d %H:%M')} (Taipei)"
        job_id = await processor.create_batch_job(
            job_name=job_name,
            upcs=upcs,
            created_by=UUID(admin_id)
        )
        
        logger.info(f"Created batch job {job_id} with {len(upcs)} UPCs. Processing...")
        
        # Process job (this will automatically send email when complete)
        await processor.process_job(job_id)
        
        logger.info(f"Daily batch job {job_id} completed successfully")
        
    except Exception as e:
        logger.error(f"Error executing daily batch job: {e}", exc_info=True)


def setup_scheduler():
    """Setup and start the scheduler."""
    # Schedule daily job at 8 PM Taipei time (20:00)
    # Using timezone-aware scheduling
    scheduler.add_job(
        run_daily_job,
        trigger=CronTrigger(hour=20, minute=0, timezone=TAIPEI_TZ),
        id="daily_keepa_job",
        name="Daily Keepa Price Alert Job - 8 PM Taipei",
        replace_existing=True,
    )
    
    logger.info(
        "Scheduler configured to run daily at 8:00 PM Taipei time (UTC+8)"
    )


def start_scheduler():
    """Start the scheduler."""
    if not scheduler.running:
        scheduler.start()
        logger.info("Scheduler started")


def shutdown_scheduler():
    """Shutdown the scheduler."""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Scheduler shutdown")

