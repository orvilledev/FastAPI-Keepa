"""Label Station Print ID — UPC (DNK) email allowlist (DB-backed)."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Iterable, List

from supabase import Client

logger = logging.getLogger(__name__)

TABLE = "upc_dnk_print_id_allowlist"

# Used when the table is missing / unreachable so Label Station keeps working pre-migration.
DEFAULT_UPC_DNK_PRINT_ID_EMAILS = [
    "marquez@metroshoewarehouse.com",
    "orvillebarba@gmail.com",
    "sunshine@metroshoewarehouse.com",
    "stephanie@metroshoewarehouse.com",
]

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


def list_upc_dnk_print_id_emails(db: Client) -> List[str]:
    """Return sorted allowlisted emails. Falls back to defaults if the table is unavailable."""
    try:
        result = db.table(TABLE).select("email").execute()
        rows = result.data or []
        emails = normalize_email_list(row.get("email") or "" for row in rows)
        return emails
    except Exception as exc:
        logger.warning("UPC DNK allowlist read failed; using defaults: %s", exc)
        return list(DEFAULT_UPC_DNK_PRINT_ID_EMAILS)


def is_upc_dnk_print_id_allowed(db: Client, email: str | None) -> bool:
    normalized = normalize_email(email)
    if not normalized:
        return False
    return normalized in set(list_upc_dnk_print_id_emails(db))


def replace_upc_dnk_print_id_emails(db: Client, emails: Iterable[str]) -> List[str]:
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
    existing = list_upc_dnk_print_id_emails(db)
    # Only delete rows that actually exist in DB (avoid treating fallback defaults as rows).
    try:
        existing_rows = db.table(TABLE).select("email").execute().data or []
        existing = normalize_email_list(row.get("email") or "" for row in existing_rows)
    except Exception as exc:
        logger.error("UPC DNK allowlist update failed (table missing?): %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="UPC DNK allowlist table is not available. Run the create_upc_dnk_print_id_allowlist migration.",
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

    return normalize_email_list(
        row.get("email") or "" for row in (db.table(TABLE).select("email").execute().data or [])
    )
