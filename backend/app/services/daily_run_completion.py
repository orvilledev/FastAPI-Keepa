"""Helpers to finalize daily/import runs without duplicate completion emails per job."""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime
from typing import Optional
from uuid import UUID

from supabase import Client

from app.repositories.job_repository import JobRepository
from app.services.email_service import EmailService
from app.services.report_service import ReportService
from app.utils.email_recipient_utils import parse_recipient_csv

logger = logging.getLogger(__name__)

_category_daily_run_locks: dict[str, asyncio.Lock] = {}
_JOB_DATE_RE = re.compile(r"(20\d{2}-\d{2}-\d{2})\s*$")


def _uploaded_daily_job_name_prefix(category: str) -> str:
    return f"Daily {category.strip().upper()} Uploaded Report"


def _normalize_vendor(category: Optional[str]) -> str:
    return (category or "").strip().lower()


def daily_run_kind_from_job_name(job_name: Optional[str]) -> str:
    name = (job_name or "").strip()
    if "Uploaded Report" in name:
        return "uploaded"
    return "api"


def resolve_daily_run_date(job_data: dict) -> Optional[str]:
    """YYYY-MM-DD for the daily run, from job_name or completed_at/created_at."""
    name = str(job_data.get("job_name") or "")
    match = _JOB_DATE_RE.search(name)
    if match:
        return match.group(1)
    for key in ("completed_at", "created_at"):
        raw = job_data.get(key)
        if not raw:
            continue
        try:
            return str(raw)[:10]
        except Exception:
            continue
    return None


async def try_acquire_category_daily_run_lock(category: str) -> bool:
    """Return False when another daily run for this vendor is already executing."""
    normalized = _normalize_vendor(category)
    lock = _category_daily_run_locks.setdefault(normalized, asyncio.Lock())
    if lock.locked():
        return False
    await lock.acquire()
    return True


def release_category_daily_run_lock(category: str) -> None:
    normalized = _normalize_vendor(category)
    lock = _category_daily_run_locks.get(normalized)
    if lock and lock.locked():
        lock.release()


