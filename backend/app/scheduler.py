"""APScheduler setup for daily automated job execution."""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
import logging
from pytz import timezone
from app.config import settings
from app.database import get_supabase
from app.repositories.upc_repository import UPCRepository
from app.repositories.map_repository import MAPRepository
from app.services.batch_processor import BatchProcessor
from app.services.email_service import EmailService
from app.services.report_service import ReportService
from typing import List, Optional
from dataclasses import dataclass
from datetime import datetime
import hashlib

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


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

# Default configurations for DNK, CLK, OBZ, REF, BOR, SFF, TEV, and CHA
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
        custom_recipients = None
        input_mode = "api"

        try:
            category_settings_response = (
                db.table("scheduler_settings")
                .select("email_recipients, input_mode")
                .eq("category", category)
                .limit(1)
                .execute()
            )
            if category_settings_response.data:
                custom_recipients = category_settings_response.data[0].get("email_recipients")
                input_mode = (category_settings_response.data[0].get("input_mode") or "api").strip().lower()

        except Exception as recipients_err:
            logger.warning(f"Could not load scheduler email recipients for {category.upper()}: {recipients_err}")
        
        # Get admin user ID (or system user)
        profiles_response = db.table("profiles").select("id").eq("role", "admin").limit(1).execute()
        
        if not profiles_response.data:
            logger.error("No admin user found for automated job")
            return
        
        admin_id = profiles_response.data[0]["id"]
        from uuid import UUID
        admin_uuid = UUID(admin_id)

        # Resolve UPC source for this run mode.
        upcs: List[str] = []
        uploaded_entries: List[dict] = []
        if input_mode == "uploaded":
            uploaded_response = (
                db.table("scheduler_uploaded_reports")
                .select("id, upcs, parsed_rows, parse_status, created_at")
                .eq("category", category)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if uploaded_response.data:
                report = uploaded_response.data[0]
                parse_status = (report.get("parse_status") or "").strip().lower()
                if parse_status != "completed":
                    logger.warning(
                        "Latest uploaded report for %s is not ready yet (status=%s); skipping run",
                        category.upper(),
                        parse_status or "pending",
                    )
                    db.table("batch_jobs").insert({
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
                        "off_price_scope": "buybox_only",
                    }).execute()
                    return
                uploaded_payload = report.get("parsed_rows") or []
                uploaded_entries = _normalize_uploaded_payload(uploaded_payload)
                # Uploaded mode always uses Manage UPCs (per-vendor app UPC list)
                # as the run scope; uploaded file rows are comparison input only.
                upc_repo = UPCRepository(db)
                upcs = upc_repo.get_all_upc_codes(category)
            else:
                logger.warning(
                    "No uploaded report found for %s; creating failed daily run entry",
                    category.upper(),
                )
                db.table("batch_jobs").insert({
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
                    "off_price_scope": "buybox_only",
                }).execute()
                return
        else:
            upc_repo = UPCRepository(db)
            upcs = upc_repo.get_all_upc_codes(category)

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
                keepa_offers_limit=settings.keepa_offers_limit,
                map_vendor_type=category,
                off_price_scope=run_off_price_scope,
            )
            logger.info(f"Created {category.upper()} batch job {job_id} with {len(upcs)} UPCs. Processing...")
            if input_mode == "uploaded":
                map_repo = MAPRepository(db)
                map_prices = map_repo.get_map_prices_by_upcs(upcs, vendor_type=category)

                if not uploaded_entries:
                    logger.warning(
                        "Uploaded mode run for %s has no parsed rows in uploaded report; failing run",
                        category.upper(),
                    )
                    db.table("batch_jobs").update({
                        "status": "failed",
                        "completed_at": datetime.utcnow().isoformat(),
                        "error_message": "Uploaded Keepa report has no parsed rows for comparison.",
                    }).eq("id", str(job_id)).execute()
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
                    db.table("batch_jobs").update({
                        "status": "failed",
                        "completed_at": datetime.utcnow().isoformat(),
                        "error_message": "No overlapping UPCs between uploaded file and Manage UPCs.",
                    }).eq("id", str(job_id)).execute()
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
                    if map_price is None:
                        keepa_by_upc[upc] = _build_synthetic_uploaded_offer(entry)
                        continue
                    try:
                        map_f = float(map_price)
                    except (TypeError, ValueError):
                        keepa_by_upc[upc] = _build_synthetic_uploaded_offer(entry)
                        continue
                    if map_f <= 0:
                        keepa_by_upc[upc] = _build_synthetic_uploaded_offer(entry)
                        continue

                    candidates = entry.get("uploaded_candidates")
                    if not isinstance(candidates, list) or not candidates:
                        candidates = [entry]

                    selected_entry = None
                    selected_price = None
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
                        selected_entry = cand
                        selected_price = uploaded_f
                        break

                    # Keep first candidate for traceability in batch item Keepa payload even
                    # when no off-price candidate is found.
                    keepa_source = selected_entry or (candidates[0] if candidates else entry)
                    keepa_data = _build_synthetic_uploaded_offer(keepa_source)
                    keepa_by_upc[upc] = keepa_data
                    if selected_entry is None or selected_price is None:
                        continue

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
                        db.table("price_alerts").insert(alert_rows[i:i + chunk_size]).execute()

                # Fill existing batch items with synthetic Keepa-like payloads.
                batches_resp = db.table("upc_batches").select("id").eq("batch_job_id", str(job_id)).execute()
                for batch in batches_resp.data or []:
                    batch_id = batch["id"]
                    items_resp = db.table("upc_batch_items").select("id, upc").eq("upc_batch_id", batch_id).execute()
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
                        db.table("upc_batch_items").update({
                            "status": "completed",
                            "keepa_data": keepa_data,
                            "processed_at": processed_at_iso,
                        }).in_("id", item_ids).execute()

                    db.table("upc_batches").update({
                        "status": "completed",
                        "processed_count": completed_count,
                        "completed_at": datetime.utcnow().isoformat(),
                    }).eq("id", batch_id).execute()

                total_batches = len(batches_resp.data or [])
                db.table("batch_jobs").update({
                    "status": "completed",
                    "completed_batches": total_batches,
                    "completed_at": datetime.utcnow().isoformat(),
                }).eq("id", str(job_id)).execute()

                # Generate the off-price CSV (one row per flagged UPC) and email it.
                try:
                    report_service = ReportService(db)
                    csv_bytes, filename, alerts_count = report_service.generate_csv_for_job(
                        job_id,
                        job_name,
                        map_vendor_type=category,
                        off_price_scope="buybox_and_non_buybox_below_map",
                    )
                    total_upcs = report_service.get_total_upcs_for_job(job_id)
                    EmailService().send_csv_report(
                        csv_bytes=csv_bytes,
                        filename=filename,
                        job_name=job_name,
                        total_upcs=total_upcs,
                        alerts_count=alerts_count,
                        custom_recipients=custom_recipients,
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

