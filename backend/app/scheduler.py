"""APScheduler setup for daily automated job execution."""
import asyncio

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
import logging
from pytz import timezone
from app.config import settings
from app.database import get_supabase
from app.repositories.upc_repository import UPCRepository
from app.repositories.map_repository import MAPRepository
from app.services.batch_processor import BatchProcessor
from app.services.daily_run_completion import (
    daily_run_email_already_claimed,
    release_category_daily_run_lock,
    scheduled_uploaded_run_completed_today,
    send_daily_run_completion_email_for_job,
    try_acquire_category_daily_run_lock,
    uploaded_daily_run_in_progress,
)
from app.utils.notifications import create_notification, create_completion_notifications_for_all_profiles
from typing import Any, Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib

logger = logging.getLogger(__name__)

# Daily/import runs must not disappear when APScheduler wakes seconds or minutes late
# (restart, overload, clustered cron). Default grace is tight; ~7min misses were skipping runs.
_scheduler_misfire_grace_seconds = 3600

scheduler = AsyncIOScheduler(
    job_defaults={
        "misfire_grace_time": _scheduler_misfire_grace_seconds,
        "coalesce": True,
    },
)

DEFAULT_UPLOADED_REPORT_WAIT_TIMEOUT_SECONDS = 90
UPLOADED_REPORT_WAIT_POLL_SECONDS = 3
VALID_INPUT_MODES = {"api", "uploaded"}
# In-memory fail-safe used only when scheduler_settings cannot be read reliably.
# This avoids surprising mode flips to API during transient DB/read issues.
_last_known_input_mode: dict[str, str] = {}


def remember_input_mode(category: str, mode: str) -> None:
    """Persist the latest valid scheduler input mode in-memory for fallback use."""
    normalized_category = str(category or "").strip().lower()
    normalized_mode = str(mode or "").strip().lower()
    if not normalized_category or normalized_mode not in VALID_INPUT_MODES:
        return
    _last_known_input_mode[normalized_category] = normalized_mode


async def _run_sync(op):
    """Run a synchronous I/O call off the event loop to keep FastAPI responsive."""
    return await asyncio.to_thread(op)


def _normalize_price(value) -> Optional[float]:
    if value is None:
        return None
    try:
        num = float(str(value).replace("$", "").replace(",", "").strip())
        return num if num > 0 else None
    except Exception:
        return None


def _seller_id_for_name(name: str) -> str:
    base = (name or "unknown_seller").strip().lower()
    digest = hashlib.md5(base.encode("utf-8")).hexdigest()[:12]
    return f"UPLD{digest}"


def _build_synthetic_uploaded_offer(entry: dict) -> dict:
    """Build a minimal Keepa-shaped payload for one UPC from uploaded data.

    Uploaded daily runs ignore buy-box semantics. Each UPC contributes a single
    synthetic offer carrying the uploaded price + seller for traceability so the
    shared report generator can render the row using direct UPC vs MAP logic.
    """
    asin = str(entry.get("asin") or "").strip()
    title = str(entry.get("product_title") or "").strip()
    amazon_link = str(entry.get("amazon_link") or "").strip()
    uploaded_value = _normalize_price(
        entry.get("uploaded_price") if entry.get("uploaded_price") is not None
        else entry.get("buy_box_current")
    )
    uploaded_seller = str(
        entry.get("uploaded_seller")
        or entry.get("buy_box_seller")
        or ""
    ).strip() or "Uploaded Report"

    offers: List[dict] = []
    if uploaded_value is not None:
        offers.append({
            "sellerId": _seller_id_for_name(uploaded_seller),
            "sellerName": uploaded_seller,
            "price": int(round(uploaded_value * 100)),
        })

    return {
        "products": [{
            "asin": asin,
            "title": title,
            "stats": {},
            "current_sellers": offers,
            "amazon_link": amazon_link,
        }]
    }


def find_uploaded_off_price_match(
    entry: dict,
    map_price: Any,
) -> Optional[tuple[dict, float]]:
    """Return the first uploaded candidate priced below MAP (import-mode rules)."""
    if map_price is None:
        return None
    try:
        map_f = float(map_price)
    except (TypeError, ValueError):
        return None
    if map_f <= 0:
        return None

    candidates = entry.get("uploaded_candidates")
    if not isinstance(candidates, list) or not candidates:
        candidates = [entry]

    for cand in candidates:
        if not isinstance(cand, dict):
            continue
        uploaded_value = cand.get("uploaded_price")
        try:
            uploaded_f = float(uploaded_value) if uploaded_value is not None else None
        except (TypeError, ValueError):
            uploaded_f = None
        if uploaded_f is None or uploaded_f <= 0:
            continue
        if uploaded_f >= map_f:
            continue
        merged = {**entry, **cand}
        return merged, map_f
    return None


