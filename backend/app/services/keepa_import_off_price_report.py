"""Off-price MAP report for completed Keepa Import File builds."""
from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from supabase import Client

from app.config import settings
from app.repositories.keepa_import_build_history_repository import (
    KeepaImportBuildHistoryRepository,
)
from app.repositories.map_repository import MAPRepository
from app.repositories.seller_name_repository import SellerNameRepository
from app.repositories.upc_repository import UPCRepository
from app.scheduler import (
    _build_synthetic_uploaded_offer,
    _normalize_price,
    find_uploaded_off_price_match,
)
from app.services.csv_generator import CSVGenerator
from app.services.email_service import EmailService
from app.services.keepa_import_export import parse_all_keepa_import_workbook
from app.utils.email_recipient_utils import parse_recipient_csv

logger = logging.getLogger(__name__)

# Match daily import uploaded-mode jobs: direct column-H price vs MAP, not buy-box stats.
UPLOADED_OFF_PRICE_SCOPE = "buybox_and_non_buybox_below_map"


def _parse_workbook_row(row: dict[str, str]) -> Optional[dict[str, Any]]:
    upc = str(row.get("upc") or "").strip()
    if not upc:
        return None
    price = _normalize_price(row.get("buy_box_price"))
    seller = str(row.get("buy_box_seller") or "").strip() or "Keepa Import"
    return {
        "upc": upc,
        "product_title": str(row.get("title") or "").strip(),
        "asin": str(row.get("asin") or "").strip(),
        "amazon_link": str(row.get("amazon_url") or "").strip(),
        "uploaded_price": price,
        "uploaded_seller": seller,
        "uploaded_candidates": [
            {
                "uploaded_price": price,
                "uploaded_seller": seller,
            }
        ],
    }


def generate_off_price_report_bytes(
    file_bytes: bytes,
    *,
    category: str,
    db: Client,
) -> tuple[bytes, int, int]:
    """Generate the off-price Excel attachment bytes."""
    cat = (category or "").strip().lower()
    rows = parse_all_keepa_import_workbook(file_bytes)
    upcs = UPCRepository(db).get_all_upc_codes(cat)
    upc_scope = {str(u).strip() for u in upcs if str(u).strip()}

    upc_to_entry: dict[str, dict[str, Any]] = {}
    for row in rows:
        entry = _parse_workbook_row(row)
        if not entry:
            continue
        upc = entry["upc"]
        if upc not in upc_scope or upc in upc_to_entry:
            continue
        upc_to_entry[upc] = entry

    map_prices = MAPRepository(db).get_map_prices_by_upcs(list(upc_scope), vendor_type=cat)
    map_decimals = {
        upc: Decimal(str(price))
        for upc, price in map_prices.items()
        if price is not None
    }
    processed_items = []
    for upc, entry in upc_to_entry.items():
        match = find_uploaded_off_price_match(entry, map_prices.get(upc))
        if not match:
            continue
        selected_entry, _map_f = match
        processed_items.append({
            "upc": upc,
            "keepa_data": _build_synthetic_uploaded_offer(selected_entry),
        })
    seller_name_map = SellerNameRepository(db).get_seller_name_map()
    csv_bytes, off_price_count = CSVGenerator.generate_comprehensive_report_csv(
        processed_items=processed_items,
        map_prices_by_upc=map_decimals,
        seller_name_map=seller_name_map,
        excluded_seller_substrings=settings.report_excluded_seller_pattern_list,
        off_price_scope=UPLOADED_OFF_PRICE_SCOPE,
    )
    return csv_bytes, len(upc_scope), off_price_count


def _off_price_job_name(category: str) -> str:
    vendor = category.strip().upper()
    run_date = datetime.utcnow().strftime("%m.%d.%y")
    return f"Keepa Import Off-Price - {vendor} - {run_date}"


def _off_price_filename(category: str) -> str:
    vendor = category.strip().upper()
    run_date = datetime.utcnow().strftime("%m.%d.%y")
    return f"{vendor}_Keepa_Import_Off_Price_{run_date}.xlsx"


def claim_off_price_email_send(db: Client, build_id: str) -> bool:
    now = datetime.utcnow().isoformat()
    try:
        resp = (
            db.table("keepa_import_build_history")
            .update({"off_price_email_sent_at": now})
            .eq("id", build_id)
            .is_("off_price_email_sent_at", "null")
            .eq("status", "complete")
            .execute()
        )
        return bool(resp.data)
    except Exception as exc:
        logger.warning("Could not claim off-price email for build %s: %s", build_id, exc)
        return False