def scheduled_uploaded_run_completed_today(db: Client, category: str, run_date: str) -> bool:
    """True if an uploaded-mode daily job already finished successfully today."""
    prefix = f"{_uploaded_daily_job_name_prefix(category)} - {run_date}"
    try:
        resp = (
            db.table("batch_jobs")
            .select("id")
            .eq("status", "completed")
            .ilike("job_name", f"{prefix}%")
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception as exc:
        logger.warning("Could not check uploaded daily completion for %s: %s", category, exc)
        return False


def uploaded_daily_run_in_progress(db: Client, category: str) -> bool:
    """True when a pending/processing uploaded daily job exists for this vendor."""
    prefix = _uploaded_daily_job_name_prefix(category)
    try:
        resp = (
            db.table("batch_jobs")
            .select("id")
            .in_("status", ["pending", "processing"])
            .ilike("job_name", f"{prefix}%")
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception as exc:
        logger.warning("Could not check in-progress uploaded daily run for %s: %s", category, exc)
        return False


def daily_run_email_already_claimed(
    db: Client,
    category: str,
    run_date: str,
    *,
    run_kind: str = "uploaded",
) -> bool:
    """True when a completion email claim already exists for this vendor/day/kind."""
    vendor = _normalize_vendor(category)
    kind = (run_kind or "uploaded").strip().lower()
    if kind not in {"uploaded", "api"}:
        kind = "uploaded"
    try:
        resp = (
            db.table("daily_run_email_claims")
            .select("vendor_code")
            .eq("vendor_code", vendor)
            .eq("run_date", run_date)
            .eq("run_kind", kind)
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception as exc:
        logger.warning(
            "Could not check daily_run_email_claims for %s %s %s: %s",
            vendor,
            run_date,
            kind,
            exc,
        )
        # Fallback: any sibling job already marked emailed
        return _sibling_completion_email_sent(db, vendor, run_date, kind)


def _sibling_completion_email_sent(
    db: Client,
    vendor: str,
    run_date: str,
    run_kind: str,
) -> bool:
    """Best-effort fallback when the claims table is missing."""
    if run_kind == "uploaded":
        prefix = f"Daily {vendor.upper()} Uploaded Report - {run_date}"
    else:
        prefix = f"Daily {vendor.upper()} Off Price Report - {run_date}"
    try:
        resp = (
            db.table("batch_jobs")
            .select("id")
            .ilike("job_name", f"{prefix}%")
            .not_.is_("completion_email_sent_at", "null")
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception as exc:
        logger.warning("Sibling email check failed for %s: %s", vendor, exc)
        return False


def claim_completion_email_send(db: Client, job_id: str) -> bool:
    """Atomically mark a job so only one completion email is ever sent for that job."""
    now = datetime.utcnow().isoformat()
    try:
        resp = (
            db.table("batch_jobs")
            .update({"completion_email_sent_at": now})
            .eq("id", job_id)
            .is_("completion_email_sent_at", "null")
            .execute()
        )
        return bool(resp.data)
    except Exception as exc:
        logger.warning("Could not claim completion email for job %s: %s", job_id, exc)
        return False


def claim_daily_run_email_for_vendor_day(
    db: Client,
    *,
    vendor: str,
    run_date: str,
    run_kind: str,
    job_id: str,
) -> bool:
    """
    Record that a vendor/day/kind completion email was attempted.

    Historically this gated "one email per vendor per day". Sending is now once
    per job only (see ``claim_completion_email_send``), so callers should not
    skip mail based on this return value. Kept for compatibility / optional audit.
    """
    vendor_code = _normalize_vendor(vendor)
    kind = (run_kind or "uploaded").strip().lower()
    if kind not in {"uploaded", "api"}:
        kind = "uploaded"
    if not vendor_code or not run_date:
        return True

    payload = {
        "vendor_code": vendor_code,
        "run_date": run_date,
        "run_kind": kind,
        "job_id": job_id,
        "claimed_at": datetime.utcnow().isoformat(),
    }
    try:
        resp = db.table("daily_run_email_claims").insert(payload).execute()
        return bool(resp.data)
    except Exception as exc:
        msg = str(exc).lower()
        if "duplicate" in msg or "unique" in msg or "23505" in msg:
            logger.info(
                "daily_run_email_claims already has %s %s (%s); newer job %s may still email",
                vendor_code.upper(),
                run_date,
                kind,
                job_id,
            )
            return False
        logger.warning(
            "daily_run_email_claims insert failed for %s %s: %s",
            vendor_code,
            run_date,
            exc,
        )
        if _sibling_completion_email_sent(db, vendor_code, run_date, kind):
            return False
        return True


def send_daily_run_completion_email_for_job(
    db: Client,
    job_id: UUID,
    *,
    email_subject_template: Optional[str] = None,
    email_body_template: Optional[str] = None,
) -> bool:
    """
    Generate the off-price CSV and email it once per job.

    A new Import / Trigger run gets its own job id, so it can email again the same
    calendar day. Jobs that already claimed ``completion_email_sent_at`` are never
    resent (including older same-day jobs that were skipped or already mailed).
    """
    job_id_str = str(job_id)
    if not claim_completion_email_send(db, job_id_str):
        logger.info("Completion email already sent for job %s; skipping duplicate", job_id_str)
        return False

    job_resp = db.table("batch_jobs").select("*").eq("id", job_id_str).limit(1).execute()
    if not job_resp.data:
        logger.warning("Cannot send completion email — job %s not found", job_id_str)
        return False

    job_data = job_resp.data[0]
    if (job_data.get("status") or "").strip().lower() != "completed":
        logger.info(
            "Skipping completion email for job %s — status is %r",
            job_id_str,
            job_data.get("status"),
        )
        return False

    job_name = job_data.get("job_name") or "Express Job"
    vendor = (job_data.get("map_vendor_type") or "").strip().lower() or None
    off_price_scope = job_data.get("off_price_scope") or "buybox_only"
    recipient_csv = job_data.get("email_recipients")
    bcc_csv = job_data.get("email_bcc_recipients")
    is_daily_run = JobRepository._is_daily_run_job(job_name)

    recipient_csv = recipient_csv if recipient_csv and str(recipient_csv).strip() else None
    bcc_list = parse_recipient_csv(
        bcc_csv if bcc_csv and str(bcc_csv).strip() else None
    )
    has_recipients = bool(parse_recipient_csv(recipient_csv)) or bool(bcc_list)
    if is_daily_run and not has_recipients:
        logger.info("Daily run job %s has no recipients configured; skipping email", job_id_str)
        refresh_live_analytics_snapshots(db)
        return False

    report_service = ReportService(db)
    csv_bytes, filename, alerts_count = report_service.generate_csv_for_job(
        job_id,
        job_name,
        map_vendor_type=vendor,
        off_price_scope=off_price_scope,
    )
    total_upcs = report_service.get_total_upcs_for_job(job_id)

    sent = EmailService().send_csv_report(
        csv_bytes=csv_bytes,
        filename=filename,
        job_name=job_name,
        total_upcs=total_upcs,
        alerts_count=alerts_count,
        recipient_email=recipient_csv,
        vendor=vendor,
        bcc_emails=bcc_list,
        use_default_recipients=not is_daily_run,
        email_subject_template=email_subject_template,
        email_body_template=email_body_template,
    )
    if sent:
        logger.info("Completion email sent for job %s", job_id_str)
    else:
        logger.error("Failed to send completion email for job %s", job_id_str)

    if is_daily_run:
        refresh_live_analytics_snapshots(db)

    return sent


def refresh_live_analytics_snapshots(db: Client) -> None:
    """Recompute and persist daily/week/month/year archives after a Daily Run."""
    try:
        from app.services.off_price_analytics_service import OffPriceAnalyticsService

        svc = OffPriceAnalyticsService(db)
        for period in ("daily", "weekly", "monthly", "yearly"):
            svc.get_off_price_summary(
                period,  # type: ignore[arg-type]
                offset=0,
                persist=True,
                force_persist=True,
                user_id=None,
            )
        logger.info("Live analytics snapshots refreshed after Daily Run")
    except Exception as exc:
        logger.warning("Live analytics snapshot refresh failed: %s", exc)


def _vendor_from_daily_job_name(job_name: str) -> Optional[str]:
    # "Daily CLK Uploaded Report - 2026-07-02" / "Daily BOR Off Price Report - ..."
    parts = (job_name or "").split()
    if len(parts) >= 2 and parts[0].lower() == "daily":
        return parts[1].strip().lower() or None
    return None
