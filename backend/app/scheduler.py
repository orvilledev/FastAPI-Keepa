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
# Default timezone (can be changed via settings)
TAIPEI_TZ = timezone('Asia/Taipei')
CURRENT_TZ = TAIPEI_TZ  # Current timezone (can be updated)
CURRENT_HOUR = 20  # Current hour (can be updated)
CURRENT_MINUTE = 0  # Current minute (can be updated)


async def run_daily_job():
    """Execute daily batch job at scheduled time."""
    try:
        from datetime import datetime
        current_time = datetime.now(CURRENT_TZ)
        tz_name = str(CURRENT_TZ).split('/')[-1] if '/' in str(CURRENT_TZ) else str(CURRENT_TZ)
        logger.info(f"Starting daily batch job execution at {current_time.strftime('%Y-%m-%d %H:%M:%S %Z')} {tz_name} time")
        
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
        tz_name = str(CURRENT_TZ).split('/')[-1] if '/' in str(CURRENT_TZ) else str(CURRENT_TZ)
        job_name = f"Daily Keepa Report - {current_time.strftime('%Y-%m-%d %H:%M')} ({tz_name})"
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


def setup_scheduler(timezone_str: str = "Asia/Taipei", hour: int = 20, minute: int = 0):
    """Setup and start the scheduler."""
    global CURRENT_TZ, CURRENT_HOUR, CURRENT_MINUTE
    
    try:
        tz = timezone(timezone_str)
        CURRENT_TZ = tz
        CURRENT_HOUR = hour
        CURRENT_MINUTE = minute
    except Exception as e:
        logger.warning(f"Invalid timezone {timezone_str}, using default: {e}")
        tz = TAIPEI_TZ
        CURRENT_TZ = TAIPEI_TZ
        CURRENT_HOUR = 20
        CURRENT_MINUTE = 0
    
    # Schedule daily job
    # Using timezone-aware scheduling
    scheduler.add_job(
        run_daily_job,
        trigger=CronTrigger(hour=CURRENT_HOUR, minute=CURRENT_MINUTE, timezone=CURRENT_TZ),
        id="daily_keepa_job",
        name=f"Daily Keepa Price Alert Job - {CURRENT_HOUR:02d}:{CURRENT_MINUTE:02d} {timezone_str}",
        replace_existing=True,
    )
    
    logger.info(
        f"Scheduler configured to run daily at {CURRENT_HOUR:02d}:{CURRENT_MINUTE:02d} {timezone_str}"
    )


def update_scheduler_settings(timezone_str: str = "Asia/Taipei", hour: int = 20, minute: int = 0):
    """Update scheduler settings and reschedule the job."""
    global CURRENT_TZ, CURRENT_HOUR, CURRENT_MINUTE
    
    # Remove existing job
    try:
        scheduler.remove_job("daily_keepa_job")
    except Exception:
        pass  # Job might not exist
    
    # Setup with new settings
    setup_scheduler(timezone_str, hour, minute)


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

