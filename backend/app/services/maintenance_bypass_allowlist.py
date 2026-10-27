"""Emails allowed to use Overwatch while maintenance mode is on (DB-backed)."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Iterable, List

from supabase import Client

from app.config import settings

logger = logging.getLogger(__name__)

TABLE = "maintenance_bypass_allowlist"

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(email: str | None) -> str:
    return (email or "").strip().lower()


def is_valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(email))


def normalize_email_list(emails: Iterable[str]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for raw in emails:
        email = normalize_email(raw)
        if not email or email in seen:
            continue
        if not is_valid_email(email):
            continue
        seen.add(email)
        out.append(email)
    out.sort()
    return out


def list_maintenance_bypass_emails(db: Client) -> List[str]:
    """Return sorted allowlisted emails from the database."""
    result = db.table(TABLE).select("email").execute()
    rows = result.data or []
    return normalize_email_list(row.get("email") or "" for row in rows)


def is_maintenance_bypass_allowed(db: Client, email: str | None) -> bool:
    """True for env-allowlisted or DB-allowlisted emails. Fail closed if the table is missing."""
    normalized = normalize_email(email)
    if not normalized:
        return False
    if normalized in set(settings.maintenance_allowlist_emails_list):
        return True
    try:
        return normalized in set(list_maintenance_bypass_emails(db))
    except Exception as exc:
        logger.warning("Maintenance bypass allowlist check failed; denying: %s", exc)
        return False


def replace_maintenance_bypass_emails(db: Client, emails: Iterable[str]) -> List[str]:
    """Replace the entire allowlist. Returns the saved sorted list."""
    from fastapi import HTTPException, status

    raw_list = [(e or "").strip() for e in emails if (e or "").strip()]
    invalid = [e for e in raw_list if not is_valid_email(normalize_email(e))]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid email address(es): {', '.join(invalid[:5])}",
        )

    normalized = normalize_email_list(raw_list)
    try:
        existing_rows = db.table(TABLE).select("email").execute().data or []
        existing = normalize_email_list(row.get("email") or "" for row in existing_rows)
    except Exception as exc:
        logger.error("Maintenance bypass allowlist update failed (table missing?): %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Maintenance access list is not available. "
                "Run the create_maintenance_bypass_allowlist migration."
            ),
        ) from exc

    to_delete = [email for email in existing if email not in set(normalized)]
    now = datetime.now(timezone.utc).isoformat()

    for email in to_delete:
        db.table(TABLE).delete().eq("email", email).execute()

    for email in normalized:
        db.table(TABLE).upsert(
            {"email": email, "updated_at": now},
            on_conflict="email",
        ).execute()

    return list_maintenance_bypass_emails(db)
