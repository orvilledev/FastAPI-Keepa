"""Scheduler API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_current_user
from app.scheduler import scheduler, TAIPEI_TZ
from app.utils.error_handler import handle_api_errors
from datetime import datetime, timedelta

router = APIRouter()


@router.get("/scheduler/next-run")
async def get_next_scheduled_run(
    current_user: dict = Depends(get_current_user),
):
    """Get the next scheduled run time for the daily job."""
    try:
        # Get scheduler running status safely
        try:
            is_running = scheduler.running
        except (AttributeError, RuntimeError):
            is_running = False
        
        # Get the scheduled job
        try:
            job = scheduler.get_job("daily_keepa_job")
        except Exception:
            job = None
        
        if not job or not job.next_run_time:
            return {
                "next_run_time": None,
                "next_run_time_taipei": None,
                "scheduled_time": "8:00 PM Taipei time",
                "timezone": "Asia/Taipei (UTC+8)",
                "message": "Scheduler not configured",
                "seconds_until": None,
                "is_running": is_running
            }
        
        # Convert to Taipei timezone
        next_run = job.next_run_time.astimezone(TAIPEI_TZ)
        now = datetime.now(TAIPEI_TZ)
        
        # Calculate time difference
        time_diff = next_run - now
        
        # If next run is in the past, calculate next day
        if time_diff.total_seconds() < 0:
            # Add 24 hours for next day
            next_run = next_run + timedelta(days=1)
            time_diff = next_run - now
        
        return {
            "next_run_time": next_run.isoformat(),
            "next_run_time_taipei": next_run.strftime("%Y-%m-%d %H:%M:%S %Z"),
            "scheduled_time": "8:00 PM Taipei time",
            "timezone": "Asia/Taipei (UTC+8)",
            "seconds_until": int(time_diff.total_seconds()),
            "is_running": is_running
        }
    except Exception as e:
        # Return a safe response even if there's an error
        return {
            "next_run_time": None,
            "next_run_time_taipei": None,
            "scheduled_time": "8:00 PM Taipei time",
            "timezone": "Asia/Taipei (UTC+8)",
            "message": f"Scheduler error: {str(e)}",
            "seconds_until": None,
            "is_running": False
        }

