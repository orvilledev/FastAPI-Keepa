"""Keepa Import Export tool API (standalone).

Builds a Keepa-format Excel file (Import Mode schema) for the UPCs that exist in
Manage UPCs for a given vendor. UPCs are read only from the database; the client
cannot supply an arbitrary UPC list, so this tool can never pull Keepa data for
UPCs outside Manage UPCs.

Builds run asynchronously: ``/build`` starts one and returns a build id, the
client polls ``/builds/{id}/status``, can ``/builds/{id}/cancel`` it, and finally
``/builds/{id}/download`` the workbook. A global on/off flag (admin-controlled,
stored in keepa_import_export_settings) gates the tool for all users.
"""
import asyncio
import logging
from datetime import datetime, timedelta
from io import BytesIO
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pytz import timezone as pytz_timezone
from supabase import Client

from app.api.scheduler import (
    VALID_RUN_MODES,
    VALID_WEEKDAYS,
    _load_allowed_pool_emails,
    _parse_recipients_csv,
)
from app.database import get_supabase
from app.dependencies import get_admin_user, get_keepa_access_user
from app.keepa_import_scheduler import (
    _job_id as keepa_import_job_id,
    update_keepa_import_scheduler,
)
from app.models.keepa_import_build_history import (
    KeepaImportBuildContentsResponse,
    KeepaImportBuildHistorySummary,
)
from app.repositories.keepa_import_build_history_repository import (
    KeepaImportBuildHistoryRepository,
)
from app.repositories.seller_name_repository import SellerNameRepository
from app.repositories.upc_repository import UPCRepository
from app.scheduler import scheduler
from app.services.keepa_import_build_runner import (
    is_category_build_active,
    launch_keepa_import_build,
)
from app.services.keepa_import_build_store import keepa_import_build_store
from app.services.keepa_import_export import generate_keepa_import_file, parse_keepa_import_workbook
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_VALID_CATEGORIES = {"dnk", "clk", "obz", "ref", "bor", "sff", "tev", "cha"}
_EXCEL_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)
_SETTINGS_TABLE = "keepa_import_export_settings"
_SETTINGS_ROW_ID = "00000000-0000-0000-0000-000000000000"
_KEEPA_IMPORT_SCHEDULER_TABLE = "keepa_import_scheduler_settings"


class FeatureToggle(BaseModel):
    enabled: bool


class BuildStartResponse(BaseModel):
    build_id: str
    upc_count: int
    category: str


class KeepaImportSchedulerSettingsUpdate(BaseModel):
    timezone: Optional[str] = None
    hour: Optional[int] = None
    minute: Optional[int] = None
    enabled: Optional[bool] = None
    run_mode: Optional[str] = None
    custom_days: Optional[List[str]] = None
    anchor_date: Optional[str] = None
    email_recipients: Optional[str] = None
    email_bcc_recipients: Optional[str] = None


def _normalize_category(category: str) -> str:
    cat = (category or "").strip().lower()
    if cat not in _VALID_CATEGORIES:
        raise HTTPException(
            status_code=400, detail=f"Unknown vendor category: {category}"
        )
    return cat


def _scoped_upcs(db: Client, category: str) -> list[str]:
    """Return deduped UPCs from Manage UPCs for the vendor (order preserved)."""
    raw_upcs = UPCRepository(db).get_all_upc_codes(category)
    return list(dict.fromkeys(u.strip() for u in raw_upcs if u and u.strip()))


def _seller_name_map(db: Client) -> dict[str, str]:
    """Cached seller id -> name map for buy-box seller display (no Keepa tokens)."""
    try:
        return SellerNameRepository(db).get_seller_name_map()
    except Exception as exc:  # never fail the export over a name lookup
        logger.warning("Could not load seller name map: %s", exc)
        return {}


def _read_enabled(db: Client) -> bool:
    """Read the global on/off flag. Defaults to enabled when row/table missing."""
    try:
        resp = (
            db.table(_SETTINGS_TABLE)
            .select("enabled")
            .eq("id", _SETTINGS_ROW_ID)
            .limit(1)
            .execute()
        )
        if resp.data:
            return bool(resp.data[0].get("enabled", True))
    except Exception as exc:  # table may not exist yet; fail open so tool works
        logger.warning("Could not read keepa import export flag: %s", exc)
    return True


def _require_enabled(db: Client) -> None:
    if not _read_enabled(db):
        raise HTTPException(
            status_code=403,
            detail="The Keepa Import File tool is currently turned off.",
        )


