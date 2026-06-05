"""Shared helpers for parsing recipient strings and resolving BCC flags."""
import re
from typing import List, Optional, Set

from supabase import Client

from app.utils.email_recipient_pool_db import pool_supports_is_bcc

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_BULK_PAGE_SIZE = 500


def normalize_email(raw: str) -> str:
    return raw.strip().lower()


def parse_recipient_csv(raw: Optional[str]) -> List[str]:
    if not raw or not str(raw).strip():
        return []
    out: List[str] = []
    seen: Set[str] = set()
    for part in str(raw).split(","):
        email = normalize_email(part)
        if email and _EMAIL_RE.match(email) and email not in seen:
            seen.add(email)
            out.append(email)
    return out


def lookup_bcc_emails(db: Client, emails: List[str]) -> List[str]:
    """Return normalized emails marked is_bcc in the shared recipient pool."""
    if not emails or not pool_supports_is_bcc(db):
        return []

    normalized = [normalize_email(email) for email in emails if email]
    normalized = [email for email in normalized if _EMAIL_RE.match(email)]
    if not normalized:
        return []

    bcc: Set[str] = set()
    for start in range(0, len(normalized), _BULK_PAGE_SIZE):
        chunk = normalized[start:start + _BULK_PAGE_SIZE]
        response = (
            db.table("email_recipient_pool")
            .select("email")
            .in_("email", chunk)
            .eq("is_bcc", True)
            .execute()
        )
        for row in response.data or []:
            email = row.get("email")
            if isinstance(email, str):
                n = normalize_email(email)
                if n:
                    bcc.add(n)
    return sorted(bcc)
