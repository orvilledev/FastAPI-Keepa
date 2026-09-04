"""Build a ready-to-send email draft for a report so an admin can send it by hand.

The subject and body come from :func:`build_report_email_content`, the same
builder the automatic daily-run send uses, so a manually sent email is worded
identically to the scheduled one. Recipients and per-vendor templates are read
from the job row first (what the run was created with) and fall back to the
vendor's current ``scheduler_settings``.

Outlook Web compose deeplinks do **not** honor ``cc`` / ``bcc`` query params.
The reliable path is :func:`open_manual_email_draft`, which creates a real draft
in the Overwatch mailbox via Microsoft Graph (To/Cc/Bcc + attachment) and
returns that draft's ``webLink``.
"""
import logging
import re
from typing import Optional
from urllib.parse import quote, urlencode
from uuid import UUID

from fastapi import HTTPException
from supabase import Client

from app.config import settings
from app.services.email_service import (
    DEFAULT_FROM_DISPLAY_NAME,
    EmailService,
    build_report_email_content,
)
from app.services.graph_mail_service import GraphMailError
from app.services.report_service import ReportService
from app.utils.email_recipient_utils import parse_recipient_csv

logger = logging.getLogger(__name__)

# Outlook on the web compose deep link. `/mail/deeplink/compose` uses whichever
# mailbox the browser session is signed into. Prefer Graph drafts for BCC/CC.
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
                    "category, email_recipients, email_cc_recipients, email_bcc_recipients, "
                    "email_subject_template, email_body_template"
                )
                .eq("category", category)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            # Older DBs may not have email_cc_recipients yet — retry without it.
            msg = str(exc).lower()
            if "email_cc_recipients" in msg or "column" in msg:
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
                except Exception as retry_exc:
                    logger.warning(
                        "Could not load scheduler_settings for %s: %s", category, retry_exc
                    )
                    continue
            else:
                logger.warning("Could not load scheduler_settings for %s: %s", category, exc)
                continue
        if response.data:
            return response.data[0]
    return {}


def _dedupe_recipient_buckets(
    to_recipients: list[str],
    cc_recipients: list[str],
    bcc_recipients: list[str],
) -> tuple[list[str], list[str], list[str]]:
    """BCC wins over CC wins over To when the same address appears in multiple lists."""
    bcc_lookup = {email.lower() for email in bcc_recipients}
    cc_lookup = {email.lower() for email in cc_recipients}

    cc_clean = [email for email in cc_recipients if email.lower() not in bcc_lookup]
    to_clean = [
        email
        for email in to_recipients
        if email.lower() not in bcc_lookup and email.lower() not in cc_lookup
    ]
    return to_clean, cc_clean, bcc_recipients


