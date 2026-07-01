"""Helpers to finalize daily/import runs without duplicate completion emails."""
from __future__ import annotations

import asyncio
import logging
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


def _uploaded_daily_job_name_prefix(category: str) -> str:
    return f"Daily {category.strip().upper()} Uploaded Report"


async def try_acquire_category_daily_run_lock(category: str) -> bool:
    """Return False when another daily run for this vendor is already executing."""
    normalized = (category or "").strip().lower()
    lock = _category_daily_run_locks.setdefault(normalized, asyncio.Lock())
    if lock.locked():
        return False
    await lock.acquire()
    return True


def release_category_daily_run_lock(category: str) -> None:
    normalized = (category or "").strip().lower()
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


def claim_completion_email_send(db: Client, job_id: str) -> bool:
    """Atomically mark a job so only one completion email is ever sent."""
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


def send_daily_run_completion_email_for_job(
    db: Client,
    job_id: UUID,
    *,
    email_subject_template: Optional[str] = None,
    email_body_template: Optional[str] = None,
) -> bool:
    """
    Generate the off-price CSV and email it once per job.

    Returns True when an email was sent, False when skipped or already sent.
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
    return sent
