"""Email recipient directory (registered profiles), per-user pool, and saved lists."""
import logging
import re
from datetime import datetime, timezone
from typing import List, Set
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from supabase import Client

from app.config import settings
from app.database import get_supabase
from app.dependencies import get_job_runner_user
from app.models.email_recipients import (
    EmailListCreate,
    EmailListResponse,
    EmailListUpdate,
    EmailPoolEntryCreate,
    EmailPoolEntryResponse,
    EmailPoolEntryUpdate,
    RegisteredEmailsResponse,
)
from app.repositories.job_repository import JobRepository
from app.repositories.supabase_read_all import read_all_paginated
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_BULK_PAGE_SIZE = 500


def _normalize_email(raw: str) -> str:
    return raw.strip().lower()


def _validate_email(email: str) -> str:
    n = _normalize_email(email)
    if not n or not _EMAIL_RE.match(n):
        raise HTTPException(status_code=400, detail="Invalid email address")
    return n


def _parse_recipient_string(raw: str) -> List[str]:
    """Comma-separated addresses (same idea as EmailService._parse_recipients), normalized and validated."""
    if not raw or not str(raw).strip():
        return []
    out: List[str] = []
    for part in str(raw).split(","):
        n = _normalize_email(part)
        if n and _EMAIL_RE.match(n):
            out.append(n)
    return out


