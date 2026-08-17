"""Repository for superadmin web-app audit logs."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from supabase import Client

from app.services.audit_actions import CATEGORIES

# Action slugs are free-form (so new tools need no migration) but must stay
# within the format the audit_logs CHECK constraint allows.
_ACTION_RE = re.compile(r"^[a-z][a-z0-9_.]{1,63}$")

ALLOWED_CLIENT_TYPES = frozenset({"web", "electron"})

_MAX_DETAIL_CHARS = 500
_MAX_LABEL_CHARS = 200

# Named explicitly rather than "*" so that a database still on the pre-expansion
# schema fails the read, which surfaces the "apply the migration" hint in the UI
# instead of silently dropping every write.
_COLUMNS = (
    "id, action, category, label, user_id, user_display_name, user_email, "
    "client_type, ip_address, method, path, status_code, detail, metadata, created_at"
)


def normalize_action(action: str) -> str:
    """Coerce an action name into the stored slug format."""
    slug = re.sub(r"[^a-z0-9_.]+", "_", (action or "").strip().lower()).strip("_.")
    if not slug or not slug[0].isalpha():
        slug = f"other.{slug}" if slug else "other.unknown"
    slug = slug[:64]
    if not _ACTION_RE.match(slug):
        raise ValueError(f"Unsupported audit action: {action}")
    return slug


class AuditLogRepository:
    table = "audit_logs"

    def __init__(self, db: Client):
        self.db = db

    def record(
        self,
        *,
        action: str,
        category: str = "other",
        label: Optional[str] = None,
        user_id: Optional[str] = None,
        user_display_name: Optional[str] = None,
        user_email: Optional[str] = None,
        client_type: str = "web",
        ip_address: Optional[str] = None,
        method: Optional[str] = None,
        path: Optional[str] = None,
        status_code: Optional[int] = None,
        detail: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        client = (client_type or "web").strip().lower()
        if client not in ALLOWED_CLIENT_TYPES:
            client = "web"

        cat = (category or "other").strip().lower()
        if cat not in CATEGORIES:
            cat = "other"

        payload = {
            "action": normalize_action(action),
            "category": cat,
            "label": (label or "").strip()[:_MAX_LABEL_CHARS] or None,
            "user_id": str(user_id) if user_id else None,
            "user_display_name": (user_display_name or "").strip() or None,
            "user_email": (user_email or "").strip().lower() or None,
            "client_type": client,
            "ip_address": (ip_address or "").strip() or None,
            "method": (method or "").strip().upper() or None,
            "path": (path or "").strip()[:300] or None,
            "status_code": status_code,
            "detail": (detail or "").strip()[:_MAX_DETAIL_CHARS] or None,
            "metadata": metadata or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        response = self.db.table(self.table).insert(payload).execute()
        data = (response.data or [None])[0] or payload
        return self._normalize(data)

    def list_logs(
        self,
        *,
        limit: int = 100,
        action: Optional[str] = None,
        category: Optional[str] = None,
        client_type: Optional[str] = None,
        search: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        query = self.db.table(self.table).select(_COLUMNS)
        if client_type:
            client = client_type.strip().lower()
            if client in ALLOWED_CLIENT_TYPES:
                query = query.eq("client_type", client)
        if action:
            query = query.eq("action", action.strip().lower())
        if category:
            cat = category.strip().lower()
            if cat in CATEGORIES:
                query = query.eq("category", cat)
        if search:
            term = search.strip().replace("%", "").replace(",", "")
            if term:
                query = query.or_(
                    f"user_email.ilike.%{term}%,"
                    f"user_display_name.ilike.%{term}%,"
                    f"detail.ilike.%{term}%"
                )
        response = query.order("created_at", desc=True).limit(limit).execute()
        return [self._normalize(row) for row in (response.data or [])]

    @staticmethod
    def _normalize(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row.get("id")) if row.get("id") else None,
            "action": row.get("action"),
            "category": row.get("category") or "other",
            "label": row.get("label"),
            "user_id": str(row.get("user_id")) if row.get("user_id") else None,
            "user_display_name": row.get("user_display_name"),
            "user_email": row.get("user_email"),
            "client_type": row.get("client_type") or "web",
            "ip_address": row.get("ip_address"),
            "method": row.get("method"),
            "path": row.get("path"),
            "status_code": row.get("status_code"),
            "detail": row.get("detail"),
            "metadata": row.get("metadata") or {},
            "created_at": row.get("created_at"),
        }
