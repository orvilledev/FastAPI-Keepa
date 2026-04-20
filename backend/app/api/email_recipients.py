"""Email recipient directory (registered profiles), per-user pool, and saved lists."""
import re
from datetime import datetime, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_job_runner_user
from app.models.email_recipients import (
    EmailListCreate,
    EmailListResponse,
    EmailListUpdate,
    EmailPoolEntryCreate,
    EmailPoolEntryResponse,
    RegisteredEmailsResponse,
)
from app.utils.error_handler import handle_api_errors

router = APIRouter()

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_email(raw: str) -> str:
    return raw.strip().lower()


def _validate_email(email: str) -> str:
    n = _normalize_email(email)
    if not n or not _EMAIL_RE.match(n):
        raise HTTPException(status_code=400, detail="Invalid email address")
    return n


@router.get("/email-recipients/registered", response_model=RegisteredEmailsResponse)
@handle_api_errors("list registered emails")
async def list_registered_emails(
    _current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    """Distinct profile emails (MSW Overwatch accounts) for recipient pickers."""
    response = db.table("profiles").select("email").execute()
    emails: List[str] = []
    if response.data:
        seen = set()
        for row in response.data:
            e = row.get("email")
            if not e or not isinstance(e, str):
                continue
            n = _normalize_email(e)
            if n and n not in seen:
                seen.add(n)
                emails.append(n)
    emails.sort()
    return RegisteredEmailsResponse(emails=emails)


@router.get("/email-recipients/pool", response_model=List[EmailPoolEntryResponse])
@handle_api_errors("list email pool")
async def list_email_pool(
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    uid = str(current_user["id"])
    response = db.table("email_recipient_pool").select("id, email").eq("user_id", uid).order("email").execute()
    out: List[EmailPoolEntryResponse] = []
    for row in response.data or []:
        out.append(
            EmailPoolEntryResponse(
                id=str(row["id"]),
                email=row["email"],
            )
        )
    return out


@router.post("/email-recipients/pool", response_model=EmailPoolEntryResponse, status_code=201)
@handle_api_errors("add email to pool")
async def add_email_to_pool(
    body: EmailPoolEntryCreate,
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    email = _validate_email(body.email)
    uid = str(current_user["id"])
    existing = (
        db.table("email_recipient_pool")
        .select("id, email")
        .eq("user_id", uid)
        .eq("email", email)
        .execute()
    )
    if existing.data:
        row = existing.data[0]
        return EmailPoolEntryResponse(id=str(row["id"]), email=row["email"])

    ins = db.table("email_recipient_pool").insert({"user_id": uid, "email": email}).execute()
    if not ins.data:
        raise HTTPException(status_code=500, detail="Failed to save email")
    row = ins.data[0]
    return EmailPoolEntryResponse(id=str(row["id"]), email=row["email"])


@router.delete("/email-recipients/pool/{entry_id}")
@handle_api_errors("remove email from pool")
async def delete_email_from_pool(
    entry_id: UUID,
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    uid = str(current_user["id"])
    db.table("email_recipient_pool").delete().eq("user_id", uid).eq("id", str(entry_id)).execute()
    return {"ok": True}


@router.get("/email-recipients/lists", response_model=List[EmailListResponse])
@handle_api_errors("list saved email lists")
async def list_email_lists(
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
async def create_email_list(
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
async def update_email_list(
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
async def delete_email_list(
    list_id: UUID,
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    uid = str(current_user["id"])
    db.table("email_recipient_lists").delete().eq("user_id", uid).eq("id", str(list_id)).execute()
    return {"ok": True}
