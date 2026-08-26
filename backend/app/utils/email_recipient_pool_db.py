"""Database helpers for email_recipient_pool queries (shared team directory)."""
from typing import Any, Dict, List, Optional

from supabase import Client

_POOL_SELECT = "id, email, display_name"


def _normalize_pool_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row.get("display_name"),
    }


def fetch_pool_rows(db: Client) -> List[Dict[str, Any]]:
    """Return all shared pool rows (not scoped by user)."""
    response = (
        db.table("email_recipient_pool")
        .select(_POOL_SELECT)
        .order("email")
        .execute()
    )
    return [_normalize_pool_row(row) for row in (response.data or [])]


def select_pool_entry(
    db: Client,
    *,
    email: Optional[str] = None,
    entry_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    query = db.table("email_recipient_pool").select(_POOL_SELECT)
    if email is not None:
        query = query.eq("email", email)
    if entry_id is not None:
        query = query.eq("id", entry_id)
    response = query.limit(1).execute()
    if not response.data:
        return None
    return _normalize_pool_row(response.data[0])


def insert_pool_entry(
    db: Client,
    user_id: str,
    email: str,
    display_name: Optional[str],
) -> Dict[str, Any]:
    """Insert a shared pool row; user_id is audit-only (who added)."""
    payload: Dict[str, Any] = {
        "user_id": user_id,
        "email": email,
        "display_name": display_name,
    }
    response = db.table("email_recipient_pool").insert(payload).execute()
    if not response.data:
        raise RuntimeError("Failed to save email")
    return _normalize_pool_row(response.data[0])


def update_pool_entry(
    db: Client,
    entry_id: str,
    update_payload: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    if not update_payload:
        return select_pool_entry(db, entry_id=entry_id)
    response = (
        db.table("email_recipient_pool")
        .update(update_payload)
        .eq("id", entry_id)
        .execute()
    )
    if not response.data:
        return None
    return _normalize_pool_row(response.data[0])
