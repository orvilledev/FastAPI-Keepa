"""Shared helpers for parsing recipient strings."""
import re
from typing import List, Optional, Set

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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
