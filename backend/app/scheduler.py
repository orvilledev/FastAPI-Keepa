"""APScheduler setup for daily automated job execution."""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import logging
from pytz import timezone
from app.config import settings
from app.database import get_supabase
from app.services.batch_processor import BatchProcessor
from typing import List
from dataclasses import dataclass

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

@dataclass
class SchedulerConfig:
    """Configuration for the scheduler."""
    timezone: timezone
    hour: int
    minute: int
    category: str

# Default configurations for DNK and CLK
_scheduler_configs = {
    'dnk': SchedulerConfig(
        timezone=timezone('America/Chicago'),
        hour=6,
        minute=0,
        category='dnk'
    ),
    'clk': SchedulerConfig(
        timezone=timezone('America/Chicago'),
        hour=6,
        minute=0,
        category='clk'
    )
}


async def run_daily_job_for_category(category: str = 'dnk'):
    """Execute daily batch job for a specific category (DNK or CLK)."""
    try:
        from datetime import datetime
        config = _scheduler_configs.get(category, _scheduler_configs['dnk'])
        current_time = datetime.now(config.timezone)
        tz_name = str(config.timezone).split('/')[-1] if '/' in str(config.timezone) else str(config.timezone)
        logger.info(f"Starting {category.upper()} daily batch job execution at {current_time.strftime('%Y-%m-%d %H:%M:%S %Z')} {tz_name} time")
        
        db = get_supabase()
        processor = BatchProcessor()
        
        # Get admin user ID (or system user)
        profiles_response = db.table("profiles").select("id").eq("role", "admin").limit(1).execute()
        
        if not profiles_response.data:
            logger.error("No admin user found for automated job")
            return
        
        admin_id = profiles_response.data[0]["id"]
        from uuid import UUID
        admin_uuid = UUID(admin_id)

        # Process UPCs for the specified category
        upcs_response = db.table("upcs").select("upc").eq("category", category).execute()
        upcs = [upc["upc"] for upc in upcs_response.data]

        if upcs:
            logger.info(f"Found {len(upcs)} {category.upper()} UPCs to process")
            job_name = f"Daily {category.upper()} Orbit Report - {current_time.strftime('%Y-%m-%d %H:%M')} ({tz_name})"
            job_id = await processor.create_batch_job(
                job_name=job_name,
                upcs=upcs,
                created_by=admin_uuid
            )
            logger.info(f"Created {category.upper()} batch job {job_id} with {len(upcs)} UPCs. Processing...")
            await processor.process_job(job_id)
            logger.info(f"Daily {category.upper()} batch job {job_id} completed successfully")
        else:
            logger.info(f"No {category.upper()} UPCs found to process")
    except Exception as e:
        logger.error(f"Error executing {category.upper()} daily batch job: {e}", exc_info=True)


def setup_scheduler(timezone_str: str = "America/Chicago", hour: int = 6, minute: int = 0, category: str = 'dnk'):
    """Setup and start the scheduler for a specific category."""
    global _scheduler_configs

    try:
        tz = timezone(timezone_str)
        config = SchedulerConfig(timezone=tz, hour=hour, minute=minute, category=category)
        _scheduler_configs[category] = config
    except Exception as e:
        logger.warning(f"Invalid timezone {timezone_str}, using default: {e}")
        config = SchedulerConfig(
            timezone=timezone('America/Chicago'),
            hour=6,
            minute=0,
            category=category
        )
        _scheduler_configs[category] = config

    job_id = f"daily_{category}_job"

    # Schedule daily job using timezone-aware scheduling
    scheduler.add_job(
        run_daily_job_for_category,
        trigger=CronTrigger(
            hour=config.hour,
            minute=config.minute,
            timezone=config.timezone
        ),
        args=[category],
        id=job_id,
        name=f"Daily {category.upper()} Orbit Hub Job - {config.hour:02d}:{config.minute:02d} {timezone_str}",
        replace_existing=True,
    )

    logger.info(
        f"{category.upper()} Scheduler configured to run daily at {config.hour:02d}:{config.minute:02d} {timezone_str}"
    )


def update_scheduler_settings(timezone_str: str = "America/Chicago", hour: int = 6, minute: int = 0, category: str = 'dnk'):
    """Update scheduler settings and reschedule the job for a specific category."""
    job_id = f"daily_{category}_job"

    # Remove existing job
    try:
        scheduler.remove_job(job_id)
    except Exception:
        pass  # Job might not exist

    # Setup with new settings
    setup_scheduler(timezone_str, hour, minute, category)


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