def _history_summary_from_row(row: dict) -> KeepaImportBuildHistorySummary:
    return KeepaImportBuildHistorySummary(**row)


def _keepa_build_creator_name(current_user: dict, db: Client) -> str | None:
    """Return a stable display name snapshot for the user starting a build."""
    profile = {}
    try:
        response = (
            db.table("profiles")
            .select("*")
            .eq("id", current_user["id"])
            .limit(1)
            .execute()
        )
        if response.data:
            profile = response.data[0]
    except Exception as exc:
        logger.warning("Could not load keepa build creator profile: %s", exc)

    metadata = current_user.get("user_metadata") or {}
    candidates = [
        profile.get("display_name"),
        profile.get("full_name"),
        metadata.get("display_name"),
        metadata.get("full_name"),
        metadata.get("name"),
        profile.get("email"),
        current_user.get("email"),
    ]
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _streaming_excel_response(file_bytes: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        BytesIO(file_bytes),
        media_type=_EXCEL_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _default_keepa_import_scheduler_settings(category: str) -> dict:
    return {
        "timezone": "America/Chicago",
        "hour": 6,
        "minute": 0,
        "enabled": False,
        "run_mode": "daily",
        "custom_days": [],
        "anchor_date": None,
        "email_recipients": None,
        "email_bcc_recipients": None,
        "category": category,
    }


def _read_keepa_import_scheduler_settings(db: Client, category: str) -> dict:
    try:
        resp = (
            db.table(_KEEPA_IMPORT_SCHEDULER_TABLE)
            .select("*")
            .eq("category", category)
            .limit(1)
            .execute()
        )
        if not resp.data:
            return _default_keepa_import_scheduler_settings(category)
        row = resp.data[0]
        return {
            "timezone": row.get("timezone", "America/Chicago"),
            "hour": row.get("hour", 6),
            "minute": row.get("minute", 0),
            "enabled": bool(row.get("enabled", False)),
            "run_mode": row.get("run_mode", "daily"),
            "custom_days": row.get("custom_days") or [],
            "anchor_date": row.get("anchor_date"),
            "email_recipients": row.get("email_recipients"),
            "email_bcc_recipients": row.get("email_bcc_recipients"),
            "category": category,
        }
    except Exception as exc:
        logger.warning("Could not read keepa import scheduler settings: %s", exc)
        return _default_keepa_import_scheduler_settings(category)


def _status_from_history(row: dict) -> dict:
    """Map a persisted history row to the same shape as in-memory status polling."""
    return {
        "build_id": row["id"],
        "category": row["category"],
        "status": row["status"],
        "phase": row.get("phase") or "",
        "completed": row.get("completed_upcs", 0),
        "total": row.get("upc_count", 0),
        "progress_percent": row.get("progress_percent", 0),
        "message": row.get("message") or "",
        "error": row.get("error"),
        "filename": row.get("filename"),
    }


@router.get("/keepa-import-export/scheduler/settings")
@handle_api_errors("get keepa import scheduler settings")
def get_keepa_import_scheduler_settings(
    category: str = Query(default="dnk", pattern="^(dnk|clk|obz|ref|bor|sff|tev|cha)$"),
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Per-vendor schedule for automated Keepa Import File builds."""
    cat = _normalize_category(category)
    return _read_keepa_import_scheduler_settings(db, cat)


@router.get("/keepa-import-export/scheduler/next-run")
@handle_api_errors("get keepa import scheduler next run")
def get_keepa_import_scheduler_next_run(
    category: str = Query(default="dnk", pattern="^(dnk|clk|obz|ref|bor|sff|tev|cha)$"),
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Next scheduled Keepa Import File run for a vendor."""
    cat = _normalize_category(category)
    settings = _read_keepa_import_scheduler_settings(db, cat)
    tz_str = settings["timezone"]
    hour = settings["hour"]
    minute = settings["minute"]
    run_mode = settings["run_mode"]
    custom_days = settings["custom_days"]

    try:
        current_tz = pytz_timezone(tz_str)
    except Exception:
        current_tz = pytz_timezone("America/Chicago")
        tz_str = "America/Chicago"

    try:
        is_running = scheduler.running
    except (AttributeError, RuntimeError):
        is_running = False

    job = None
    try:
        job = scheduler.get_job(keepa_import_job_id(cat))
    except Exception:
        pass

    schedule_label = {
        "daily": "Daily",
        "every_other_day": "Every other day",
        "custom_days": f"Custom days ({', '.join(custom_days)})" if custom_days else "Custom days",
    }.get(run_mode, "Daily")
    scheduled_time_str = f"{hour:02d}:{minute:02d} {tz_str} - {schedule_label}"

    if not settings["enabled"] or not job or not job.next_run_time:
        return {
            "next_run_time": None,
            "next_run_time_local": None,
            "scheduled_time": scheduled_time_str,
            "timezone": tz_str,
            "run_mode": run_mode,
            "custom_days": custom_days,
            "enabled": settings["enabled"],
            "message": "Keepa Import schedule is off" if not settings["enabled"] else "Scheduler not configured",
            "seconds_until": None,
            "is_running": is_running,
        }

    next_run = job.next_run_time.astimezone(current_tz)
    now = datetime.now(current_tz)
    time_diff = next_run - now
    if time_diff.total_seconds() < 0:
        next_run = next_run + timedelta(days=1)
        time_diff = next_run - now

    return {
        "next_run_time": next_run.isoformat(),
        "next_run_time_local": next_run.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "scheduled_time": scheduled_time_str,
        "timezone": tz_str,
        "run_mode": run_mode,
        "custom_days": custom_days,
        "enabled": settings["enabled"],
        "seconds_until": int(time_diff.total_seconds()),
        "is_running": is_running,
    }


@router.put("/keepa-import-export/scheduler/settings")
@handle_api_errors("update keepa import scheduler settings")
def update_keepa_import_scheduler_settings(
    settings_data: KeepaImportSchedulerSettingsUpdate,
    category: str = Query(default="dnk", pattern="^(dnk|clk|obz|ref|bor|sff|tev|cha)$"),
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Update per-vendor Keepa Import File schedule (isolated from daily runs)."""
    cat = _normalize_category(category)
    current = _read_keepa_import_scheduler_settings(db, cat)
    update_data: dict = {"updated_by": current_user["id"], "updated_at": datetime.utcnow().isoformat()}

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
            raise HTTPException(status_code=400, detail="Invalid run_mode")
        update_data["run_mode"] = settings_data.run_mode
    if settings_data.custom_days is not None:
        normalized_days = [
            day.lower().strip()
            for day in settings_data.custom_days
            if isinstance(day, str)
        ]
        invalid_days = [day for day in normalized_days if day not in VALID_WEEKDAYS]
        if invalid_days:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid custom_days values: {', '.join(invalid_days)}",
            )
        ordered_days = [
            d for d in ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] if d in normalized_days
        ]
        update_data["custom_days"] = ordered_days
    if settings_data.anchor_date is not None:
        if settings_data.anchor_date:
            try:
                datetime.strptime(settings_data.anchor_date, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="anchor_date must be YYYY-MM-DD")
        update_data["anchor_date"] = settings_data.anchor_date
    if settings_data.email_recipients is not None:
        allowed = _load_allowed_pool_emails(db, str(current_user["id"]))
        requested = _parse_recipients_csv(settings_data.email_recipients)
        filtered = [email for email in requested if email in allowed]
        update_data["email_recipients"] = ",".join(filtered) if filtered else None
    if settings_data.email_bcc_recipients is not None:
        allowed = _load_allowed_pool_emails(db, str(current_user["id"]))
        requested_bcc = _parse_recipients_csv(settings_data.email_bcc_recipients)
        filtered_bcc = [email for email in requested_bcc if email in allowed]
        update_data["email_bcc_recipients"] = ",".join(filtered_bcc) if filtered_bcc else None

    merged = {**current, **update_data}
    db.table(_KEEPA_IMPORT_SCHEDULER_TABLE).update(update_data).eq("category", cat).execute()

    update_keepa_import_scheduler(
        category=cat,
        timezone_str=merged["timezone"],
        hour=int(merged["hour"]),
        minute=int(merged["minute"]),
        enabled=bool(merged["enabled"]),
        run_mode=merged["run_mode"],
        custom_days=merged.get("custom_days") or [],
        anchor_date=merged.get("anchor_date"),
    )

    return {**_read_keepa_import_scheduler_settings(db, cat), "message": "Keepa Import schedule updated"}


@router.get("/keepa-import-export/settings")
@handle_api_errors("get keepa import export settings")
def get_keepa_import_export_settings(
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Return the global on/off flag (readable by any Keepa-access user)."""
    return {"enabled": _read_enabled(db)}


@router.put("/keepa-import-export/settings")
@handle_api_errors("update keepa import export settings")
def update_keepa_import_export_settings(
    payload: FeatureToggle,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase),
):
    """Enable/disable the tool globally (admin only)."""
    row = {
        "id": _SETTINGS_ROW_ID,
        "enabled": payload.enabled,
        "updated_by": current_user["id"],
        "updated_at": datetime.utcnow().isoformat(),
    }
    db.table(_SETTINGS_TABLE).upsert(row).execute()
    return {"enabled": payload.enabled}


@router.get("/keepa-import-export/{category}/count")
@handle_api_errors("get keepa import export upc count")
def get_keepa_import_export_count(
    category: str,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """How many Manage UPCs would be included for this vendor."""
    cat = _normalize_category(category)
    upcs = _scoped_upcs(db, cat)
    return {"category": cat, "upc_count": len(upcs)}


@router.get("/keepa-import-export/builds/history")
@handle_api_errors("list keepa import build history")
def list_keepa_import_build_history(
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Return all Keepa Import File builds (newest first), visible to every user."""
    rows = KeepaImportBuildHistoryRepository(db).list_all()
    return [_history_summary_from_row(row) for row in rows]


@router.get("/keepa-import-export/builds/history/{build_id}/download")
@handle_api_errors("download keepa import build history file")
def download_keepa_import_build_history(
    build_id: str,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Download a completed build from the persistent history archive."""
    repo = KeepaImportBuildHistoryRepository(db)
    row = repo.get_by_id(build_id)
    if not row:
        raise HTTPException(status_code=404, detail="Build not found.")
    if row.get("status") == "building":
        raise HTTPException(status_code=409, detail="Build is still in progress.")
    if row.get("status") == "failed":
        raise HTTPException(
            status_code=500,
            detail=row.get("error") or "Build failed.",
        )
    file_bytes, filename = repo.get_file_bytes(build_id)
    if not file_bytes or not filename:
        raise HTTPException(status_code=500, detail="Build file is missing.")

    return _streaming_excel_response(file_bytes, filename)


@router.get(
    "/keepa-import-export/builds/history/{build_id}/contents",
    response_model=KeepaImportBuildContentsResponse,
)
@handle_api_errors("get keepa import build history contents")
def get_keepa_import_build_history_contents(
    build_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=1000),
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Return parsed rows from a completed Keepa Import File build for preview."""
    repo = KeepaImportBuildHistoryRepository(db)
    row = repo.get_by_id(build_id)
    if not row:
        raise HTTPException(status_code=404, detail="Build not found.")
    if row.get("status") == "building":
        raise HTTPException(status_code=409, detail="Build is still in progress.")
    if row.get("status") != "complete":
        raise HTTPException(
            status_code=409,
            detail="Report contents are only available for completed builds.",
        )
    file_bytes, filename = repo.get_file_bytes(build_id)
    if not file_bytes:
        raise HTTPException(status_code=500, detail="Build file is missing.")

    parsed_rows, total = parse_keepa_import_workbook(
        file_bytes, offset=offset, limit=limit
    )
    return KeepaImportBuildContentsResponse(
        build_id=build_id,
        filename=filename or row.get("filename"),
        category=row.get("category", ""),
        total=total,
        offset=offset,
        limit=limit,
        rows=parsed_rows,
    )


@router.get("/keepa-import-export/builds/active")
@handle_api_errors("get active keepa import build")
async def get_active_keepa_import_build(
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Return the caller's most recent in-memory build so a reopened client can
    resume progress (or download a finished file) without its saved build id."""
    build = await keepa_import_build_store.get_active_for_user(current_user["id"])
    if build:
        return {"build": build.to_status_dict()}

    history_row = await asyncio.to_thread(
        KeepaImportBuildHistoryRepository(db).get_active_for_user,
        current_user["id"],
    )
    if history_row:
        return {"build": _status_from_history(history_row)}
    return {"build": None}


@router.get("/keepa-import-export/builds/{build_id}/status")
@handle_api_errors("get keepa import build status")
async def get_keepa_import_build_status(
    build_id: str,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Poll progress for an async Keepa Import File build."""
    build = await keepa_import_build_store.get_for_user(build_id, current_user["id"])
    if build:
        return build.to_status_dict()

    history_row = await asyncio.to_thread(
        KeepaImportBuildHistoryRepository(db).get_for_user,
        build_id,
        current_user["id"],
    )
    if history_row:
        return _status_from_history(history_row)
    raise HTTPException(status_code=404, detail="Build not found.")


@router.post("/keepa-import-export/builds/{build_id}/cancel")
@handle_api_errors("cancel keepa import build")
async def cancel_keepa_import_build(
    build_id: str,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Stop a still-running Keepa Import File build."""
    user_id = current_user["id"]
    repo = KeepaImportBuildHistoryRepository(db)

    build = await keepa_import_build_store.get_for_user(build_id, user_id)
    if build and build.status == "building":
        await keepa_import_build_store.cancel(build_id, user_id)

    history_row = await asyncio.to_thread(repo.get_for_user, build_id, user_id)
    if not history_row:
        if not build:
            raise HTTPException(status_code=404, detail="Build not found.")
        return {
            "build_id": build_id,
            "status": build.status,
            "cancelled": build.status == "cancelled",
        }

    if history_row.get("status") == "building":
        await asyncio.to_thread(repo.cancel, build_id)
        return {"build_id": build_id, "status": "cancelled", "cancelled": True}

    return {
        "build_id": build_id,
        "status": history_row.get("status", "unknown"),
        "cancelled": False,
    }


@router.get("/keepa-import-export/builds/{build_id}/download")
@handle_api_errors("download keepa import build file")
async def download_keepa_import_build(
    build_id: str,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Download a completed async Keepa Import File build."""
    build = await keepa_import_build_store.get_by_id(build_id)
    if build:
        if build.status == "building":
            raise HTTPException(status_code=409, detail="Build is still in progress.")
        if build.status == "failed":
            raise HTTPException(
                status_code=500,
                detail=build.error or "Build failed.",
            )
        if build.file_bytes and build.filename:
            return _streaming_excel_response(build.file_bytes, build.filename)

    repo = KeepaImportBuildHistoryRepository(db)
    row = await asyncio.to_thread(repo.get_by_id, build_id)
    if not row:
        raise HTTPException(status_code=404, detail="Build not found.")
    if row.get("status") == "building":
        raise HTTPException(status_code=409, detail="Build is still in progress.")
    if row.get("status") == "failed":
        raise HTTPException(
            status_code=500,
            detail=row.get("error") or "Build failed.",
        )
    file_bytes, filename = repo.get_file_bytes(build_id)
    if not file_bytes or not filename:
        raise HTTPException(status_code=500, detail="Build file is missing.")

    return _streaming_excel_response(file_bytes, filename)


@router.post("/keepa-import-export/{category}/build", response_model=BuildStartResponse)
@handle_api_errors("start keepa import export build")
async def start_keepa_import_export_build(
    category: str,
    include_header: bool = True,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Start an async Keepa Import File build and return a build id for polling."""
    cat = _normalize_category(category)
    _require_enabled(db)

    if await is_category_build_active(db, cat):
        raise HTTPException(
            status_code=409,
            detail=f"A Keepa Import File build is already running for {cat.upper()}.",
        )

    creator_name = await asyncio.to_thread(_keepa_build_creator_name, current_user, db)
    try:
        build_id = await launch_keepa_import_build(
            db,
            current_user["id"],
            cat,
            created_by_name=creator_name,
            include_header=include_header,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    upcs = await asyncio.to_thread(_scoped_upcs, db, cat)
    return BuildStartResponse(build_id=build_id, upc_count=len(upcs), category=cat)


@router.get("/keepa-import-export/{category}/download")
@handle_api_errors("download keepa import export file")
async def download_keepa_import_export(
    category: str,
    include_header: bool = True,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Fetch Keepa data for the vendor's Manage UPCs and return an .xlsx file."""
    cat = _normalize_category(category)
    _require_enabled(db)

    # Sync Supabase read off the event loop.
    upcs = await asyncio.to_thread(_scoped_upcs, db, cat)
    if not upcs:
        raise HTTPException(
            status_code=400,
            detail="No UPCs found in Manage UPCs for this vendor.",
        )

    seller_name_map = await asyncio.to_thread(_seller_name_map, db)

    file_bytes = await generate_keepa_import_file(
        upcs, seller_name_map=seller_name_map, include_header=include_header
    )

    filename = f"{cat.upper()}_Keepa_{datetime.now().strftime('%m.%d.%y')}.xlsx"
    return StreamingResponse(
        BytesIO(file_bytes),
        media_type=_EXCEL_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