def _resolve_draft_parts(db: Client, job: dict) -> dict:
    """Shared recipient/content/attachment resolution for preview and Graph open."""
    job_id = UUID(str(job["id"]))
    job_name = job.get("job_name") or "Express Job"
    vendor = (job.get("map_vendor_type") or "").strip().lower() or None
    off_price_scope = job.get("off_price_scope") or "buybox_only"

    settings_row = _load_scheduler_settings(
        db, [_extract_daily_category(job_name), vendor]
    )

    # Job row first (what the run was created with); fall back to vendor settings.
    to_recipients = parse_recipient_csv(job.get("email_recipients"))
    cc_recipients = parse_recipient_csv(job.get("email_cc_recipients"))
    bcc_recipients = parse_recipient_csv(job.get("email_bcc_recipients"))
    recipients_source = "job"
    if not to_recipients and not cc_recipients and not bcc_recipients:
        to_recipients = parse_recipient_csv(settings_row.get("email_recipients"))
        cc_recipients = parse_recipient_csv(settings_row.get("email_cc_recipients"))
        bcc_recipients = parse_recipient_csv(settings_row.get("email_bcc_recipients"))
        recipients_source = (
            "scheduler_settings"
            if (to_recipients or cc_recipients or bcc_recipients)
            else "none"
        )

    to_recipients, cc_recipients, bcc_recipients = _dedupe_recipient_buckets(
        to_recipients, cc_recipients, bcc_recipients
    )

    report_service = ReportService(db)
    csv_bytes, attachment_filename, off_price_count = report_service.generate_csv_for_job(
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

    return {
        "job_id": str(job_id),
        "job_name": job_name,
        "from_address": from_address,
        "from_name": from_name,
        "to": to_recipients,
        "cc": cc_recipients,
        "bcc": bcc_recipients,
        "recipients_source": recipients_source,
        "subject": content.subject,
        "body": content.body,
        "html_body": content.html_body,
        "vendor": content.vendor,
        "brand": content.brand,
        "report_date": content.run_date_iso,
        "report_date_long": content.run_date_long,
        "off_price_count": off_price_count,
        "total_upcs": total_upcs,
        "attachment_filename": attachment_filename,
        "attachment_bytes": csv_bytes,
        "used_custom_subject": content.used_custom_subject,
        "used_custom_body": content.used_custom_body,
        "mailer": mailer,
    }


def build_manual_email_draft(db: Client, job: dict) -> dict:
    """Assemble the subject, body, recipients and compose links for a job's report."""
    parts = _resolve_draft_parts(db, job)

    to_recipients = parts["to"]
    cc_recipients = parts["cc"]
    bcc_recipients = parts["bcc"]
    from_address = parts["from_address"]

    # OWA compose deeplinks only reliably honor to/subject/body — cc/bcc are
    # included for clients that support them (mailto / future OWA) and for
    # transparency; Graph drafts are the path that actually populates them.
    compose_params = {
        "to": ",".join(to_recipients),
        "cc": ",".join(cc_recipients),
        "bcc": ",".join(bcc_recipients),
        "subject": parts["subject"],
        "body": _url_body(parts["body"]),
    }
    query = _encode_params(compose_params)
    mailbox_path = quote(from_address, safe="@.")

    compose_url_overwatch = (
        f"{OUTLOOK_WEB_BASE}/{mailbox_path}/deeplink/compose?{query}"
        if from_address
        else f"{OUTLOOK_WEB_BASE}/deeplink/compose?{query}"
    )
    # Primary deeplink fallback: signed-in session (Send As overwatch when permitted).
    compose_url = f"{OUTLOOK_WEB_BASE}/deeplink/compose?{query}"
    mailto_url = "mailto:{to}?{query}".format(
        to=quote(",".join(to_recipients), safe="@,"),
        query=_encode_params(
            {
                "cc": ",".join(cc_recipients),
                "bcc": ",".join(bcc_recipients),
                "subject": parts["subject"],
                "body": _url_body(parts["body"]),
            }
        ),
    )

    return {
        "job_id": parts["job_id"],
        "job_name": parts["job_name"],
        "from_address": from_address,
        "from_name": parts["from_name"],
        "to": to_recipients,
        "cc": cc_recipients,
        "bcc": bcc_recipients,
        "recipients_source": parts["recipients_source"],
        "subject": parts["subject"],
        "body": parts["body"],
        "vendor": parts["vendor"],
        "brand": parts["brand"],
        "report_date": parts["report_date"],
        "report_date_long": parts["report_date_long"],
        "off_price_count": parts["off_price_count"],
        "total_upcs": parts["total_upcs"],
        "attachment_filename": parts["attachment_filename"],
        # Signed-in mailbox first — what works when the user has Send As on Overwatch.
        "compose_url": compose_url,
        "compose_url_signed_in_mailbox": compose_url,
        "compose_url_overwatch_mailbox": compose_url_overwatch,
        "mailto_url": mailto_url,
        "graph_draft_available": bool(settings.graph_email_configured),
        "used_custom_subject": parts["used_custom_subject"],
        "used_custom_body": parts["used_custom_body"],
    }


def open_manual_email_draft(db: Client, job: dict) -> dict:
    """Create a real Overwatch draft via Graph and return its Outlook webLink.

    This is the only path that reliably prefills Cc / Bcc (and the XLSX
    attachment). Requires application ``Mail.ReadWrite`` on the Entra app.
    """
    parts = _resolve_draft_parts(db, job)
    mailer: EmailService = parts["mailer"]

    if not settings.graph_email_configured:
        raise HTTPException(
            status_code=503,
            detail=(
                "Microsoft Graph is not configured. Set AZURE_TENANT_ID, "
                "AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and EMAIL_TRANSPORT=graph, "
                "and grant Mail.ReadWrite (application) on the Entra app."
            ),
        )

    client = mailer._graph_client_or_none()
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Microsoft Graph email client is not configured",
        )

    try:
        created = client.create_draft(
            subject=parts["subject"],
            plain_body=parts["body"],
            html_body=parts["html_body"],
            to_recipients=parts["to"],
            cc_recipients=parts["cc"],
            bcc_recipients=parts["bcc"],
            attachments=[
                (
                    parts["attachment_filename"],
                    parts["attachment_bytes"],
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            ],
        )
    except GraphMailError as exc:
        logger.error("Failed to create Overwatch draft: %s", exc)
        detail = str(exc)
        if "403" in detail or "401" in detail or "Access" in detail:
            detail = (
                f"{exc}. Creating drafts requires application permission "
                "Mail.ReadWrite (with admin consent) on the Overwatch Graph app, "
                "in addition to Mail.Send."
            )
        raise HTTPException(status_code=502, detail=detail) from exc

    open_url = (created.get("webLink") or "").strip()
    if not open_url:
        raise HTTPException(
            status_code=502,
            detail="Graph created a draft but did not return a webLink to open",
        )

    return {
        "job_id": parts["job_id"],
        "draft_id": created.get("id"),
        "open_url": open_url,
        "from_address": parts["from_address"],
        "to": parts["to"],
        "cc": parts["cc"],
        "bcc": parts["bcc"],
        "subject": parts["subject"],
        "attachment_filename": parts["attachment_filename"],
    }