def _normalize_uploaded_payload(payload: List[dict]) -> List[dict]:
    """Normalize stored parsed_rows into per-UPC dicts with `uploaded_price`.

    Accepts compact format and stays backward compatible with older stored shapes:
      - per-UPC entries with `uploaded_candidates[]` (preferred)
      - legacy `buy_box_current` / `buy_box_seller` entries — mapped 1:1 to
        `uploaded_price` / `uploaded_seller`.
      - per-UPC entries with `offers[]` — `uploaded_price` is taken as the
        lowest valid offer price.
      - flat row entries with `seller` / `seller_price` — first valid price
        per UPC is used.
    """
    if not payload:
        return []

    by_upc: dict = {}
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        upc = str(entry.get("upc") or "").strip()
        if not upc:
            continue

        base = by_upc.get(upc) or {
            "upc": upc,
            "product_title": str(entry.get("product_title") or "").strip(),
            "asin": str(entry.get("asin") or "").strip(),
            "amazon_link": str(entry.get("amazon_link") or "").strip(),
            "uploaded_price": None,
            "uploaded_seller": "",
            "uploaded_candidates": [],
        }

        # Preferred shape: explicit ordered candidates for duplicate UPC rows.
        if isinstance(entry.get("uploaded_candidates"), list) and entry.get("uploaded_candidates"):
            candidates = []
            for cand in entry.get("uploaded_candidates") or []:
                if not isinstance(cand, dict):
                    continue
                cand_price = _normalize_price(cand.get("uploaded_price"))
                cand_seller = str(cand.get("uploaded_seller") or "").strip()
                cand_title = str(cand.get("product_title") or "").strip()
                cand_asin = str(cand.get("asin") or "").strip()
                cand_link = str(cand.get("amazon_link") or "").strip()
                candidates.append({
                    "uploaded_price": float(cand_price) if cand_price is not None else None,
                    "uploaded_seller": cand_seller,
                    "product_title": cand_title,
                    "asin": cand_asin,
                    "amazon_link": cand_link,
                })
            if candidates:
                base["uploaded_candidates"].extend(candidates)
                first_valid = next((c for c in candidates if c.get("uploaded_price") is not None), None)
                if base["uploaded_price"] is None and first_valid is not None:
                    base["uploaded_price"] = float(first_valid["uploaded_price"])
                    base["uploaded_seller"] = first_valid.get("uploaded_seller") or ""
                for field in ("product_title", "asin", "amazon_link"):
                    if not base.get(field):
                        fallback = next((c.get(field) for c in candidates if c.get(field)), "")
                        if fallback:
                            base[field] = str(fallback).strip()
        elif "uploaded_price" in entry or "buy_box_current" in entry:
            raw_price = entry.get("uploaded_price")
            if raw_price is None:
                raw_price = entry.get("buy_box_current")
            raw_seller = entry.get("uploaded_seller")
            if not raw_seller:
                raw_seller = entry.get("buy_box_seller")
            price_value = _normalize_price(raw_price)
            base["uploaded_candidates"].append({
                "uploaded_price": float(price_value) if price_value is not None else None,
                "uploaded_seller": str(raw_seller or "").strip(),
                "product_title": str(entry.get("product_title") or "").strip(),
                "asin": str(entry.get("asin") or "").strip(),
                "amazon_link": str(entry.get("amazon_link") or "").strip(),
            })
            if base["uploaded_price"] is None and price_value is not None:
                base["uploaded_price"] = float(price_value)
                base["uploaded_seller"] = str(raw_seller or "").strip()
        elif "offers" in entry:
            offers = entry.get("offers") or []
            best_price: Optional[float] = None
            best_seller = ""
            for offer in offers:
                if not isinstance(offer, dict):
                    continue
                price = _normalize_price(offer.get("seller_price"))
                if price is None:
                    continue
                price_f = float(price)
                if best_price is None or price_f < best_price:
                    best_price = price_f
                    best_seller = str(offer.get("seller") or "").strip()
            if base["uploaded_price"] is None and best_price is not None:
                base["uploaded_price"] = best_price
                base["uploaded_seller"] = best_seller
            base["uploaded_candidates"].append({
                "uploaded_price": best_price,
                "uploaded_seller": best_seller,
                "product_title": str(entry.get("product_title") or "").strip(),
                "asin": str(entry.get("asin") or "").strip(),
                "amazon_link": str(entry.get("amazon_link") or "").strip(),
            })
        else:
            price = _normalize_price(entry.get("seller_price"))
            if base["uploaded_price"] is None and price is not None:
                base["uploaded_price"] = float(price)
                base["uploaded_seller"] = str(entry.get("seller") or "").strip()
            base["uploaded_candidates"].append({
                "uploaded_price": float(price) if price is not None else None,
                "uploaded_seller": str(entry.get("seller") or "").strip(),
                "product_title": str(entry.get("product_title") or "").strip(),
                "asin": str(entry.get("asin") or "").strip(),
                "amazon_link": str(entry.get("amazon_link") or "").strip(),
            })

        for field in ("product_title", "asin", "amazon_link"):
            if not base.get(field) and entry.get(field):
                base[field] = str(entry.get(field) or "").strip()

        by_upc[upc] = base

    return list(by_upc.values())


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

