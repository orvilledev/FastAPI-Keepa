"""APScheduler jobs for Keepa Import off-price MAP reports (separate from file builds)."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional

from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from pytz import timezone

from app.database import get_supabase
from app.scheduler import scheduler
from app.services.keepa_import_off_price_report import send_off_price_for_latest_complete_build

logger = logging.getLogger(__name__)

_TABLE = "keepa_import_scheduler_settings"
_VALID_CATEGORIES = ("dnk", "clk", "obz", "ref", "bor", "sff", "tev", "cha")
_MISFIRE_GRACE_SECONDS = 3600


def _job_id(category: str) -> str:
    return f"keepa_import_offprice_{category}_job"


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


async def run_scheduled_keepa_import_off_price(category: str) -> None:
    """Cron callback: email off-price report from the latest completed import build."""
    cat = (category or "").strip().lower()
    logger.info("Scheduled Keepa Import off-price report tick for %s", cat.upper())

    db = get_supabase()
    if not _tool_enabled(db):
        logger.info("Keepa Import tool is off; skipping off-price report for %s", cat.upper())
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
        logger.error("Could not load off-price scheduler settings: %s", exc)
        return

    if not settings or not settings.get("off_price_enabled"):
        logger.info("Keepa Import off-price schedule disabled for %s", cat.upper())
        return

    recipients = (settings.get("off_price_email_recipients") or "").strip()
    bcc = (settings.get("off_price_email_bcc_recipients") or "").strip()
    if not recipients and not bcc:
        logger.info("No off-price recipients for %s; skipping scheduled report", cat.upper())
        return

    try:
        sent = await send_off_price_for_latest_complete_build(db, cat)
        if sent:
            logger.info("Scheduled off-price report emailed for %s", cat.upper())
        else:
            logger.info("Scheduled off-price report skipped for %s", cat.upper())
    except Exception as exc:
        logger.exception("Scheduled off-price report failed for %s: %s", cat.upper(), exc)


def setup_keepa_import_off_price_scheduler(
    *,
    category: str,
    timezone_str: str = "America/Chicago",
    hour: int = 7,
    minute: int = 0,
    run_mode: str = "daily",
    custom_days: Optional[List[str]] = None,
    anchor_date: Optional[str] = None,
) -> None:
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
        run_scheduled_keepa_import_off_price,
        trigger=trigger,
        args=[cat],
        id=_job_id(cat),
        name=f"{cat.upper()} Keepa Import Off-Price - {desc}",
        replace_existing=True,
        misfire_grace_time=_MISFIRE_GRACE_SECONDS,
        coalesce=True,
    )
    logger.info("Keepa Import off-price scheduler for %s: %s", cat.upper(), desc)


def pause_keepa_import_off_price_scheduler(category: str) -> None:
    job_id = _job_id(category.strip().lower())
    try:
        scheduler.remove_job(job_id)
        logger.info("Keepa Import off-price scheduler paused for %s", category.upper())
    except Exception:
        pass


def update_keepa_import_off_price_scheduler(
    *,
    category: str,
    timezone_str: str = "America/Chicago",
    hour: int = 7,
    minute: int = 0,
    enabled: bool = True,
    run_mode: str = "daily",
    custom_days: Optional[List[str]] = None,
    anchor_date: Optional[str] = None,
) -> None:
    cat = category.strip().lower()
    pause_keepa_import_off_price_scheduler(cat)
    if enabled:
        setup_keepa_import_off_price_scheduler(
            category=cat,
            timezone_str=timezone_str,
            hour=hour,
            minute=minute,
            run_mode=run_mode,
            custom_days=custom_days,
            anchor_date=anchor_date,
        )
    else:
        logger.info("Keepa Import off-price scheduler disabled for %s", cat.upper())


def load_all_keepa_import_off_price_schedulers_from_db(db) -> None:
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
            if not row.get("off_price_enabled"):
                continue
            update_keepa_import_off_price_scheduler(
                category=cat,
                timezone_str=row.get("off_price_timezone", "America/Chicago"),
                hour=int(row.get("off_price_hour", 7)),
                minute=int(row.get("off_price_minute", 0)),
                enabled=True,
                run_mode=row.get("off_price_run_mode", "daily"),
                custom_days=row.get("off_price_custom_days") or [],
                anchor_date=row.get("off_price_anchor_date"),
            )
        except Exception as exc:
            logger.warning("Could not load off-price scheduler for %s: %s", cat, exc)
