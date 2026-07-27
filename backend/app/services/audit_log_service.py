"""Best-effort audit logging helpers (never fail the primary request)."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import Request
from supabase import Client

from app.repositories.audit_log_repository import AuditLogRepository

logger = logging.getLogger(__name__)


def client_ip(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip() or None
    xri = request.headers.get("x-real-ip") or request.headers.get("X-Real-IP")
    if xri:
        return xri.strip() or None
    if request.client and request.client.host:
        return request.client.host
    return None


def client_type_from_request(request: Optional[Request], fallback: str = "web") -> str:
    """Resolve web vs electron from X-Client-Type (set by the frontend axios client)."""
    if request is None:
        return fallback
    raw = (
        request.headers.get("x-client-type")
        or request.headers.get("X-Client-Type")
        or fallback
    )
    value = (raw or fallback).strip().lower()
    return value if value in ("web", "electron") else fallback


def display_name_for_user(current_user: dict, db: Client) -> Optional[str]:
    uid = current_user.get("id")
    if uid:
        try:
            profile = (
                db.table("profiles")
                .select("display_name, email")
                .eq("id", str(uid))
                .limit(1)
                .execute()
            )
            row = (profile.data or [None])[0]
            if row:
                name = (row.get("display_name") or "").strip()
                if name:
                    return name
                email = (row.get("email") or current_user.get("email") or "").strip()
                if email:
                    return email.split("@")[0]
        except Exception:
            pass
    meta = current_user.get("user_metadata") or {}
    return (
        (meta.get("display_name") or "").strip()
        or (current_user.get("email") or "").split("@")[0]
        or None
    )


def record_audit_event(
    db: Client,
    *,
    action: str,
    current_user: dict,
    request: Optional[Request] = None,
    detail: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    client_type: Optional[str] = None,
    web_only: bool = True,
) -> Optional[Dict[str, Any]]:
    """Insert an audit row. Swallows all errors so callers are never blocked.

    When ``web_only`` is True (default), Electron clients are skipped so the
    log stays scoped to the web app.
    """
    try:
        resolved_client = client_type or client_type_from_request(request)
        if web_only and resolved_client != "web":
            return None

        repo = AuditLogRepository(db)
        return repo.record(
            action=action,
            user_id=str(current_user["id"]) if current_user.get("id") else None,
            user_display_name=display_name_for_user(current_user, db),
            user_email=current_user.get("email"),
            client_type=resolved_client,
            ip_address=client_ip(request),
            detail=detail,
            metadata=metadata,
        )
    except Exception as exc:
        logger.warning("audit log write failed (%s): %s", action, exc)
        return None
