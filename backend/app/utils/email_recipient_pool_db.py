"""Database helpers for email_recipient_pool with is_bcc migration fallback."""
import logging
from typing import Any, Dict, List, Optional

from supabase import Client

logger = logging.getLogger(__name__)

_POOL_BASE_SELECT = "id, email, display_name"
_POOL_FULL_SELECT = "id, email, display_name, is_bcc"

_is_bcc_supported: Optional[bool] = None


def _is_missing_is_bcc_column(exc: Exception) -> bool:
    text = str(exc).lower()
    return "is_bcc" in text and (
        "pgrst204" in text or "column" in text or "schema cache" in text
    )


def pool_supports_is_bcc(db: Client) -> bool:
    """Return True when email_recipient_pool.is_bcc exists (cached after first check)."""
    global _is_bcc_supported
    if _is_bcc_supported is not None:
        return _is_bcc_supported
    try:
        db.table("email_recipient_pool").select("is_bcc").limit(1).execute()
        _is_bcc_supported = True
    except Exception as exc:
        if _is_missing_is_bcc_column(exc):
            _is_bcc_supported = False
            logger.warning(
                "email_recipient_pool.is_bcc column missing; "
                "run database/migrations/add_is_bcc_to_email_recipient_pool.sql"
            )
        else:
            raise
    return _is_bcc_supported


def _normalize_pool_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row.get("display_name"),
        "is_bcc": bool(row.get("is_bcc")),
    }


def fetch_pool_rows(db: Client, user_id: str) -> List[Dict[str, Any]]:
    """Load pool rows for a user, falling back when is_bcc has not been migrated yet."""
    if pool_supports_is_bcc(db):
        response = (
            db.table("email_recipient_pool")
            .select(_POOL_FULL_SELECT)
            .eq("user_id", user_id)
            .order("email")
            .execute()
        )
    else:
        response = (
            db.table("email_recipient_pool")
            .select(_POOL_BASE_SELECT)
            .eq("user_id", user_id)
            .order("email")
            .execute()
        )
    return [_normalize_pool_row(row) for row in (response.data or [])]


def select_pool_entry(
    db: Client,
    user_id: str,
    *,
    email: Optional[str] = None,
    entry_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    query = db.table("email_recipient_pool")
    if pool_supports_is_bcc(db):
        query = query.select(_POOL_FULL_SELECT)
    else:
        query = query.select(_POOL_BASE_SELECT)
    query = query.eq("user_id", user_id)
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
    is_bcc: bool,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "user_id": user_id,
        "email": email,
        "display_name": display_name,
    }
    if pool_supports_is_bcc(db):
        payload["is_bcc"] = is_bcc
    response = db.table("email_recipient_pool").insert(payload).execute()
    if not response.data:
        raise RuntimeError("Failed to save email")
    return _normalize_pool_row(response.data[0])


def update_pool_entry(
    db: Client,
    user_id: str,
    entry_id: str,
    update_payload: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    payload = dict(update_payload)
    if not pool_supports_is_bcc(db):
        payload.pop("is_bcc", None)
    if not payload:
        return select_pool_entry(db, user_id, entry_id=entry_id)
    response = (
        db.table("email_recipient_pool")
        .update(payload)
        .eq("user_id", user_id)
        .eq("id", entry_id)
        .execute()
    )
    if not response.data:
        return None
    return _normalize_pool_row(response.data[0])