def send_keepa_import_off_price_email(
    db: Client,
    *,
    build_id: str,
    category: str,
    file_bytes: bytes,
    email_recipients: Optional[str],
    email_bcc_recipients: Optional[str],
    email_subject_template: Optional[str] = None,
    email_body_template: Optional[str] = None,
) -> bool:
    """Generate and email the off-price MAP report for one completed import build."""
    recipients = parse_recipient_csv(email_recipients)
    bcc_list = parse_recipient_csv(email_bcc_recipients)
    if not recipients and not bcc_list:
        logger.info("No off-price recipients for Keepa Import build %s; skipping", build_id)
        return False

    if not claim_off_price_email_send(db, build_id):
        logger.info("Off-price email already sent for build %s; skipping", build_id)
        return False

    try:
        report_bytes, total_upcs, alerts_count = generate_off_price_report_bytes(
            file_bytes,
            category=category,
            db=db,
        )
    except Exception as exc:
        logger.exception("Failed to generate off-price report for build %s: %s", build_id, exc)
        return False

    vendor = category.strip().lower()
    job_name = _off_price_job_name(vendor)
    filename = _off_price_filename(vendor)

    sent = EmailService().send_csv_report(
        csv_bytes=report_bytes,
        filename=filename,
        job_name=job_name,
        total_upcs=total_upcs,
        alerts_count=alerts_count,
        recipient_email=",".join(recipients) if recipients else None,
        vendor=vendor,
        bcc_emails=bcc_list,
        use_default_recipients=False,
        email_subject_template=email_subject_template,
        email_body_template=email_body_template,
    )
    if sent:
        logger.info("Off-price email sent for Keepa Import build %s", build_id)
    else:
        logger.error("Failed to send off-price email for Keepa Import build %s", build_id)
    return sent


async def send_off_price_for_build_id(
    db: Client,
    build_id: str,
    *,
    settings_row: Optional[dict] = None,
) -> bool:
    """Load a completed build from history and email its off-price report."""
    repo = KeepaImportBuildHistoryRepository(db)
    row = repo.get_by_id(build_id)
    if not row or row.get("status") != "complete":
        logger.warning("Build %s is not complete; cannot send off-price report", build_id)
        return False

    file_bytes, _filename = repo.get_file_bytes(build_id)
    if not file_bytes:
        logger.warning("Build %s has no stored file; cannot send off-price report", build_id)
        return False

    category = str(row.get("category") or "").strip().lower()
    if settings_row is None:
        settings_row = _load_off_price_settings(db, category)

    return send_keepa_import_off_price_email(
        db,
        build_id=build_id,
        category=category,
        file_bytes=file_bytes,
        email_recipients=settings_row.get("off_price_email_recipients"),
        email_bcc_recipients=settings_row.get("off_price_email_bcc_recipients"),
        email_subject_template=settings_row.get("off_price_email_subject_template"),
        email_body_template=settings_row.get("off_price_email_body_template"),
    )


def _load_off_price_settings(db: Client, category: str) -> dict:
    try:
        resp = (
            db.table("keepa_import_scheduler_settings")
            .select("*")
            .eq("category", category.strip().lower())
            .limit(1)
            .execute()
        )
        if resp.data:
            return resp.data[0]
    except Exception as exc:
        logger.warning("Could not load off-price settings for %s: %s", category, exc)
    return {}


async def send_off_price_for_latest_complete_build(
    db: Client,
    category: str,
) -> bool:
    """Email off-price report for the newest completed import build for a vendor."""
    cat = category.strip().lower()
    settings_row = _load_off_price_settings(db, cat)
    try:
        resp = (
            db.table("keepa_import_build_history")
            .select("id")
            .eq("category", cat)
            .eq("status", "complete")
            .order("completed_at", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("No completed Keepa Import build for %s to run off-price report", cat.upper())
            return False
        build_id = str(resp.data[0]["id"])
    except Exception as exc:
        logger.warning("Could not load latest complete build for %s: %s", cat, exc)
        return False

    return await send_off_price_for_build_id(db, build_id, settings_row=settings_row)
