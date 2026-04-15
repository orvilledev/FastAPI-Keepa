"""APScheduler setup for daily automated job execution."""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
import logging
from pytz import timezone
from app.config import settings
from app.database import get_supabase
from app.repositories.upc_repository import UPCRepository
from app.services.batch_processor import BatchProcessor
from typing import List, Optional
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

@dataclass
class SchedulerConfig:
    """Configuration for the scheduler."""
    timezone: timezone
    hour: int
    minute: int
    category: str
    run_mode: str = "daily"
    custom_days: Optional[List[str]] = None
    anchor_date: Optional[str] = None

# Default configurations for DNK and CLK
_scheduler_configs = {
    'dnk': SchedulerConfig(
        timezone=timezone('America/Chicago'),
        hour=6,
        minute=0,
        category='dnk',
        run_mode='daily',
        custom_days=None,
        anchor_date=None
    ),
    'clk': SchedulerConfig(
        timezone=timezone('America/Chicago'),
        hour=6,
        minute=0,
        category='clk',
        run_mode='daily',
        custom_days=None,
        anchor_date=None
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

        # Process UPCs for the specified category (paginate past PostgREST 1000-row default)
        upc_repo = UPCRepository(db)
        upcs = upc_repo.get_all_upc_codes(category)

        if upcs:
            logger.info(f"Found {len(upcs)} {category.upper()} UPCs to process")
            job_name = f"Daily {category.upper()} Off Price Report - {current_time.strftime('%Y-%m-%d')}"
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


def setup_scheduler(
    timezone_str: str = "America/Chicago",
    hour: int = 6,
    minute: int = 0,
    category: str = 'dnk',
    run_mode: str = "daily",
    custom_days: Optional[List[str]] = None,
    anchor_date: Optional[str] = None,
):
    """Setup and start the scheduler for a specific category."""
    global _scheduler_configs

    try:
        tz = timezone(timezone_str)
        config = SchedulerConfig(
            timezone=tz,
            hour=hour,
            minute=minute,
            category=category,
            run_mode=run_mode,
            custom_days=custom_days,
            anchor_date=anchor_date,
        )
        _scheduler_configs[category] = config
    except Exception as e:
        logger.warning(f"Invalid timezone {timezone_str}, using default: {e}")
        config = SchedulerConfig(
            timezone=timezone('America/Chicago'),
            hour=6,
            minute=0,
            category=category,
            run_mode='daily',
            custom_days=None,
            anchor_date=None,
        )
        _scheduler_configs[category] = config

    job_id = f"daily_{category}_job"

    trigger = None
    schedule_description = f"daily at {config.hour:02d}:{config.minute:02d} {timezone_str}"
    if config.run_mode == "custom_days":
        day_of_week = ",".join(config.custom_days or [])
        trigger = CronTrigger(
            day_of_week=day_of_week,
            hour=config.hour,
            minute=config.minute,
            timezone=config.timezone
        )
        schedule_description = f"custom days ({day_of_week}) at {config.hour:02d}:{config.minute:02d} {timezone_str}"
    elif config.run_mode == "every_other_day":
        # Run every two days at the requested local time starting from the anchor date.
        try:
            if config.anchor_date:
                anchor_dt = datetime.strptime(config.anchor_date, "%Y-%m-%d")
            else:
                now_local = datetime.now(config.timezone)
                anchor_dt = datetime(now_local.year, now_local.month, now_local.day)
            start_date = config.timezone.localize(
                datetime(anchor_dt.year, anchor_dt.month, anchor_dt.day, config.hour, config.minute)
            )
        except Exception:
            now_local = datetime.now(config.timezone)
            start_date = config.timezone.localize(
                datetime(now_local.year, now_local.month, now_local.day, config.hour, config.minute)
            )
        trigger = IntervalTrigger(days=2, start_date=start_date, timezone=config.timezone)
        schedule_description = (
            f"every other day from {start_date.strftime('%Y-%m-%d')} "
            f"at {config.hour:02d}:{config.minute:02d} {timezone_str}"
        )
    else:
        trigger = CronTrigger(
            hour=config.hour,
            minute=config.minute,
            timezone=config.timezone
        )

    scheduler.add_job(
        run_daily_job_for_category,
        trigger=trigger,
        args=[category],
        id=job_id,
        name=f"{category.upper()} MSW Overwatch Job - {schedule_description}",
        replace_existing=True,
    )

    logger.info(f"{category.upper()} Scheduler configured to run {schedule_description}")


def pause_scheduler(category: str = 'dnk'):
    """Pause (remove) the scheduled job for a category."""
    job_id = f"daily_{category}_job"
    try:
        scheduler.remove_job(job_id)
        logger.info(f"{category.upper()} scheduler paused (job removed)")
    except Exception:
        pass


def update_scheduler_settings(
    timezone_str: str = "America/Chicago",
    hour: int = 6,
    minute: int = 0,
    category: str = 'dnk',
    enabled: bool = True,
    run_mode: str = "daily",
    custom_days: Optional[List[str]] = None,
    anchor_date: Optional[str] = None,
):
    """Update scheduler settings and reschedule the job for a specific category."""
    job_id = f"daily_{category}_job"

    # Remove existing job
    try:
        scheduler.remove_job(job_id)
    except Exception:
        pass  # Job might not exist

    if enabled:
        setup_scheduler(
            timezone_str=timezone_str,
            hour=hour,
            minute=minute,
            category=category,
            run_mode=run_mode,
            custom_days=custom_days,
            anchor_date=anchor_date,
        )
    else:
        logger.info(f"{category.upper()} scheduler is disabled, job not scheduled")


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

