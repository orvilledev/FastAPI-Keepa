"""Scheduler API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from app.dependencies import get_current_user
from app.scheduler import scheduler, update_scheduler_settings, pause_scheduler
from app.database import get_supabase
from app.utils.error_handler import handle_api_errors
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import Optional, List
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
    run_mode: Optional[str] = None
    custom_days: Optional[List[str]] = None
    anchor_date: Optional[str] = None
    email_recipients: Optional[str] = None


VALID_RUN_MODES = {"daily", "every_other_day", "custom_days"}
VALID_WEEKDAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}


@router.get("/scheduler/next-run")
async def get_next_scheduled_run(
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff)$'),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get the next scheduled run time for the daily job for a specific category."""
    try:
        # Get scheduler settings for the specified category
        try:
            settings_response = db.table("scheduler_settings").select("*").eq("category", category).execute()
            if settings_response.data:
                settings = settings_response.data[0]
                tz_str = settings.get("timezone", "America/Chicago")
                hour = settings.get("hour", 6)
                minute = settings.get("minute", 0)
                run_mode = settings.get("run_mode", "daily")
                custom_days = settings.get("custom_days", [])
            else:
                tz_str = "America/Chicago"
                hour = 6
                minute = 0
                run_mode = "daily"
                custom_days = []
        except Exception:
            tz_str = "America/Chicago"
            hour = 6
            minute = 0
            run_mode = "daily"
            custom_days = []

        from pytz import timezone as pytz_timezone
        current_tz = pytz_timezone(tz_str)

        # Get scheduler running status safely
        try:
            is_running = scheduler.running
        except (AttributeError, RuntimeError):
            is_running = False

        # Get the scheduled job for this category
        job_id = f"daily_{category}_job"
        try:
            job = scheduler.get_job(job_id)
        except Exception:
            job = None
        
        schedule_label = {
            "daily": "Daily",
            "every_other_day": "Every other day",
            "custom_days": f"Custom days ({', '.join(custom_days)})" if custom_days else "Custom days",
        }.get(run_mode, "Daily")
        scheduled_time_str = f"{hour:02d}:{minute:02d} {tz_str} - {schedule_label}"
        
        if not job or not job.next_run_time:
            return {
                "next_run_time": None,
                "next_run_time_taipei": None,
                "scheduled_time": scheduled_time_str,
                "timezone": tz_str,
                "run_mode": run_mode,
                "custom_days": custom_days,
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
            "run_mode": run_mode,
            "custom_days": custom_days,
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
            "run_mode": "daily",
            "custom_days": [],
            "message": f"Scheduler error: {str(e)}",
            "seconds_until": None,
            "is_running": False
        }


@router.get("/scheduler/settings")
@handle_api_errors("get scheduler settings")
async def get_scheduler_settings(
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff)$'),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get current scheduler settings for a specific category."""
    try:
        response = db.table("scheduler_settings").select("*").eq("category", category).execute()
        if not response.data:
            # Return default settings if not found
            return {
                "timezone": "America/Chicago",
                "hour": 6,
                "minute": 0,
                "enabled": True,
                "run_mode": "daily",
                "custom_days": [],
                "anchor_date": None,
                "email_recipients": None,
                "category": category
            }
        settings = response.data[0]
        return {
            "timezone": settings.get("timezone", "America/Chicago"),
            "hour": settings.get("hour", 6),
            "minute": settings.get("minute", 0),
            "enabled": settings.get("enabled", True),
            "run_mode": settings.get("run_mode", "daily"),
            "custom_days": settings.get("custom_days", []),
            "anchor_date": settings.get("anchor_date"),
            "email_recipients": settings.get("email_recipients"),
            "category": settings.get("category", category)
        }
    except Exception as e:
        # Return default settings on error
        return {
            "timezone": "America/Chicago",
            "hour": 6,
            "minute": 0,
            "enabled": True,
            "run_mode": "daily",
            "custom_days": [],
            "anchor_date": None,
            "email_recipients": None,
            "category": category
        }


