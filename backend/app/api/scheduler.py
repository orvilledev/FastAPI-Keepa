"""Scheduler API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_current_user, get_admin_user, check_is_admin
from app.scheduler import scheduler, TAIPEI_TZ, update_scheduler_settings
from app.database import get_supabase
from app.utils.error_handler import handle_api_errors
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import Optional
from supabase import Client
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


class SchedulerSettingsUpdate(BaseModel):
    """Model for updating scheduler settings."""
    timezone: Optional[str] = None
    hour: Optional[int] = None
    minute: Optional[int] = None
    enabled: Optional[bool] = None


@router.get("/scheduler/next-run")
async def get_next_scheduled_run(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get the next scheduled run time for the daily job."""
    try:
        # Get scheduler settings
        try:
            settings_response = db.table("scheduler_settings").select("*").eq("id", "00000000-0000-0000-0000-000000000000").execute()
            if settings_response.data:
                settings = settings_response.data[0]
                tz_str = settings.get("timezone", "Asia/Taipei")
                hour = settings.get("hour", 20)
                minute = settings.get("minute", 0)
            else:
                tz_str = "Asia/Taipei"
                hour = 20
                minute = 0
        except Exception:
            tz_str = "Asia/Taipei"
            hour = 20
            minute = 0
        
        from pytz import timezone as pytz_timezone
        current_tz = pytz_timezone(tz_str)
        
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
        
        scheduled_time_str = f"{hour:02d}:{minute:02d} {tz_str}"
        
        if not job or not job.next_run_time:
            return {
                "next_run_time": None,
                "next_run_time_taipei": None,
                "scheduled_time": scheduled_time_str,
                "timezone": tz_str,
                "message": "Scheduler not configured",
                "seconds_until": None,
                "is_running": is_running
            }
        
        # Convert to current timezone
        next_run = job.next_run_time.astimezone(current_tz)
        now = datetime.now(current_tz)
        
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
            "scheduled_time": scheduled_time_str,
            "timezone": tz_str,
            "seconds_until": int(time_diff.total_seconds()),
            "is_running": is_running
        }
    except Exception as e:
        # Return a safe response even if there's an error
        return {
            "next_run_time": None,
            "next_run_time_taipei": None,
            "scheduled_time": "20:00 Asia/Taipei",
            "timezone": "Asia/Taipei",
            "message": f"Scheduler error: {str(e)}",
            "seconds_until": None,
            "is_running": False
        }


@router.get("/scheduler/settings")
@handle_api_errors("get scheduler settings")
async def get_scheduler_settings(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get current scheduler settings."""
    try:
        response = db.table("scheduler_settings").select("*").eq("id", "00000000-0000-0000-0000-000000000000").execute()
        if not response.data:
            # Return default settings if not found
            return {
                "timezone": "Asia/Taipei",
                "hour": 20,
                "minute": 0,
                "enabled": True
            }
        settings = response.data[0]
        return {
            "timezone": settings.get("timezone", "Asia/Taipei"),
            "hour": settings.get("hour", 20),
            "minute": settings.get("minute", 0),
            "enabled": settings.get("enabled", True)
        }
    except Exception as e:
        # Return default settings on error
        return {
            "timezone": "Asia/Taipei",
            "hour": 20,
            "minute": 0,
            "enabled": True
        }


@router.put("/scheduler/settings")
@handle_api_errors("update scheduler settings")
async def update_scheduler_settings_endpoint(
    settings_data: SchedulerSettingsUpdate,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    """Update scheduler settings (admin only)."""
    # Get current settings
    current_response = db.table("scheduler_settings").select("*").eq("id", "00000000-0000-0000-0000-000000000000").execute()
    
    update_data = {}
    if settings_data.timezone is not None:
        update_data["timezone"] = settings_data.timezone
    if settings_data.hour is not None:
        if settings_data.hour < 0 or settings_data.hour > 23:
            raise HTTPException(status_code=400, detail="Hour must be between 0 and 23")
        update_data["hour"] = settings_data.hour
    if settings_data.minute is not None:
        if settings_data.minute < 0 or settings_data.minute > 59:
            raise HTTPException(status_code=400, detail="Minute must be between 0 and 59")
        update_data["minute"] = settings_data.minute
    if settings_data.enabled is not None:
        update_data["enabled"] = settings_data.enabled
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    update_data["updated_by"] = current_user["id"]
    update_data["updated_at"] = "now()"
    
    # Update or insert settings
    if current_response.data:
        response = db.table("scheduler_settings").update(update_data).eq("id", "00000000-0000-0000-0000-000000000000").execute()
    else:
        update_data["id"] = "00000000-0000-0000-0000-000000000000"
        response = db.table("scheduler_settings").insert(update_data).execute()
    
    # Get updated settings
    updated_settings = response.data[0] if response.data else update_data
    
    # Update the actual scheduler
    try:
        update_scheduler_settings(
            timezone_str=updated_settings.get("timezone", "Asia/Taipei"),
            hour=updated_settings.get("hour", 20),
            minute=updated_settings.get("minute", 0)
        )
    except Exception as e:
        logger.error(f"Failed to update scheduler: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update scheduler: {str(e)}")
    
    return {
        "timezone": updated_settings.get("timezone", "Asia/Taipei"),
        "hour": updated_settings.get("hour", 20),
        "minute": updated_settings.get("minute", 0),
        "enabled": updated_settings.get("enabled", True),
        "message": "Scheduler settings updated successfully"
    }

