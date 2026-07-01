"""APScheduler jobs for automated Keepa Import File builds.

Uses the shared AsyncIOScheduler instance but separate job ids
(``keepa_import_{category}_job``) so daily runs and import-file schedules
never replace or block one another.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import List, Optional

from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from pytz import timezone

from app.database import get_supabase
from app.scheduler import scheduler
from app.services.keepa_import_build_runner import (
    KeepaImportEmailNotify,
    is_category_build_active,
    launch_keepa_import_build,
)

logger = logging.getLogger(__name__)

_TABLE = "keepa_import_scheduler_settings"
_VALID_CATEGORIES = ("dnk", "clk", "obz", "ref", "bor", "sff", "tev", "cha")
_MISFIRE_GRACE_SECONDS = 3600


def _job_id(category: str) -> str:
    return f"keepa_import_{category}_job"


def _resolve_scheduler_user_id(db, settings_row: dict) -> Optional[str]:
    uid = settings_row.get("updated_by")
    if uid:
        return str(uid)
    try:
        resp = (
            db.table("profiles")
            .select("id")
            .eq("has_keepa_access", True)
            .limit(1)
            .execute()
        )
        if resp.data:
            return str(resp.data[0]["id"])
    except Exception as exc:
        logger.warning("Could not resolve scheduler user for keepa import: %s", exc)
    return None


def _tool_enabled(db) -> bool:
    try:
        resp = (
            db.table("keepa_import_export_settings")
            .select("enabled")
            .eq("id", "00000000-0000-0000-0000-000000000000")
            .limit(1)
            .execute()
        )
        if resp.data:
            return bool(resp.data[0].get("enabled", True))
    except Exception:
        pass
    return True


async def run_scheduled_keepa_import(category: str) -> None:
    """Cron callback: start a Keepa Import File build if idle."""
    cat = (category or "").strip().lower()
    logger.info("Scheduled Keepa Import File tick for %s", cat.upper())

    db = get_supabase()
    if not _tool_enabled(db):
        logger.info("Keepa Import File tool is off; skipping scheduled run for %s", cat.upper())
        return

    try:
        resp = (
            db.table(_TABLE)
            .select("*")
            .eq("category", cat)
            .limit(1)
            .execute()
        )
        settings = resp.data[0] if resp.data else None
    except Exception as exc:
        logger.error("Could not load keepa import scheduler settings: %s", exc)
        return

    if not settings or not settings.get("enabled"):
        logger.info("Keepa Import scheduler disabled for %s", cat.upper())
        return

    if await is_category_build_active(db, cat):
        logger.info(
            "Skipping scheduled Keepa Import for %s — a build is already in progress",
            cat.upper(),
        )
        return

    user_id = _resolve_scheduler_user_id(db, settings)
    if not user_id:
        logger.error("No user id for scheduled Keepa Import run (%s)", cat.upper())
        return

    email_notify = KeepaImportEmailNotify(
        recipients=settings.get("email_recipients"),
        bcc_recipients=settings.get("email_bcc_recipients"),
        category=cat,
    )

    try:
        build_id = await launch_keepa_import_build(
            db,
            user_id,
            cat,
            created_by_name="Scheduled run",
            email_notify=email_notify,
            skip_if_active=True,
        )
        logger.info("Scheduled Keepa Import build started for %s: %s", cat.upper(), build_id)
    except RuntimeError as exc:
        logger.info("Scheduled Keepa Import skipped for %s: %s", cat.upper(), exc)
    except Exception as exc:
        logger.exception("Scheduled Keepa Import failed for %s: %s", cat.upper(), exc)


def setup_keepa_import_scheduler(
    *,
    category: str,
    timezone_str: str = "America/Chicago",
    hour: int = 6,
    minute: int = 0,
    run_mode: str = "daily",
    custom_days: Optional[List[str]] = None,
    anchor_date: Optional[str] = None,
) -> None:
    """Register (or replace) the APScheduler job for one vendor."""
    cat = category.strip().lower()
    try:
        tz = timezone(timezone_str)
    except Exception:
        tz = timezone("America/Chicago")
        timezone_str = "America/Chicago"

    if run_mode == "custom_days":
        day_of_week = ",".join(custom_days or [])
        trigger = CronTrigger(
            day_of_week=day_of_week,
            hour=hour,
            minute=minute,
            timezone=tz,
        )
        desc = f"custom days ({day_of_week}) at {hour:02d}:{minute:02d} {timezone_str}"
    elif run_mode == "every_other_day":
        try:
            if anchor_date:
                anchor_dt = datetime.strptime(anchor_date, "%Y-%m-%d")
            else:
                now_local = datetime.now(tz)
                anchor_dt = datetime(now_local.year, now_local.month, now_local.day)
            start_date = tz.localize(
                datetime(anchor_dt.year, anchor_dt.month, anchor_dt.day, hour, minute)
            )
        except Exception:
            now_local = datetime.now(tz)
            start_date = tz.localize(
                datetime(now_local.year, now_local.month, now_local.day, hour, minute)
            )
        trigger = IntervalTrigger(days=2, start_date=start_date, timezone=tz)
        desc = f"every other day at {hour:02d}:{minute:02d} {timezone_str}"
    else:
        trigger = CronTrigger(hour=hour, minute=minute, timezone=tz)
        desc = f"daily at {hour:02d}:{minute:02d} {timezone_str}"

    scheduler.add_job(
        run_scheduled_keepa_import,
        trigger=trigger,
        args=[cat],
        id=_job_id(cat),
        name=f"{cat.upper()} Keepa Import File - {desc}",
        replace_existing=True,
        misfire_grace_time=_MISFIRE_GRACE_SECONDS,
        coalesce=True,
    )
    logger.info("Keepa Import scheduler for %s: %s", cat.upper(), desc)


def pause_keepa_import_scheduler(category: str) -> None:
    job_id = _job_id(category.strip().lower())
    try:
        scheduler.remove_job(job_id)
        logger.info("Keepa Import scheduler paused for %s", category.upper())
    except Exception:
        pass


def update_keepa_import_scheduler(
    *,
    category: str,
    timezone_str: str = "America/Chicago",
    hour: int = 6,
    minute: int = 0,
    enabled: bool = True,
    run_mode: str = "daily",
    custom_days: Optional[List[str]] = None,
    anchor_date: Optional[str] = None,
) -> None:
    cat = category.strip().lower()
    pause_keepa_import_scheduler(cat)
    if enabled:
        setup_keepa_import_scheduler(
            category=cat,
            timezone_str=timezone_str,
            hour=hour,
            minute=minute,
            run_mode=run_mode,
            custom_days=custom_days,
            anchor_date=anchor_date,
        )
    else:
        logger.info("Keepa Import scheduler disabled for %s", cat.upper())


def load_all_keepa_import_schedulers_from_db(db) -> None:
    """Called on app startup to restore cron jobs from persisted settings."""
    for cat in _VALID_CATEGORIES:
        try:
            resp = (
                db.table(_TABLE)
                .select("*")
                .eq("category", cat)
                .limit(1)
                .execute()
            )
            if not resp.data:
                continue
            row = resp.data[0]
            if not row.get("enabled"):
                continue
            update_keepa_import_scheduler(
                category=cat,
                timezone_str=row.get("timezone", "America/Chicago"),
                hour=int(row.get("hour", 6)),
                minute=int(row.get("minute", 0)),
                enabled=True,
                run_mode=row.get("run_mode", "daily"),
                custom_days=row.get("custom_days") or [],
                anchor_date=row.get("anchor_date"),
            )
        except Exception as exc:
            logger.warning("Could not load keepa import scheduler for %s: %s", cat, exc)
