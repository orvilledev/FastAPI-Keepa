"""Repository for superadmin web-app audit logs."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from supabase import Client

ALLOWED_ACTIONS = frozenset({"login", "logout", "keepa_upload", "keepa_download"})
ALLOWED_CLIENT_TYPES = frozenset({"web", "electron"})


class AuditLogRepository:
    table = "audit_logs"

    def __init__(self, db: Client):
        self.db = db

    def record(
        self,
        *,
        action: str,
        user_id: Optional[str] = None,
        user_display_name: Optional[str] = None,
        user_email: Optional[str] = None,
        client_type: str = "web",
        ip_address: Optional[str] = None,
        detail: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        action_norm = (action or "").strip().lower()
        if action_norm not in ALLOWED_ACTIONS:
            raise ValueError(f"Unsupported audit action: {action}")

        client = (client_type or "web").strip().lower()
        if client not in ALLOWED_CLIENT_TYPES:
            client = "web"

        payload = {
            "action": action_norm,
            "user_id": str(user_id) if user_id else None,
            "user_display_name": (user_display_name or "").strip() or None,
            "user_email": (user_email or "").strip().lower() or None,
            "client_type": client,
            "ip_address": (ip_address or "").strip() or None,
            "detail": (detail or "").strip() or None,
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
        client_type: Optional[str] = "web",
    ) -> List[Dict[str, Any]]:
        query = self.db.table(self.table).select("*")
        if client_type:
            client = client_type.strip().lower()
            if client in ALLOWED_CLIENT_TYPES:
                query = query.eq("client_type", client)
        if action:
            action_norm = action.strip().lower()
            if action_norm in ALLOWED_ACTIONS:
                query = query.eq("action", action_norm)
        response = query.order("created_at", desc=True).limit(limit).execute()
        return [self._normalize(row) for row in (response.data or [])]

    @staticmethod
    def _normalize(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row.get("id")) if row.get("id") else None,
            "action": row.get("action"),
            "user_id": str(row.get("user_id")) if row.get("user_id") else None,
            "user_display_name": row.get("user_display_name"),
            "user_email": row.get("user_email"),
            "client_type": row.get("client_type") or "web",
            "ip_address": row.get("ip_address"),
            "detail": row.get("detail"),
            "metadata": row.get("metadata") or {},
            "created_at": row.get("created_at"),
        }