def _chunk_list(items: List[str], size: int) -> List[List[str]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def _insert_pool_emails_for_user(db: Client, user_id: str, emails: Set[str]) -> int:
    """Insert validated emails into pool with batched lookups/inserts."""
    if not emails:
        return 0

    ordered_emails = sorted(emails)
    existing_emails: Set[str] = set()

    # Fetch existing rows in chunks to avoid per-email query overhead.
    for chunk in _chunk_list(ordered_emails, _BULK_PAGE_SIZE):
        existing = (
            db.table("email_recipient_pool")
            .select("email")
            .eq("user_id", user_id)
            .in_("email", chunk)
            .execute()
        )
        for row in existing.data or []:
            email = row.get("email")
            if isinstance(email, str):
                n = _normalize_email(email)
                if n:
                    existing_emails.add(n)

    missing_rows = [{"user_id": user_id, "email": email} for email in ordered_emails if email not in existing_emails]
    if not missing_rows:
        return 0

    inserted = 0
    for start in range(0, len(missing_rows), _BULK_PAGE_SIZE):
        batch = missing_rows[start:start + _BULK_PAGE_SIZE]
        res = db.table("email_recipient_pool").insert(batch).execute()
        inserted += len(res.data or [])
    return inserted


def _get_excluded_emails_for_user(db: Client, user_id: str) -> Set[str]:
    try:
        response = (
            db.table("email_recipient_pool_exclusions")
            .select("email")
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as exc:
        logger.warning("Could not load email pool exclusions: %s", exc)
        return set()
    excluded: Set[str] = set()
    for row in response.data or []:
        email = row.get("email")
        if isinstance(email, str):
            n = _normalize_email(email)
            if n:
                excluded.add(n)
    return excluded


@router.get("/email-recipients/registered", response_model=RegisteredEmailsResponse)
@handle_api_errors("list registered emails")
def list_registered_emails(
    _current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    """Distinct emails for recipient pickers: profiles, default CSV recipients (EMAIL_TO), and daily-run job overrides."""
    seen: set[str] = set()

    response = db.table("profiles").select("email").eq("is_active", True).execute()
    if response.data:
        for row in response.data:
            e = row.get("email")
            if not e or not isinstance(e, str):
                continue
            n = _normalize_email(e)
            if n and _EMAIL_RE.match(n):
                seen.add(n)

    for e in _parse_recipient_string(settings.email_to):
        seen.add(e)

    try:

        def fetch_jobs_with_recipients(start: int, end: int):
            return (
                db.table("batch_jobs")
                .select("job_name, email_recipients")
                .not_.is_("email_recipients", "null")
                .range(start, end)
                .execute()
            )

        job_rows = read_all_paginated(fetch_jobs_with_recipients)
        for row in job_rows:
            job_name = row.get("job_name")
            if not JobRepository._is_daily_run_job(job_name):
                continue
            raw = row.get("email_recipients")
            if not raw or not isinstance(raw, str) or not raw.strip():
                continue
            for e in _parse_recipient_string(raw):
                seen.add(e)
    except Exception as exc:
        logger.warning("Could not merge daily-run job recipients into registered list: %s", exc)

    emails = sorted(seen)
    return RegisteredEmailsResponse(emails=emails)


@router.post("/email-recipients/pool/sync-used")
@handle_api_errors("sync used recipients into email pool")
def sync_used_recipients_to_pool(
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    """
    Populate the user's pool from recipients used in:
    - Express Jobs (batch_jobs.email_recipients for current user)
    - Daily Run settings (scheduler_settings.email_recipients)
    """
    uid = str(current_user["id"])
    discovered: Set[str] = set()

    def fetch_user_jobs_with_recipients(start: int, end: int):
        return (
            db.table("batch_jobs")
            .select("email_recipients")
            .eq("created_by", uid)
            .not_.is_("email_recipients", "null")
            .range(start, end)
            .execute()
        )

    for row in read_all_paginated(fetch_user_jobs_with_recipients):
        raw = row.get("email_recipients")
        for email in _parse_recipient_string(raw):
            discovered.add(email)

    try:
        settings_rows = (
            db.table("scheduler_settings")
            .select("email_recipients")
            .not_.is_("email_recipients", "null")
            .execute()
        )
        for row in settings_rows.data or []:
            raw = row.get("email_recipients")
            for email in _parse_recipient_string(raw):
                discovered.add(email)
    except Exception as exc:
        logger.warning("Could not merge scheduler settings recipients into pool sync: %s", exc)

    excluded = _get_excluded_emails_for_user(db, uid)
    eligible = {email for email in discovered if email not in excluded}
    inserted = _insert_pool_emails_for_user(db, uid, eligible)
    return {"ok": True, "discovered": len(discovered), "eligible": len(eligible), "inserted": inserted}


@router.get("/email-recipients/pool", response_model=List[EmailPoolEntryResponse])
@handle_api_errors("list email pool")
def list_email_pool(
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    uid = str(current_user["id"])
    response = db.table("email_recipient_pool").select("id, email, display_name, is_bcc").eq("user_id", uid).order("email").execute()
    out: List[EmailPoolEntryResponse] = []
    for row in response.data or []:
        out.append(
            EmailPoolEntryResponse(
                id=str(row["id"]),
                email=row["email"],
                display_name=row.get("display_name"),
                is_bcc=bool(row.get("is_bcc")),
            )
        )
    return out


@router.post("/email-recipients/pool", response_model=EmailPoolEntryResponse, status_code=201)
@handle_api_errors("add email to pool")
def add_email_to_pool(
    body: EmailPoolEntryCreate,
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    email = _validate_email(body.email)
    uid = str(current_user["id"])
    display_name = (body.display_name or "").strip() or None
    is_bcc = bool(body.is_bcc)

    # Manual add re-enables previously deleted addresses for sync/list usage.
    db.table("email_recipient_pool_exclusions").delete().eq("user_id", uid).eq("email", email).execute()

    existing = (
        db.table("email_recipient_pool")
        .select("id, email, display_name, is_bcc")
        .eq("user_id", uid)
        .eq("email", email)
        .execute()
    )
    if existing.data:
        row = existing.data[0]
        update_payload = {}
        if display_name and row.get("display_name") != display_name:
            update_payload["display_name"] = display_name
        if bool(row.get("is_bcc")) != is_bcc:
            update_payload["is_bcc"] = is_bcc
        if update_payload:
            updated = (
                db.table("email_recipient_pool")
                .update(update_payload)
                .eq("user_id", uid)
                .eq("id", str(row["id"]))
                .execute()
            )
            if updated.data:
                row = updated.data[0]
        return EmailPoolEntryResponse(
            id=str(row["id"]),
            email=row["email"],
            display_name=row.get("display_name"),
            is_bcc=bool(row.get("is_bcc")),
        )

    ins = (
        db.table("email_recipient_pool")
        .insert({"user_id": uid, "email": email, "display_name": display_name, "is_bcc": is_bcc})
        .execute()
    )
    if not ins.data:
        raise HTTPException(status_code=500, detail="Failed to save email")
    row = ins.data[0]
    return EmailPoolEntryResponse(
        id=str(row["id"]),
        email=row["email"],
        display_name=row.get("display_name"),
        is_bcc=bool(row.get("is_bcc")),
    )


@router.patch("/email-recipients/pool/{entry_id}", response_model=EmailPoolEntryResponse)
@handle_api_errors("update email pool entry")
def update_email_pool_entry(
    entry_id: UUID,
    body: EmailPoolEntryUpdate,
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    uid = str(current_user["id"])
    if body.display_name is None and body.is_bcc is None:
        raise HTTPException(status_code=400, detail="No fields to update")
    display_name = (body.display_name or "").strip() or None if body.display_name is not None else None
    update_payload = {}
    if body.display_name is not None:
        update_payload["display_name"] = display_name
    if body.is_bcc is not None:
        update_payload["is_bcc"] = bool(body.is_bcc)
    res = (
        db.table("email_recipient_pool")
        .update(update_payload)
        .eq("user_id", uid)
        .eq("id", str(entry_id))
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Email entry not found")
    row = res.data[0]
    return EmailPoolEntryResponse(
        id=str(row["id"]),
        email=row["email"],
        display_name=row.get("display_name"),
        is_bcc=bool(row.get("is_bcc")),
    )


@router.delete("/email-recipients/pool/{entry_id}")
@handle_api_errors("remove email from pool")
def delete_email_from_pool(
    entry_id: UUID,
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    uid = str(current_user["id"])
    row = (
        db.table("email_recipient_pool")
        .select("email")
        .eq("user_id", uid)
        .eq("id", str(entry_id))
        .limit(1)
        .execute()
    )
    deleted_email = None
    if row.data:
        deleted_email = _normalize_email(str(row.data[0].get("email", "")))

    db.table("email_recipient_pool").delete().eq("user_id", uid).eq("id", str(entry_id)).execute()

    if deleted_email:
        existing_exclusion = (
            db.table("email_recipient_pool_exclusions")
            .select("id")
            .eq("user_id", uid)
            .eq("email", deleted_email)
            .limit(1)
            .execute()
        )
        if not existing_exclusion.data:
            db.table("email_recipient_pool_exclusions").insert({"user_id": uid, "email": deleted_email}).execute()

    return {"ok": True}


@router.get("/email-recipients/lists", response_model=List[EmailListResponse])
@handle_api_errors("list saved email lists")
def list_email_lists(
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    uid = str(current_user["id"])
    response = db.table("email_recipient_lists").select("*").eq("user_id", uid).order("name").execute()
    out: List[EmailListResponse] = []
    for row in response.data or []:
        raw = row.get("emails") or []
        if isinstance(raw, str):
            emails = []
        else:
            emails = [str(x).strip().lower() for x in raw if str(x).strip()]
        out.append(
            EmailListResponse(
                id=str(row["id"]),
                name=row["name"],
                emails=emails,
            )
        )
    return out


@router.post("/email-recipients/lists", response_model=EmailListResponse, status_code=201)
@handle_api_errors("create saved email list")
def create_email_list(
    body: EmailListCreate,
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    uid = str(current_user["id"])
    cleaned: List[str] = []
    seen = set()
    for e in body.emails:
        try:
            n = _validate_email(e)
        except HTTPException:
            continue
        if n not in seen:
            seen.add(n)
            cleaned.append(n)
    ins = (
        db.table("email_recipient_lists")
        .insert(
            {
                "user_id": uid,
                "name": body.name.strip(),
                "emails": cleaned,
            }
        )
        .execute()
    )
    if not ins.data:
        raise HTTPException(status_code=500, detail="Failed to save list")
    row = ins.data[0]
    return EmailListResponse(id=str(row["id"]), name=row["name"], emails=cleaned)


@router.patch("/email-recipients/lists/{list_id}", response_model=EmailListResponse)
@handle_api_errors("update saved email list")
def update_email_list(
    list_id: UUID,
    body: EmailListUpdate,
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    if body.name is None and body.emails is None:
        raise HTTPException(status_code=400, detail="No fields to update")
    uid = str(current_user["id"])
    check = (
        db.table("email_recipient_lists")
        .select("id")
        .eq("user_id", uid)
        .eq("id", str(list_id))
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=404, detail="List not found")

    update_payload = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.name is not None:
        update_payload["name"] = body.name.strip()
    if body.emails is not None:
        cleaned: List[str] = []
        seen = set()
        for e in body.emails:
            try:
                n = _validate_email(e)
            except HTTPException:
                continue
            if n not in seen:
                seen.add(n)
                cleaned.append(n)
        update_payload["emails"] = cleaned

    res = db.table("email_recipient_lists").update(update_payload).eq("user_id", uid).eq("id", str(list_id)).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to update list")
    row = res.data[0]
    raw = row.get("emails") or []
    emails = [str(x).strip().lower() for x in raw if str(x).strip()] if not isinstance(raw, str) else []
    return EmailListResponse(id=str(row["id"]), name=row["name"], emails=emails)


@router.delete("/email-recipients/lists/{list_id}")
@handle_api_errors("delete saved email list")
def delete_email_list(
    list_id: UUID,
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    uid = str(current_user["id"])
    db.table("email_recipient_lists").delete().eq("user_id", uid).eq("id", str(list_id)).execute()
    return {"ok": True}