@router.put("/scheduler/settings")
@handle_api_errors("update scheduler settings")
async def update_scheduler_settings_endpoint(
    settings_data: SchedulerSettingsUpdate,
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff)$'),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Update scheduler settings for a specific category."""
    # Get current settings for this category
    current_response = db.table("scheduler_settings").select("*").eq("category", category).execute()
    
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
    if settings_data.run_mode is not None:
        if settings_data.run_mode not in VALID_RUN_MODES:
            raise HTTPException(status_code=400, detail="Invalid run_mode. Use daily, every_other_day, or custom_days")
        update_data["run_mode"] = settings_data.run_mode
    if settings_data.custom_days is not None:
        normalized_days = [day.lower().strip() for day in settings_data.custom_days if isinstance(day, str)]
        invalid_days = [day for day in normalized_days if day not in VALID_WEEKDAYS]
        if invalid_days:
            raise HTTPException(status_code=400, detail=f"Invalid custom_days values: {', '.join(invalid_days)}")
        # Keep stable order for cron readability.
        ordered_days = [d for d in ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] if d in normalized_days]
        update_data["custom_days"] = ordered_days
    if settings_data.anchor_date is not None:
        if settings_data.anchor_date:
            try:
                datetime.strptime(settings_data.anchor_date, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="anchor_date must be YYYY-MM-DD")
        update_data["anchor_date"] = settings_data.anchor_date
    if settings_data.email_recipients is not None:
        cleaned_recipients = settings_data.email_recipients.strip()
        update_data["email_recipients"] = cleaned_recipients or None
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Validate mode-dependent required fields using pending values + current settings fallback.
    pending_run_mode = update_data.get("run_mode")
    if pending_run_mode is None and current_response.data:
        pending_run_mode = current_response.data[0].get("run_mode", "daily")
    if pending_run_mode is None:
        pending_run_mode = "daily"

    pending_custom_days = update_data.get("custom_days")
    if pending_custom_days is None and current_response.data:
        pending_custom_days = current_response.data[0].get("custom_days", [])
    if pending_custom_days is None:
        pending_custom_days = []

    if pending_run_mode == "custom_days" and len(pending_custom_days) == 0:
        raise HTTPException(status_code=400, detail="custom_days must contain at least one weekday when run_mode is custom_days")
    
    update_data["updated_by"] = current_user["id"]
    update_data["updated_at"] = "now()"
    update_data["category"] = category

    # Update or insert settings
    if current_response.data:
        response = db.table("scheduler_settings").update(update_data).eq("category", category).execute()
    else:
        response = db.table("scheduler_settings").insert(update_data).execute()

    # Get updated settings
    updated_settings = response.data[0] if response.data else update_data

    # Update the actual scheduler
    try:
        is_enabled = updated_settings.get("enabled", True)
        update_scheduler_settings(
            timezone_str=updated_settings.get("timezone", "America/Chicago"),
            hour=updated_settings.get("hour", 6),
            minute=updated_settings.get("minute", 0),
            category=category,
            enabled=is_enabled,
            run_mode=updated_settings.get("run_mode", "daily"),
            custom_days=updated_settings.get("custom_days", []),
            anchor_date=updated_settings.get("anchor_date"),
        )
    except Exception as e:
        logger.error(f"Failed to update {category.upper()} scheduler: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update scheduler: {str(e)}")

    return {
        "timezone": updated_settings.get("timezone", "America/Chicago"),
        "hour": updated_settings.get("hour", 6),
        "minute": updated_settings.get("minute", 0),
        "enabled": updated_settings.get("enabled", True),
        "run_mode": updated_settings.get("run_mode", "daily"),
        "custom_days": updated_settings.get("custom_days", []),
        "anchor_date": updated_settings.get("anchor_date"),
        "email_recipients": updated_settings.get("email_recipients"),
        "category": category,
        "message": f"{category.upper()} scheduler settings updated successfully"
    }

