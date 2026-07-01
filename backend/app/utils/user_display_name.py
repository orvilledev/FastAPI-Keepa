"""Resolve a friendly display name for a user (never raw email when avoidable)."""
from __future__ import annotations

from typing import Any, Mapping, Optional


def _title_local_email_part(email: str) -> Optional[str]:
    local_part = email.split("@", 1)[0].strip()
    if not local_part:
        return None
    local_part = local_part.replace(".", " ").replace("_", " ").replace("-", " ")
    local_part = " ".join(local_part.split())
    return local_part.title() if local_part else None


def resolve_user_display_name(
    *,
    display_name: Optional[str] = None,
    full_name: Optional[str] = None,
    email: Optional[str] = None,
    fallback: Optional[str] = None,
) -> Optional[str]:
    """Prefer profile names; derive a readable name from email local-part as last resort."""
    for name in (display_name, full_name):
        if isinstance(name, str) and name.strip():
            return name.strip()

    if isinstance(email, str) and email.strip():
        titled = _title_local_email_part(email.strip())
        if titled:
            return titled

    if isinstance(fallback, str) and fallback.strip():
        return fallback.strip()
    return None


def profile_display_name(profile: Mapping[str, Any], current_user: Mapping[str, Any]) -> Optional[str]:
    """Display name snapshot from a profiles row + auth user payload."""
    metadata = current_user.get("user_metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}

    return resolve_user_display_name(
        display_name=(
            profile.get("display_name")
            or metadata.get("display_name")
            or metadata.get("name")
        ),
        full_name=profile.get("full_name") or metadata.get("full_name"),
        email=profile.get("email") or current_user.get("email"),
    )


def format_stored_creator_name(value: Optional[str]) -> Optional[str]:
    """Format a persisted created_by_name (fixes legacy rows that stored email)."""
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    if raw.lower() == "scheduled run":
        return raw
    if "@" in raw:
        return resolve_user_display_name(email=raw) or raw
    return raw
