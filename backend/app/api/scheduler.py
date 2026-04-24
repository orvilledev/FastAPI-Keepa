"""Scheduler API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, BackgroundTasks
from app.dependencies import get_current_user
from app.scheduler import scheduler, update_scheduler_settings, pause_scheduler, run_daily_job_for_category
from app.database import get_supabase
from app.utils.error_handler import handle_api_errors
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import Optional, List
from supabase import Client
import logging
import re

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
    input_mode: Optional[str] = None


VALID_RUN_MODES = {"daily", "every_other_day", "custom_days"}
VALID_WEEKDAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
VALID_INPUT_MODES = {"api", "uploaded"}
DAILY_JOB_NAME_RE = re.compile(r"^Daily\s+([A-Za-z0-9_-]+)\s+", re.IGNORECASE)
UPC_RE = re.compile(r"\b\d{8,14}\b")


def _extract_category_from_daily_job_name(job_name: str) -> Optional[str]:
    """Extract vendor/category token from a daily job name."""
    if not job_name:
        return None
    match = DAILY_JOB_NAME_RE.match(job_name.strip())
    if not match:
        return None
    return match.group(1).lower()


def _normalize_upc_token(raw: str) -> Optional[str]:
    """Normalize one CSV/TXT token into a UPC string."""
    if raw is None:
        return None
    cleaned = str(raw).strip().strip('"').strip("'")
    if not cleaned:
        return None
    # Common spreadsheet export form, e.g. 012345678905.0
    if re.fullmatch(r"\d{8,14}\.0+", cleaned):
        cleaned = cleaned.split(".", 1)[0]
    digits = re.sub(r"\D", "", cleaned)
    if 8 <= len(digits) <= 14:
        return digits
    return None


def _extract_upcs_from_text(text: str) -> List[str]:
    """Extract unique UPCs from delimited/plain text content."""
    found: List[str] = []
    seen = set()
    for line in text.splitlines():
        for token in re.split(r"[,;\t|]", line):
            normalized = _normalize_upc_token(token)
            if normalized and normalized not in seen:
                seen.add(normalized)
                found.append(normalized)
        for match in UPC_RE.findall(line):
            if match not in seen:
                seen.add(match)
                found.append(match)
    return found


@router.get("/scheduler/next-run")
async def get_next_scheduled_run(
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff|tev|cha)$'),
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
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff|tev|cha)$'),
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
                "input_mode": "api",
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
            "input_mode": settings.get("input_mode", "api"),
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
            "input_mode": "api",
            "category": category
        }


@router.get("/scheduler/calendar")
@handle_api_errors("get scheduler calendar")
async def get_scheduler_calendar(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Return an overview of scheduled/ongoing daily runs across vendors."""
    default_categories = ["dnk", "clk", "obz", "ref", "bor", "sff", "tev", "cha"]
    categories = set(default_categories)
    settings_by_category = {}

    try:
        settings_response = db.table("scheduler_settings").select("*").execute()
        for row in settings_response.data or []:
            category = str(row.get("category", "")).strip().lower()
            if not category:
                continue
            categories.add(category)
            settings_by_category[category] = row
    except Exception:
        # Keep defaults if table lookup fails.
        pass

    latest_by_category = {}
    ongoing_runs = []
    try:
        jobs_response = (
            db.table("batch_jobs")
            .select("id, job_name, status, created_at, completed_at")
            .ilike("job_name", "Daily %")
            .order("created_at", desc=True)
            .limit(500)
            .execute()
        )
        for job in jobs_response.data or []:
            category = _extract_category_from_daily_job_name(job.get("job_name", ""))
            if not category:
                continue
            categories.add(category)
            if category not in latest_by_category:
                latest_by_category[category] = job
            if job.get("status") in {"pending", "processing"}:
                ongoing_runs.append({
                    "id": job.get("id"),
                    "job_name": job.get("job_name"),
                    "category": category,
                    "status": job.get("status"),
                    "created_at": job.get("created_at"),
                    "completed_at": job.get("completed_at"),
                })
    except Exception:
        pass

    vendors = []
    for category in sorted(categories):
        settings = settings_by_category.get(category, {})
        timezone_str = settings.get("timezone", "America/Chicago")
        hour = settings.get("hour", 6)
        minute = settings.get("minute", 0)
        enabled = settings.get("enabled", True)
        run_mode = settings.get("run_mode", "daily")
        custom_days = settings.get("custom_days", []) or []
        anchor_date = settings.get("anchor_date")
        input_mode = settings.get("input_mode", "api")

        schedule_label = {
            "daily": "Daily",
            "every_other_day": "Every other day",
            "custom_days": f"Custom days ({', '.join(custom_days)})" if custom_days else "Custom days",
        }.get(run_mode, "Daily")
        scheduled_time = f"{hour:02d}:{minute:02d} {timezone_str} - {schedule_label}"

        scheduler_job_present = False
        next_run_time = None
        if enabled:
            try:
                job = scheduler.get_job(f"daily_{category}_job")
                if job:
                    scheduler_job_present = True
                    if job.next_run_time:
                        next_run_time = job.next_run_time.isoformat()
            except Exception:
                pass

        latest_job = latest_by_category.get(category)
        vendors.append({
            "category": category,
            "enabled": enabled,
            "timezone": timezone_str,
            "hour": hour,
            "minute": minute,
            "run_mode": run_mode,
            "custom_days": custom_days,
            "anchor_date": anchor_date,
            "input_mode": input_mode,
            "scheduled_time": scheduled_time,
            "next_run_time": next_run_time,
            "scheduler_job_present": scheduler_job_present,
            "latest_job": latest_job,
            "is_ongoing": any(run.get("category") == category for run in ongoing_runs),
        })

    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "vendors": vendors,
        "ongoing_runs": ongoing_runs,
    }


