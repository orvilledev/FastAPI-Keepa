"""Scheduler API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, BackgroundTasks
from app.dependencies import get_current_user
from app.scheduler import scheduler, update_scheduler_settings, pause_scheduler, run_daily_job_for_category
from app.database import get_supabase
from app.utils.error_handler import handle_api_errors
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pydantic import BaseModel
from typing import Optional, List
from supabase import Client
import logging
import re
import pandas as pd

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
    # Scientific notation from spreadsheets, e.g. 1.23456789012E+11
    sci_match = re.fullmatch(r"[+-]?\d+(?:\.\d+)?[eE][+-]?\d+", cleaned)
    if sci_match:
        try:
            sci_decimal = Decimal(cleaned)
            if sci_decimal == sci_decimal.to_integral_value():
                cleaned = format(sci_decimal.quantize(Decimal("1")), "f")
        except (InvalidOperation, ValueError):
            pass
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


def _parse_price_token(raw: str) -> Optional[float]:
    cleaned = (raw or "").strip().replace("$", "").replace(",", "")
    if not cleaned:
        return None
    try:
        value = float(cleaned)
        return value if value > 0 else None
    except Exception:
        return None


def _extract_rows_from_dataframe(df: pd.DataFrame) -> List[dict]:
    """
    Fixed uploaded schema (1-based columns):
      A=UPC, C=Product Title, D=ASIN, F=Seller, H=Seller Price, U=Amazon Link
    """
    rows: List[dict] = []
    # Zero-based column indices
    idx_upc = 0
    idx_title = 2
    idx_asin = 3
    idx_seller = 5
    idx_price = 7
    idx_link = 20

    for raw_row in df.itertuples(index=False):
        cells = list(raw_row)
        if len(cells) <= idx_upc:
            continue
        upc = _normalize_upc_token("" if cells[idx_upc] is None else str(cells[idx_upc]))
        if not upc:
            continue
        title = str(cells[idx_title]).strip() if len(cells) > idx_title and cells[idx_title] is not None else ""
        asin = str(cells[idx_asin]).strip() if len(cells) > idx_asin and cells[idx_asin] is not None else ""
        seller = str(cells[idx_seller]).strip() if len(cells) > idx_seller and cells[idx_seller] is not None else ""
        price_raw = str(cells[idx_price]).strip() if len(cells) > idx_price and cells[idx_price] is not None else ""
        seller_price = _parse_price_token(price_raw)
        amazon_link = str(cells[idx_link]).strip() if len(cells) > idx_link and cells[idx_link] is not None else ""
        rows.append({
            "upc": upc,
            "product_title": title,
            "asin": asin,
            "seller": seller,
            "seller_price": seller_price,
            "amazon_link": amazon_link,
        })
    return rows


def _compress_rows_by_upc(rows: List[dict]) -> List[dict]:
    """
    Compact parsed rows to reduce DB payload:
      [
        {
          "upc": "...",
          "product_title": "...",
          "asin": "...",
          "amazon_link": "...",
          "offers": [{"seller": "...", "seller_price": 12.34}, ...]
        }
      ]
    """
    compact_by_upc = {}
    offer_seen_by_upc = {}

    for row in rows:
        upc = str(row.get("upc") or "").strip()
        if not upc:
            continue
        if upc not in compact_by_upc:
            compact_by_upc[upc] = {
                "upc": upc,
                "product_title": str(row.get("product_title") or "").strip(),
                "asin": str(row.get("asin") or "").strip(),
                "amazon_link": str(row.get("amazon_link") or "").strip(),
                "offers": [],
            }
            offer_seen_by_upc[upc] = set()

        seller = str(row.get("seller") or "").strip()
        seller_price = row.get("seller_price")
        if seller_price is None:
            continue
        try:
            price_num = float(seller_price)
        except Exception:
            continue
        offer_key = (seller.lower(), round(price_num, 4))
        if offer_key in offer_seen_by_upc[upc]:
            continue
        offer_seen_by_upc[upc].add(offer_key)
        compact_by_upc[upc]["offers"].append({
            "seller": seller,
            "seller_price": price_num,
        })

    return list(compact_by_upc.values())


def _extract_uploaded_rows(filename: str, raw: bytes) -> tuple[List[dict], dict]:
    """Parse fixed-schema rows from CSV/TXT/Excel-like uploads."""
    lower_name = (filename or "").lower()

    if lower_name.endswith((".csv", ".txt", ".tsv")):
        # Fast path: parse bytes directly with pandas C engine + known delimiters.
        csv_usecols = [0, 2, 3, 5, 7, 20]
        sep_candidates = ["\t"] if lower_name.endswith(".tsv") else [",", "\t", ";", "|"]
        for enc in ("utf-8-sig", "utf-16", "latin-1", "cp1252"):
            for sep in sep_candidates:
                try:
                    df = pd.read_csv(
                        BytesIO(raw),
                        header=None,
                        dtype=str,
                        sep=sep,
                        engine="c",
                        encoding=enc,
                        usecols=csv_usecols,
                        na_filter=False,
                    )
                    rows = _extract_rows_from_dataframe(df)
                    if rows:
                        return rows, {"file_kind": "text", "sheet_count": 1}
                except Exception:
                    continue

        # Fallback: decode text and use python parser only if fast path failed.
        text = None
        for enc in ("utf-8-sig", "utf-16", "latin-1", "cp1252"):
            try:
                text = raw.decode(enc)
                break
            except Exception:
                continue
        if text is None:
            text = raw.decode("utf-8", errors="ignore")
        # Parse as delimited table (header unknown/ignored) and map by column index.
        try:
            df = pd.read_csv(BytesIO(text.encode("utf-8")), header=None, dtype=str, sep=None, engine="python")
        except Exception:
            # Fallback: one-column text, still interpreted as col A UPCs.
            df = pd.DataFrame(text.splitlines(), columns=[0], dtype=str)
        rows = _extract_rows_from_dataframe(df)
        return rows, {"file_kind": "text", "sheet_count": 1}

    # Excel-like files: read all sheets without assuming headers.
    excel_exts = (".xlsx", ".xls", ".xlsm", ".xlsb")
    if lower_name.endswith(excel_exts):
        buffer = BytesIO(raw)
        try:
            # Read only needed columns to reduce parse time/memory.
            sheets = pd.read_excel(
                buffer,
                sheet_name=None,
                header=None,
                dtype=str,
                usecols="A,C,D,F,H,U",
            )
        except Exception as first_err:
            # Some files masquerade as Excel but are csv-ish; fallback to text parse.
            try:
                text_fallback = raw.decode("utf-8", errors="ignore")
                df_fallback = pd.DataFrame(text_fallback.splitlines(), columns=[0], dtype=str)
                rows_fallback = _extract_rows_from_dataframe(df_fallback)
                return rows_fallback, {"file_kind": "text_fallback", "sheet_count": 1}
            except Exception:
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not read Excel file: {first_err}",
                ) from first_err

        found_rows: List[dict] = []
        for _, df in sheets.items():
            found_rows.extend(_extract_rows_from_dataframe(df))
        return found_rows, {"file_kind": "excel", "sheet_count": len(sheets)}

    # Unknown extension: best effort text decode.
    fallback_text = raw.decode("utf-8", errors="ignore")
    df_fallback = pd.DataFrame(fallback_text.splitlines(), columns=[0], dtype=str)
    rows_fallback = _extract_rows_from_dataframe(df_fallback)
    return rows_fallback, {"file_kind": "text_fallback", "sheet_count": 1}


def _process_uploaded_report_in_background(report_id: str, filename: str, raw: bytes) -> None:
    """Parse uploaded file after request returns, then update stored report row."""
    db = get_supabase()
    try:
        db.table("scheduler_uploaded_reports").update({
            "parse_status": "processing",
            "parse_error": None,
        }).eq("id", report_id).execute()

        parsed_rows, _ = _extract_uploaded_rows(filename, raw)
        if not parsed_rows:
            raise ValueError("No valid UPC values found in uploaded file")

        compact_rows = _compress_rows_by_upc(parsed_rows)
        seen_upcs = set()
        upcs: List[str] = []
        for row in compact_rows:
            u = str(row.get("upc") or "").strip()
            if not u or u in seen_upcs:
                continue
            seen_upcs.add(u)
            upcs.append(u)

        db.table("scheduler_uploaded_reports").update({
            "upcs": upcs,
            "parsed_rows": compact_rows,
            "upc_count": len(upcs),
            "row_count": len(parsed_rows),
            "parse_status": "completed",
            "parse_error": None,
            "parsed_at": datetime.utcnow().isoformat(),
        }).eq("id", report_id).execute()
    except Exception as e:
        logger.exception("Failed to parse uploaded report %s", report_id)
        db.table("scheduler_uploaded_reports").update({
            "parse_status": "failed",
            "parse_error": str(e),
            "parsed_at": datetime.utcnow().isoformat(),
        }).eq("id", report_id).execute()


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
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff|tev|cha)$'),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Upload a Keepa report file (csv/txt) used by uploaded daily run mode."""
    filename = (file.filename or "").strip()

    raw = await file.read()
    today = datetime.utcnow().date().isoformat()
    insert_resp = db.table("scheduler_uploaded_reports").insert({
        "category": category,
        "filename": filename,
        "content_type": file.content_type,
        "uploaded_for_date": today,
        "upcs": [],
        "parsed_rows": [],
        "upc_count": 0,
        "row_count": 0,
        "parse_status": "pending",
        "parse_error": None,
        "uploaded_by": current_user["id"],
    }).execute()
    report = insert_resp.data[0] if insert_resp.data else None
    report_id = str(report["id"]) if report and report.get("id") else None
    if not report_id:
        raise HTTPException(status_code=500, detail="Failed to create uploaded report record")

    background_tasks.add_task(_process_uploaded_report_in_background, report_id, filename, raw)

    return {
        "message": "Uploaded report accepted. Parsing in progress.",
        "report_id": report_id,
        "category": category,
        "filename": filename,
        "uploaded_for_date": today,
        "upc_count": 0,
        "parse_status": "pending",
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
        .select("id, category, filename, uploaded_for_date, upc_count, row_count, parse_status, parse_error, parsed_at, created_at")
        .eq("category", category)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    report = response.data[0] if response.data else None
    return {"report": report}


@router.get("/scheduler/uploaded-report/status")
@handle_api_errors("get uploaded scheduler report status")
async def get_uploaded_report_status(
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff|tev|cha)$'),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Get lightweight parse status for latest uploaded scheduler report."""
    response = (
        db.table("scheduler_uploaded_reports")
        .select("id, parse_status, parse_error, upc_count, row_count, parsed_at, created_at")
        .eq("category", category)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    report = response.data[0] if response.data else None
    return {"report": report}


@router.delete("/scheduler/uploaded-report/{report_id}")
@handle_api_errors("delete uploaded scheduler report")
async def delete_uploaded_report(
    report_id: str,
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff|tev|cha)$'),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Delete one uploaded scheduler report by id for a category."""
    lookup = (
        db.table("scheduler_uploaded_reports")
        .select("id")
        .eq("id", report_id)
        .eq("category", category)
        .limit(1)
        .execute()
    )
    if not lookup.data:
        raise HTTPException(status_code=404, detail="Uploaded report not found for this category")

    db.table("scheduler_uploaded_reports").delete().eq("id", report_id).eq("category", category).execute()
    return {"message": "Uploaded report deleted", "id": report_id, "category": category}


@router.post("/scheduler/uploaded-report/rerun")
@handle_api_errors("rerun uploaded scheduler report")
async def rerun_uploaded_report(
    background_tasks: BackgroundTasks,
    category: str = Query(default='dnk', regex='^(dnk|clk|obz|ref|bor|sff|tev|cha)$'),
    current_user: dict = Depends(get_current_user),
):
    """Trigger an immediate uploaded-mode run for a category."""
    db = get_supabase()
    today = datetime.utcnow().date().isoformat()
    latest = (
        db.table("scheduler_uploaded_reports")
        .select("id, parse_status")
        .eq("category", category)
        .eq("uploaded_for_date", today)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    report = latest.data[0] if latest.data else None
    if not report:
        raise HTTPException(status_code=400, detail="No uploaded report found for today.")
    parse_status = (report.get("parse_status") or "").strip().lower()
    if parse_status != "completed":
        raise HTTPException(status_code=409, detail=f"Uploaded report is not ready yet (status: {parse_status or 'pending'}).")

    background_tasks.add_task(run_daily_job_for_category, category)
    return {"message": f"{category.upper()} uploaded run queued"}

