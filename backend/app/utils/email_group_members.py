"""Helpers for shared email group member payloads stored in email_recipient_lists.emails."""
from typing import Any, Dict, List, Literal, Optional, Tuple

EmailMemberRole = Literal["to", "bcc"]


def normalize_group_members(
    raw: Any,
    *,
    validate_email=None,
) -> List[Dict[str, str]]:
    """
    Normalize DB/API member payloads to [{email, role}] with unique emails.
    BCC wins when the same address appears twice. Invalid emails are skipped
    when validate_email raises; otherwise invalid strings are skipped if empty.
    """
    if raw is None:
        return []

    items: List[Any]
    if isinstance(raw, str):
        return []
    if isinstance(raw, list):
        items = raw
    else:
        return []

    # email -> role; last write wins except we prefer bcc on conflict within one pass
    by_email: Dict[str, EmailMemberRole] = {}
    order: List[str] = []

    for item in items:
        email: Optional[str] = None
        role: EmailMemberRole = "to"

        if isinstance(item, str):
            email = item
        elif isinstance(item, dict):
            email = item.get("email")
            r = item.get("role", "to")
            if isinstance(r, str) and r.strip().lower() == "bcc":
                role = "bcc"
            else:
                role = "to"
        else:
            # pydantic-like objects
            email = getattr(item, "email", None)
            r = getattr(item, "role", "to")
            if isinstance(r, str) and r.strip().lower() == "bcc":
                role = "bcc"

        if not isinstance(email, str):
            continue
        candidate = email.strip().lower()
        if not candidate:
            continue

        if validate_email is not None:
            try:
                candidate = validate_email(candidate)
            except Exception:
                continue

        if candidate not in by_email:
            order.append(candidate)
            by_email[candidate] = role
        elif role == "bcc":
            by_email[candidate] = "bcc"

    return [{"email": e, "role": by_email[e]} for e in order]


def members_from_create_payload(
    members: Any,
    emails: Any,
    *,
    validate_email=None,
) -> List[Dict[str, str]]:
    """Prefer members[]; fall back to legacy emails[] as role=to."""
    if members:
        return normalize_group_members(members, validate_email=validate_email)
    if emails:
        return normalize_group_members(emails, validate_email=validate_email)
    return []


def split_members_to_bcc(members: List[Dict[str, str]]) -> Tuple[List[str], List[str]]:
    """Return (to_emails, bcc_emails) from normalized members."""
    to_list: List[str] = []
    bcc_list: List[str] = []
    for m in members:
        email = m.get("email", "")
        if not email:
            continue
        if m.get("role") == "bcc":
            bcc_list.append(email)
        else:
            to_list.append(email)
    return to_list, bcc_list
