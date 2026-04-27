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
from app.services.price_analyzer import PriceAnalyzer
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


def _build_synthetic_keepa_for_upc(rows: List[dict]) -> dict:
    first = rows[0] if rows else {}
    asin = str(first.get("asin") or "").strip()
    title = str(first.get("product_title") or "").strip()
    amazon_link = str(first.get("amazon_link") or "").strip()
    offers = []
    for row in rows:
        seller_name = str(row.get("seller") or "").strip() or "Unknown"
        seller_price = _normalize_price(row.get("seller_price"))
        if seller_price is None:
            continue
        offers.append({
            "sellerId": _seller_id_for_name(seller_name),
            "sellerName": seller_name,
            "price": int(round(seller_price * 100)),
        })
    buy_box_seller_id = ""
    if offers:
        cheapest = min(offers, key=lambda o: o["price"])
        buy_box_seller_id = str(cheapest.get("sellerId") or "")
    return {
        "products": [{
            "asin": asin,
            "title": title,
            "stats": {"buyBoxSellerId": buy_box_seller_id},
            "current_sellers": offers,
            "amazon_link": amazon_link,
        }]
    }


def _expand_uploaded_payload_to_rows(payload: List[dict]) -> List[dict]:
    """
    Backward/forward compatible payload reader:
    - old payload: list of row dicts with seller/seller_price
    - compact payload: list of per-upc dicts with offers[]
    """
    if not payload:
        return []
    sample = payload[0] if isinstance(payload[0], dict) else {}
    if "offers" not in sample:
        return payload

    expanded: List[dict] = []
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        upc = str(entry.get("upc") or "").strip()
        if not upc:
            continue
        base = {
            "upc": upc,
            "product_title": str(entry.get("product_title") or "").strip(),
            "asin": str(entry.get("asin") or "").strip(),
            "amazon_link": str(entry.get("amazon_link") or "").strip(),
        }
        offers = entry.get("offers") or []
        if not offers:
            expanded.append({**base, "seller": "", "seller_price": None})
            continue
        for offer in offers:
            expanded.append({
                **base,
                "seller": str((offer or {}).get("seller") or "").strip(),
                "seller_price": (offer or {}).get("seller_price"),
            })
    return expanded

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
        uploaded_rows: List[dict] = []
        if input_mode == "uploaded":
            local_today = datetime.now(config.timezone).date().isoformat()
            uploaded_response = (
                db.table("scheduler_uploaded_reports")
                .select("id, upcs, parsed_rows, parse_status")
                .eq("category", category)
                .eq("uploaded_for_date", local_today)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if uploaded_response.data:
                report = uploaded_response.data[0]
                parse_status = (report.get("parse_status") or "").strip().lower()
                if parse_status != "completed":
                    logger.warning(
                        "Uploaded report for %s on %s is not ready yet (status=%s); skipping run",
                        category.upper(),
                        local_today,
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
                        "off_price_scope": "buybox_and_non_buybox_below_map",
                    }).execute()
                    return
                uploaded_payload = report.get("parsed_rows") or []
                uploaded_rows = _expand_uploaded_payload_to_rows(uploaded_payload)
                # Uploaded mode always uses Manage UPCs (per-vendor app UPC list)
                # as the run scope; uploaded file rows are comparison input only.
                upc_repo = UPCRepository(db)
                upcs = upc_repo.get_all_upc_codes(category)
            else:
                logger.warning(
                    "No uploaded report found for %s on %s; creating failed daily run entry",
                    category.upper(),
                    local_today,
                )
                db.table("batch_jobs").insert({
                    "job_name": f"Daily {category.upper()} Uploaded Report - {current_time.strftime('%Y-%m-%d')}",
                    "status": "failed",
                    "total_batches": 0,
                    "completed_batches": 0,
                    "created_by": str(admin_uuid),
                    "completed_at": datetime.utcnow().isoformat(),
                    "error_message": "Missing uploaded Keepa report for scheduled run date.",
                    "email_recipients": custom_recipients,
                    "map_vendor_type": category,
                    "keepa_offers_limit": settings.keepa_offers_limit,
                    "off_price_scope": "buybox_and_non_buybox_below_map",
                }).execute()
                return
        else:
            upc_repo = UPCRepository(db)
            upcs = upc_repo.get_all_upc_codes(category)

        if upcs:
            logger.info(f"Found {len(upcs)} {category.upper()} UPCs to process")
            job_name_prefix = "Uploaded Report" if input_mode == "uploaded" else "Off Price Report"
            job_name = f"Daily {category.upper()} {job_name_prefix} - {current_time.strftime('%Y-%m-%d')}"
            job_id = await processor.create_batch_job(
                job_name=job_name,
                upcs=upcs,
                created_by=admin_uuid,
                email_recipients=custom_recipients,
                keepa_offers_limit=settings.keepa_offers_limit,
                map_vendor_type=category,
                off_price_scope="buybox_and_non_buybox_below_map",
            )
            logger.info(f"Created {category.upper()} batch job {job_id} with {len(upcs)} UPCs. Processing...")
            if input_mode == "uploaded":
                map_repo = MAPRepository(db)
                map_prices = map_repo.get_map_prices_by_upcs(upcs, vendor_type=category)
                analyzer = PriceAnalyzer()

                if not uploaded_rows:
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
                upc_to_rows = {}
                for row in uploaded_rows:
                    upc = str(row.get("upc") or "").strip()
                    if not upc or upc not in upc_scope:
                        continue
                    upc_to_rows.setdefault(upc, []).append(row)

                if not upc_to_rows:
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

                # Build synthetic keepa payloads and alerts once per UPC (reuse per batch item).
                keepa_by_upc = {}
                alerts_by_upc = {}
                for upc, rows in upc_to_rows.items():
                    keepa_data = _build_synthetic_keepa_for_upc(rows)
                    keepa_by_upc[upc] = keepa_data
                    map_price = map_prices.get(upc)
                    if map_price is None:
                        continue
                    try:
                        alerts = analyzer.detect_off_price_sellers(
                            upc=upc,
                            keepa_data=keepa_data,
                            map_price=float(map_price),
                        )
                        alerts_by_upc[upc] = alerts
                    except Exception as alert_err:
                        logger.warning("Could not evaluate uploaded off-price alerts for UPC %s: %s", upc, alert_err)

                # Flatten alert rows once and insert in chunks.
                alert_rows = []
                now_iso = datetime.utcnow().isoformat()
                for upc, alerts in alerts_by_upc.items():
                    map_price = map_prices.get(upc)
                    keepa_data = keepa_by_upc.get(upc, {})
                    for alert in alerts:
                        alert_rows.append({
                            "batch_job_id": str(job_id),
                            "upc": upc,
                            "seller_name": alert.get("seller_name"),
                            "current_price": alert.get("current_price"),
                            "historical_price": float(map_price) if map_price is not None else None,
                            "price_change_percent": alert.get("price_change_percent"),
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

                    # Bulk-update item rows grouped by UPC to reduce DB round trips.
                    ids_by_upc = {}
                    for item in batch_items:
                        upc = str(item.get("upc") or "").strip()
                        if not upc:
                            continue
                        ids_by_upc.setdefault(upc, []).append(item["id"])

                    for upc, item_ids in ids_by_upc.items():
                        keepa_data = keepa_by_upc.get(upc) or _build_synthetic_keepa_for_upc(upc_to_rows.get(upc, []))
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

                # Keep daily-run behavior: generate/export report and send email.
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

