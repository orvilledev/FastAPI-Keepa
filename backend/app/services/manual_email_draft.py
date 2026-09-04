"""Build a ready-to-send email draft for a report so an admin can send it by hand.

The subject and body come from :func:`build_report_email_content`, the same
builder the automatic daily-run send uses, so a manually sent email is worded
identically to the scheduled one. Recipients and per-vendor templates are read
from the job row first (what the run was created with) and fall back to the
vendor's current ``scheduler_settings``.
"""
import logging
import re
from typing import Optional
from urllib.parse import quote, urlencode
from uuid import UUID

from supabase import Client

from app.services.email_service import (
    DEFAULT_FROM_DISPLAY_NAME,
    EmailService,
    build_report_email_content,
)
from app.services.report_service import ReportService
from app.utils.email_recipient_utils import parse_recipient_csv

logger = logging.getLogger(__name__)

# Outlook on the web compose deep link. `/mail/<mailbox>/deeplink/compose`
# targets a specific (shared) mailbox so the draft opens with the Overwatch
# mailbox as the sender; `/mail/deeplink/compose` uses whichever mailbox the
# browser session is signed into.
OUTLOOK_WEB_BASE = "https://outlook.office.com/mail"

_DAILY_CATEGORY_RE = re.compile(r"^\s*daily\s+([a-z0-9_-]+)", re.IGNORECASE)


def _extract_daily_category(job_name: str) -> Optional[str]:
    match = _DAILY_CATEGORY_RE.match(str(job_name or ""))
    return match.group(1).lower() if match else None


def _encode_params(params: dict) -> str:
    """Percent-encode query params, keeping spaces as %20 (not '+').

    Outlook's compose deep link renders a literal '+' for plus-encoded spaces,
    so `quote` is used instead of the default `quote_plus`.
    """
    return urlencode(
        {key: value for key, value in params.items() if value},
        quote_via=quote,
        safe="@,",
    )


def _url_body(body: str) -> str:
    """Normalize newlines to CRLF, which both Outlook web and mailto: honor."""
    return str(body or "").replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")


def _load_scheduler_settings(db: Client, categories: list) -> dict:
    """First matching scheduler_settings row for the given category candidates."""
    for category in dict.fromkeys(candidate for candidate in categories if candidate):
        try:
            response = (
                db.table("scheduler_settings")
                .select(
                    "category, email_recipients, email_bcc_recipients, "
                    "email_subject_template, email_body_template"
                )
                .eq("category", category)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            logger.warning("Could not load scheduler_settings for %s: %s", category, exc)
            continue
        if response.data:
            return response.data[0]
    return {}


def build_manual_email_draft(db: Client, job: dict) -> dict:
    """Assemble the subject, body, recipients and compose links for a job's report."""
    job_id = UUID(str(job["id"]))
    job_name = job.get("job_name") or "Express Job"
    vendor = (job.get("map_vendor_type") or "").strip().lower() or None
    off_price_scope = job.get("off_price_scope") or "buybox_only"

    settings_row = _load_scheduler_settings(
        db, [_extract_daily_category(job_name), vendor]
    )

    # The job row holds the recipients the run was created with; a run created
    # before recipients were configured falls back to the vendor's current list.
    to_recipients = parse_recipient_csv(job.get("email_recipients"))
    bcc_recipients = parse_recipient_csv(job.get("email_bcc_recipients"))
    recipients_source = "job"
    if not to_recipients and not bcc_recipients:
        to_recipients = parse_recipient_csv(settings_row.get("email_recipients"))
        bcc_recipients = parse_recipient_csv(settings_row.get("email_bcc_recipients"))
        recipients_source = "scheduler_settings" if (to_recipients or bcc_recipients) else "none"

    # BCC addresses are never also in To, matching EmailService routing.
    bcc_lookup = {email.lower() for email in bcc_recipients}
    to_recipients = [email for email in to_recipients if email.lower() not in bcc_lookup]

    report_service = ReportService(db)
    _csv_bytes, attachment_filename, off_price_count = report_service.generate_csv_for_job(
        job_id,
        job_name,
        map_vendor_type=vendor,
        off_price_scope=off_price_scope,
    )
    total_upcs = report_service.get_total_upcs_for_job(job_id)

    content = build_report_email_content(
        job_name=job_name,
        total_upcs=total_upcs,
        alerts_count=off_price_count,
        vendor=vendor,
        email_subject_template=settings_row.get("email_subject_template"),
        email_body_template=settings_row.get("email_body_template"),
    )

    mailer = EmailService()
    from_address = mailer._bare_from_address()
    from_name = (mailer.email_from_name or DEFAULT_FROM_DISPLAY_NAME).strip()

    compose_params = {
        "to": ",".join(to_recipients),
        "bcc": ",".join(bcc_recipients),
        "subject": content.subject,
        "body": _url_body(content.body),
    }
    query = _encode_params(compose_params)
    mailbox_path = quote(from_address, safe="@.")

    compose_url = (
        f"{OUTLOOK_WEB_BASE}/{mailbox_path}/deeplink/compose?{query}"
        if from_address
        else f"{OUTLOOK_WEB_BASE}/deeplink/compose?{query}"
    )
    compose_url_signed_in_mailbox = f"{OUTLOOK_WEB_BASE}/deeplink/compose?{query}"
    mailto_url = "mailto:{to}?{query}".format(
        to=quote(",".join(to_recipients), safe="@,"),
        query=_encode_params(
            {
                "bcc": ",".join(bcc_recipients),
                "subject": content.subject,
                "body": _url_body(content.body),
            }
        ),
    )

    return {
        "job_id": str(job_id),
        "job_name": job_name,
        "from_address": from_address,
        "from_name": from_name,
        "to": to_recipients,
        "bcc": bcc_recipients,
        "recipients_source": recipients_source,
        "subject": content.subject,
        "body": content.body,
        "vendor": content.vendor,
        "brand": content.brand,
        "report_date": content.run_date_iso,
        "report_date_long": content.run_date_long,
        "off_price_count": off_price_count,
        "total_upcs": total_upcs,
        "attachment_filename": attachment_filename,
        "compose_url": compose_url,
        "compose_url_signed_in_mailbox": compose_url_signed_in_mailbox,
        "mailto_url": mailto_url,
        "used_custom_subject": content.used_custom_subject,
        "used_custom_body": content.used_custom_body,
    }