# Default configurations for DNK, CLK, OBZ, REF, BOR, SFF, TEV, CHA, and JFS
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
    ),
    'obz': SchedulerConfig(
        timezone=timezone('America/Chicago'),
        hour=6,
        minute=0,
        category='obz',
        run_mode='daily',
        custom_days=None,
        anchor_date=None
    ),
    'ref': SchedulerConfig(
        timezone=timezone('America/Chicago'),
        hour=6,
        minute=0,
        category='ref',
        run_mode='daily',
        custom_days=None,
        anchor_date=None
    ),
    'bor': SchedulerConfig(
        timezone=timezone('America/Chicago'),
        hour=6,
        minute=0,
        category='bor',
        run_mode='daily',
        custom_days=None,
        anchor_date=None
    ),
    'sff': SchedulerConfig(
        timezone=timezone('America/Chicago'),
        hour=6,
        minute=0,
        category='sff',
        run_mode='daily',
        custom_days=None,
        anchor_date=None
    ),
    'tev': SchedulerConfig(
        timezone=timezone('America/Chicago'),
        hour=6,
        minute=0,
        category='tev',
        run_mode='daily',
        custom_days=None,
        anchor_date=None
    ),
    'cha': SchedulerConfig(
        timezone=timezone('America/Chicago'),
        hour=6,
        minute=0,
        category='cha',
        run_mode='daily',
        custom_days=None,
        anchor_date=None
    ),
    'jfs': SchedulerConfig(
        timezone=timezone('America/Chicago'),
        hour=6,
        minute=0,
        category='jfs',
        run_mode='daily',
        custom_days=None,
        anchor_date=None
    )
}


async def run_daily_job_for_category(category: str = 'dnk', forced_input_mode: Optional[str] = None):
    """Execute daily batch job for a specific category (DNK or CLK)."""
    if not await try_acquire_category_daily_run_lock(category):
        logger.warning(
            "%s daily run already in progress on this worker; skipping duplicate invocation",
            category.upper(),
        )
        return

    try:
        await _run_daily_job_for_category_impl(category, forced_input_mode)
    finally:
        release_category_daily_run_lock(category)