@router.put("/scheduler/settings")
@handle_api_errors("update scheduler settings")
async def update_scheduler_settings_endpoint(
    settings_data: SchedulerSettingsUpdate,
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff|tev|cha)$'),
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
    if settings_data.input_mode is not None:
        normalized_input_mode = settings_data.input_mode.strip().lower()
        if normalized_input_mode not in VALID_INPUT_MODES:
            raise HTTPException(status_code=400, detail="Invalid input_mode. Use api or uploaded")
        update_data["input_mode"] = normalized_input_mode
    
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
        "input_mode": updated_settings.get("input_mode", "api"),
        "category": category,
        "message": f"{category.upper()} scheduler settings updated successfully"
    }


@router.post("/scheduler/uploaded-report")
@handle_api_errors("upload scheduler report")
async def upload_scheduler_report(
    file: UploadFile = File(...),
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff|tev|cha)$'),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Upload a Keepa report file (csv/txt) used by uploaded daily run mode."""
    filename = (file.filename or "").strip()
    lower_name = filename.lower()
    content_type = (file.content_type or "").lower()
    name_ok = lower_name.endswith(".csv") or lower_name.endswith(".txt")
    mime_ok = (
        "csv" in content_type
        or content_type.startswith("text/")
        or content_type == "application/vnd.ms-excel"
    )
    if not name_ok and not mime_ok:
        raise HTTPException(status_code=400, detail="File type not recognized. Upload CSV or TXT.")

    raw = await file.read()
    text = ""
    for enc in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except Exception:
            continue
    if not text:
        text = raw.decode("utf-8", errors="ignore")
    upcs = _extract_upcs_from_text(text)
    if not upcs:
        raise HTTPException(status_code=400, detail="No valid UPC values found in uploaded file")

    today = datetime.utcnow().date().isoformat()
    db.table("scheduler_uploaded_reports").insert({
        "category": category,
        "filename": filename,
        "content_type": file.content_type,
        "uploaded_for_date": today,
        "upcs": upcs,
        "upc_count": len(upcs),
        "uploaded_by": current_user["id"],
    }).execute()

    return {
        "message": "Uploaded report saved",
        "category": category,
        "filename": filename,
        "uploaded_for_date": today,
        "upc_count": len(upcs),
    }


@router.get("/scheduler/uploaded-report/latest")
@handle_api_errors("get latest uploaded scheduler report")
async def get_latest_uploaded_report(
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff|tev|cha)$'),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Get latest uploaded scheduler report metadata for a category."""
    response = (
        db.table("scheduler_uploaded_reports")
        .select("id, category, filename, uploaded_for_date, upc_count, created_at")
        .eq("category", category)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    report = response.data[0] if response.data else None
    return {"report": report}


@router.post("/scheduler/uploaded-report/rerun")
@handle_api_errors("rerun uploaded scheduler report")
async def rerun_uploaded_report(
    background_tasks: BackgroundTasks,
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff|tev|cha)$'),
    current_user: dict = Depends(get_current_user),
):
    """Trigger an immediate uploaded-mode run for a category."""
    background_tasks.add_task(run_daily_job_for_category, category)
    return {"message": f"{category.upper()} uploaded run queued"}