async def _run_daily_job_for_category_impl(category: str = 'dnk', forced_input_mode: Optional[str] = None):
    """Inner daily run implementation (caller holds the per-category lock)."""
    try:
        from datetime import datetime
        config = _scheduler_configs.get(category, _scheduler_configs['dnk'])
        current_time = datetime.now(config.timezone)
        tz_name = str(config.timezone).split('/')[-1] if '/' in str(config.timezone) else str(config.timezone)
        logger.info(f"Starting {category.upper()} daily batch job execution at {current_time.strftime('%Y-%m-%d %H:%M:%S %Z')} {tz_name} time")
        
        db = get_supabase()
        processor = BatchProcessor()
        custom_recipients = None
        custom_bcc_recipients = None
        email_subject_template = None
        email_body_template = None
        input_mode = "api"
        normalized_forced_mode = (forced_input_mode or "").strip().lower()
        if normalized_forced_mode and normalized_forced_mode not in {"api", "uploaded"}:
            logger.warning(
                "Ignoring invalid forced_input_mode=%s for %s",
                forced_input_mode,
                category.upper(),
            )
            normalized_forced_mode = ""

        try:
            category_settings_response = await _run_sync(
                lambda: db.table("scheduler_settings")
                .select(
                    "email_recipients, email_bcc_recipients, input_mode, "
                    "uploaded_wait_timeout_seconds, email_subject_template, email_body_template"
                )
                .eq("category", category)
                .limit(1)
                .execute()
            )
            if category_settings_response.data:
                custom_recipients = category_settings_response.data[0].get("email_recipients")
                custom_bcc_recipients = category_settings_response.data[0].get("email_bcc_recipients")
                email_subject_template = category_settings_response.data[0].get("email_subject_template")
                email_body_template = category_settings_response.data[0].get("email_body_template")
                raw_mode = str(category_settings_response.data[0].get("input_mode") or "").strip().lower()
                if raw_mode in VALID_INPUT_MODES:
                    input_mode = raw_mode
                    remember_input_mode(category, raw_mode)
                else:
                    fallback_mode = _last_known_input_mode.get(category, "api")
                    logger.warning(
                        "Invalid/missing input_mode for %s (value=%r); using last-known mode=%s",
                        category.upper(),
                        raw_mode or None,
                        fallback_mode,
                    )
                    input_mode = fallback_mode
                wait_timeout_raw = category_settings_response.data[0].get("uploaded_wait_timeout_seconds")
                try:
                    uploaded_wait_timeout_seconds = int(wait_timeout_raw)
                except (TypeError, ValueError):
                    uploaded_wait_timeout_seconds = DEFAULT_UPLOADED_REPORT_WAIT_TIMEOUT_SECONDS
                uploaded_wait_timeout_seconds = max(0, min(900, uploaded_wait_timeout_seconds))
            else:
                uploaded_wait_timeout_seconds = DEFAULT_UPLOADED_REPORT_WAIT_TIMEOUT_SECONDS
                fallback_mode = _last_known_input_mode.get(category, "api")
                logger.warning(
                    "No scheduler_settings row found for %s; using last-known mode=%s",
                    category.upper(),
                    fallback_mode,
                )
                input_mode = fallback_mode

        except Exception as recipients_err:
            logger.warning(f"Could not load scheduler email recipients for {category.upper()}: {recipients_err}")
            uploaded_wait_timeout_seconds = DEFAULT_UPLOADED_REPORT_WAIT_TIMEOUT_SECONDS
            fallback_mode = _last_known_input_mode.get(category, "api")
            logger.warning(
                "Falling back to last-known input mode for %s: %s",
                category.upper(),
                fallback_mode,
            )
            input_mode = fallback_mode

        if normalized_forced_mode:
            input_mode = normalized_forced_mode
            logger.info(
                "Overriding %s run mode to %s (forced)",
                category.upper(),
                input_mode,
            )

        run_date = current_time.strftime("%Y-%m-%d")
        if input_mode == "uploaded" and not normalized_forced_mode:
            if await _run_sync(
                lambda: scheduled_uploaded_run_completed_today(db, category, run_date)
            ):
                logger.info(
                    "Skipping scheduled %s import run — an uploaded daily job already completed on %s",
                    category.upper(),
                    run_date,
                )
                return
            if await _run_sync(lambda: uploaded_daily_run_in_progress(db, category)):
                logger.info(
                    "Skipping scheduled %s import run — an uploaded daily job is already in progress",
                    category.upper(),
                )
                return
            if await _run_sync(
                lambda: daily_run_email_already_claimed(
                    db, category, run_date, run_kind="uploaded"
                )
            ):
                logger.info(
                    "Skipping scheduled %s import run — completion email already claimed for %s",
                    category.upper(),
                    run_date,
                )
                return

        # Get admin user ID (or system user)
        profiles_response = await _run_sync(
            lambda: db.table("profiles").select("id").eq("role", "admin").limit(1).execute()
        )
        
        if not profiles_response.data:
            logger.error("No admin user found for automated job")
            return
        
        admin_id = profiles_response.data[0]["id"]
        from uuid import UUID
        admin_uuid = UUID(admin_id)

        async def notify_admin(notification_type: str, title: str, message: str, priority: str = "info", related_job_id: Optional[str] = None):
            try:
                await asyncio.to_thread(
                    lambda: create_notification(
                        db=db,
                        user_id=admin_uuid,
                        notification_type=notification_type,
                        title=title,
                        message=message,
                        priority=priority,
                        related_id=UUID(str(related_job_id)) if related_job_id else None,
                        related_type="job" if related_job_id else None,
                        action_label="View Dashboard",
                        action_url="/dashboard",
                    )
                )
            except Exception as notify_err:
                logger.warning("Failed to create scheduler notification: %s", notify_err)

        # Resolve UPC source for this run mode.
        upcs: List[str] = []
        uploaded_entries: List[dict] = []
        if input_mode == "uploaded":
            report = None
            deadline = datetime.utcnow().timestamp() + uploaded_wait_timeout_seconds
            while datetime.utcnow().timestamp() <= deadline:
                uploaded_response = await _run_sync(
                    lambda: db.table("scheduler_uploaded_reports")
                    .select("id, upcs, parsed_rows, parse_status, created_at")
                    .eq("category", category)
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                report = uploaded_response.data[0] if uploaded_response.data else None
                if not report:
                    break

                parse_status = (report.get("parse_status") or "").strip().lower()
                if parse_status == "completed":
                    break
                if parse_status == "failed":
                    logger.warning(
                        "Latest uploaded report for %s parse failed; waiting for replacement report",
                        category.upper(),
                    )
                else:
                    logger.info(
                        "Latest uploaded report for %s not ready (status=%s); waiting %ss",
                        category.upper(),
                        parse_status or "pending",
                        UPLOADED_REPORT_WAIT_POLL_SECONDS,
                    )
                await asyncio.sleep(UPLOADED_REPORT_WAIT_POLL_SECONDS)

            if report:
                parse_status = (report.get("parse_status") or "").strip().lower()
                if parse_status != "completed":
                    logger.warning(
                        "Latest uploaded report for %s is not ready after waiting (status=%s); skipping run",
                        category.upper(),
                        parse_status or "pending",
                    )
                    await _run_sync(lambda: db.table("batch_jobs").insert({
                        "job_name": f"Daily {category.upper()} Uploaded Report - {current_time.strftime('%Y-%m-%d')}",
                        "status": "failed",
                        "total_batches": 0,
                        "completed_batches": 0,
                        "created_by": str(admin_uuid),
                        "completed_at": datetime.utcnow().isoformat(),
                        "error_message": f"Uploaded report not ready yet (status: {parse_status or 'pending'}).",
                        "email_recipients": custom_recipients,
                        "map_vendor_type": category,
                        "keepa_offers_limit": settings.keepa_offers_limit,
                        "off_price_scope": "buybox_and_non_buybox_below_map",
                    }).execute())
                    await notify_admin(
                        "import_missing_file",
                        f"Import Mode blocked: {category.upper()}",
                        f"Scheduled run skipped because uploaded report parse is {parse_status or 'pending'}.",
                        "critical",
                    )
                    return
                uploaded_payload = report.get("parsed_rows") or []
                uploaded_entries = _normalize_uploaded_payload(uploaded_payload)
                # Uploaded mode always uses Manage UPCs (per-vendor app UPC list)
                # as the run scope; uploaded file rows are comparison input only.
                upc_repo = UPCRepository(db)
                upcs = await _run_sync(lambda: upc_repo.get_all_upc_codes(category))
            else:
                logger.warning(
                    "No uploaded report found for %s; creating failed daily run entry",
                    category.upper(),
                )
                await _run_sync(lambda: db.table("batch_jobs").insert({
                    "job_name": f"Daily {category.upper()} Uploaded Report - {current_time.strftime('%Y-%m-%d')}",
                    "status": "failed",
                    "total_batches": 0,
                    "completed_batches": 0,
                    "created_by": str(admin_uuid),
                    "completed_at": datetime.utcnow().isoformat(),
                    "error_message": "Missing uploaded Keepa report for scheduled run.",
                    "email_recipients": custom_recipients,
                    "map_vendor_type": category,
                    "keepa_offers_limit": settings.keepa_offers_limit,
                    "off_price_scope": "buybox_and_non_buybox_below_map",
                }).execute())
                await notify_admin(
                    "import_missing_file",
                    f"Import Mode blocked: {category.upper()}",
                    "Scheduled run skipped because no uploaded report was found.",
                    "critical",
                )
                return
        else:
            upc_repo = UPCRepository(db)
            upcs = await _run_sync(lambda: upc_repo.get_all_upc_codes(category))

        if upcs:
            logger.info(f"Found {len(upcs)} {category.upper()} UPCs to process")
            job_name_prefix = "Uploaded Report" if input_mode == "uploaded" else "Off Price Report"
            job_name = f"Daily {category.upper()} {job_name_prefix} - {current_time.strftime('%Y-%m-%d')}"
            run_off_price_scope = "buybox_and_non_buybox_below_map"
            job_id = await processor.create_batch_job(
                job_name=job_name,
                upcs=upcs,
                created_by=admin_uuid,
                email_recipients=custom_recipients,
                email_bcc_recipients=custom_bcc_recipients,
                keepa_offers_limit=settings.keepa_offers_limit,
                map_vendor_type=category,
                off_price_scope=run_off_price_scope,
            )
            logger.info(f"Created {category.upper()} batch job {job_id} with {len(upcs)} UPCs. Processing...")
            if input_mode == "uploaded":
                map_repo = MAPRepository(db)
                map_prices = await _run_sync(lambda: map_repo.get_map_prices_by_upcs(upcs, vendor_type=category))

                if not uploaded_entries:
                    logger.warning(
                        "Uploaded mode run for %s has no parsed rows in uploaded report; failing run",
                        category.upper(),
                    )
                    await _run_sync(lambda: db.table("batch_jobs").update({
                        "status": "failed",
                        "completed_at": datetime.utcnow().isoformat(),
                        "error_message": "Uploaded Keepa report has no parsed rows for comparison.",
                    }).eq("id", str(job_id)).execute())
                    await notify_admin(
                        "import_completed_with_errors",
                        f"Import run failed: {category.upper()}",
                        "Uploaded Keepa report has no parsed rows for comparison.",
                        "warning",
                        str(job_id),
                    )
                    return

                upc_scope = {str(u).strip() for u in upcs if str(u).strip()}
                upc_to_entry: dict = {}
                for entry in uploaded_entries:
                    upc = str(entry.get("upc") or "").strip()
                    if not upc or upc not in upc_scope:
                        continue
                    if upc not in upc_to_entry:
                        upc_to_entry[upc] = entry

                if not upc_to_entry:
                    logger.warning(
                        "Uploaded mode run for %s has no UPC overlap between uploaded file and Manage UPCs",
                        category.upper(),
                    )
                    await _run_sync(lambda: db.table("batch_jobs").update({
                        "status": "failed",
                        "completed_at": datetime.utcnow().isoformat(),
                        "error_message": "No overlapping UPCs between uploaded file and Manage UPCs.",
                    }).eq("id", str(job_id)).execute())
                    await notify_admin(
                        "import_completed_with_errors",
                        f"Import run failed: {category.upper()}",
                        "No overlapping UPCs between uploaded file and Manage UPCs.",
                        "warning",
                        str(job_id),
                    )
                    return

                # Direct UPC vs MAP comparison: ignore buy-box semantics. The
                # synthetic Keepa payload is only used to render the report row
                # for the matching UPC; flagging is decided here from the
                # uploaded price vs system MAP.
                keepa_by_upc: dict = {}
                alert_rows = []
                now_iso = datetime.utcnow().isoformat()
                for upc, entry in upc_to_entry.items():
                    map_price = map_prices.get(upc)
                    match = find_uploaded_off_price_match(entry, map_price)

                    candidates = entry.get("uploaded_candidates")
                    if not isinstance(candidates, list) or not candidates:
                        candidates = [entry]

                    # Keep first candidate for traceability in batch item Keepa payload even
                    # when no off-price candidate is found.
                    keepa_source = (
                        match[0]
                        if match
                        else (candidates[0] if candidates else entry)
                    )
                    keepa_data = _build_synthetic_uploaded_offer(keepa_source)
                    keepa_by_upc[upc] = keepa_data
                    if not match:
                        continue

                    selected_entry, map_f = match
                    selected_price = float(selected_entry.get("uploaded_price"))
                    price_change_percent = ((selected_price - map_f) / map_f) * 100 if map_f else 0.0
                    seller_display = str(selected_entry.get("uploaded_seller") or "").strip() or "Uploaded Report"
                    alert_rows.append({
                        "batch_job_id": str(job_id),
                        "upc": upc,
                        "seller_name": seller_display,
                        "current_price": selected_price,
                        "historical_price": map_f,
                        "price_change_percent": price_change_percent,
                        "detected_at": now_iso,
                        "keepa_data": keepa_data,
                    })

                if alert_rows:
                    chunk_size = 500
                    for i in range(0, len(alert_rows), chunk_size):
                        chunk = alert_rows[i:i + chunk_size]
                        await _run_sync(lambda c=chunk: db.table("price_alerts").insert(c).execute())

                # Fill existing batch items with synthetic Keepa-like payloads.
                batches_resp = await _run_sync(
                    lambda: db.table("upc_batches").select("id").eq("batch_job_id", str(job_id)).execute()
                )
                for batch in batches_resp.data or []:
                    batch_id = batch["id"]
                    items_resp = await _run_sync(
                        lambda bid=batch_id: db.table("upc_batch_items").select("id, upc").eq("upc_batch_id", bid).execute()
                    )
                    batch_items = items_resp.data or []
                    completed_count = len(batch_items)
                    processed_at_iso = datetime.utcnow().isoformat()

                    ids_by_upc: dict = {}
                    for item in batch_items:
                        upc = str(item.get("upc") or "").strip()
                        if not upc:
                            continue
                        ids_by_upc.setdefault(upc, []).append(item["id"])

                    for upc, item_ids in ids_by_upc.items():
                        keepa_data = keepa_by_upc.get(upc)
                        if keepa_data is None:
                            entry = upc_to_entry.get(upc)
                            keepa_data = _build_synthetic_uploaded_offer(entry or {"upc": upc})
                        kd, ids = keepa_data, item_ids
                        await _run_sync(lambda kd=kd, ids=ids: db.table("upc_batch_items").update({
                            "status": "completed",
                            "keepa_data": kd,
                            "processed_at": processed_at_iso,
                        }).in_("id", ids).execute())

                    bid = batch_id
                    cnt = completed_count
                    await _run_sync(lambda bid=bid, cnt=cnt: db.table("upc_batches").update({
                        "status": "completed",
                        "processed_count": cnt,
                        "completed_at": datetime.utcnow().isoformat(),
                    }).eq("id", bid).execute())

                total_batches = len(batches_resp.data or [])
                latest_job_resp = await _run_sync(
                    lambda: db.table("batch_jobs").select("status").eq("id", str(job_id)).limit(1).execute()
                )
                latest_job_status = (
                    str((latest_job_resp.data or [{}])[0].get("status") or "").strip().lower()
                    if latest_job_resp.data
                    else None
                )
                if latest_job_status in {None, "cancelled"}:
                    logger.info(
                        "Uploaded run for %s was %s before completion finalization; skipping completion/email",
                        category.upper(),
                        "deleted" if latest_job_status is None else "cancelled",
                    )
                    return
                tb = total_batches
                await _run_sync(lambda tb=tb: db.table("batch_jobs").update({
                    "status": "completed",
                    "completed_batches": tb,
                    "completed_at": datetime.utcnow().isoformat(),
                }).eq("id", str(job_id)).execute())
                await _run_sync(lambda: create_completion_notifications_for_all_profiles(
                    db,
                    notification_type="run_completed_clean",
                    title=f"Run completed: {job_name}",
                    message=f"Daily import run finished for {category.upper()} ({len(upcs)} UPCs). Visible to the whole team.",
                    priority="info",
                    related_id=UUID(str(job_id)),
                    related_type="job",
                    metadata={"job_name": job_name, "vendor": category, "total_upcs": len(upcs), "input_mode": "uploaded"},
                    action_label="View Express Jobs",
                    action_url="/jobs",
                ))

                # Generate the off-price CSV (one row per flagged UPC) and email it once.
                try:
                    latest_job_resp = await _run_sync(
                        lambda: db.table("batch_jobs").select("status").eq("id", str(job_id)).limit(1).execute()
                    )
                    latest_job_status = (
                        str((latest_job_resp.data or [{}])[0].get("status") or "").strip().lower()
                        if latest_job_resp.data
                        else None
                    )
                    if latest_job_status != "completed":
                        logger.info(
                            "Uploaded run for %s status changed to %s before email step; skipping email",
                            category.upper(),
                            latest_job_status or "missing",
                        )
                        return
                    await _run_sync(
                        lambda: send_daily_run_completion_email_for_job(
                            db,
                            job_id,
                            email_subject_template=email_subject_template,
                            email_body_template=email_body_template,
                        )
                    )
                except Exception as email_err:
                    logger.warning("Uploaded daily run email/report step failed for %s: %s", category.upper(), email_err)
            else:
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
        max_instances=1,
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


def same_day_job_id(category: str) -> str:
    return f"same_day_{category}_job"


def _resolve_category_timezone(category: str):
    """Vendor timezone from in-memory config, else America/Chicago."""
    config = _scheduler_configs.get(category)
    if config and getattr(config, "timezone", None) is not None:
        return config.timezone
    try:
        db = get_supabase()
        row = (
            db.table("scheduler_settings")
            .select("timezone")
            .eq("category", category)
            .limit(1)
            .execute()
        )
        tz_name = (row.data[0].get("timezone") if row.data else None) or "America/Chicago"
        return timezone(tz_name)
    except Exception:
        return timezone("America/Chicago")


def get_same_day_run(category: str) -> Optional[Dict[str, Any]]:
    """Return pending same-day one-off job info, or None. Does not touch recurring jobs."""
    job_id = same_day_job_id(category)
    try:
        job = scheduler.get_job(job_id)
    except Exception:
        job = None
    if not job or not job.next_run_time:
        return None
    tz = _resolve_category_timezone(category)
    run_at = job.next_run_time
    if run_at.tzinfo is None:
        run_at = tz.localize(run_at)
    else:
        run_at = run_at.astimezone(tz)
    now = datetime.now(tz)
    seconds_until = max(0, int((run_at - now).total_seconds()))
    return {
        "category": category,
        "job_id": job_id,
        "run_at": run_at.isoformat(),
        "run_at_local": run_at.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "timezone": str(tz),
        "seconds_until": seconds_until,
    }


def cancel_same_day_run(category: str) -> bool:
    """Cancel a pending same-day one-off. Returns True if a job was removed."""
    job_id = same_day_job_id(category)
    try:
        scheduler.remove_job(job_id)
        logger.info("%s same-day run cancelled", category.upper())
        return True
    except Exception:
        return False


def schedule_same_day_run(
    category: str,
    delay_hours: int = 0,
    delay_minutes: int = 0,
) -> Dict[str, Any]:
    """
    Schedule a one-off Daily Run after a user-chosen delay (same calendar day).

    Isolated from recurring schedule: does NOT change hour/minute/run_mode/enabled
    or the daily_{category}_job cron/interval job.
    """
    if delay_hours < 0 or delay_minutes < 0:
        raise ValueError("Delay hours and minutes must be non-negative")
    if delay_hours == 0 and delay_minutes == 0:
        raise ValueError("Set at least 1 minute of delay")
    if delay_minutes > 59:
        raise ValueError("Minutes must be between 0 and 59")
    if delay_hours > 23:
        raise ValueError("Hours must be between 0 and 23")

    total_minutes = delay_hours * 60 + delay_minutes
    if total_minutes < 1:
        raise ValueError("Set at least 1 minute of delay")
    if total_minutes > 23 * 60 + 59:
        raise ValueError("Delay is too long")

    tz = _resolve_category_timezone(category)
    now = datetime.now(tz)
    run_at = now + timedelta(hours=delay_hours, minutes=delay_minutes)

    if run_at.date() != now.date():
        raise ValueError(
            "Same Day Run must stay on today's calendar date in the vendor timezone. "
            "Shorten the delay so it fires before midnight."
        )

    job_id = same_day_job_id(category)
    scheduler.add_job(
        run_daily_job_for_category,
        trigger=DateTrigger(run_date=run_at, timezone=tz),
        args=[category],
        id=job_id,
        name=f"{category.upper()} Same Day Run at {run_at.strftime('%H:%M %Z')}",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=_scheduler_misfire_grace_seconds,
    )
    logger.info(
        "%s same-day run scheduled for %s (delay %sh %sm); recurring schedule unchanged",
        category.upper(),
        run_at.isoformat(),
        delay_hours,
        delay_minutes,
    )
    info = get_same_day_run(category)
    if not info:
        raise RuntimeError("Same-day job was scheduled but could not be read back")
    return {
        **info,
        "delay_hours": delay_hours,
        "delay_minutes": delay_minutes,
        "message": (
            f"{category.upper()} Same Day Run scheduled for {info['run_at_local']}. "
            "Recurring Daily Run schedule was not changed."
        ),
    }


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

