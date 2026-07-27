"""ASGI middleware that records every meaningful web-app action in audit_logs.

Implemented as raw ASGI (rather than BaseHTTPMiddleware) so it never buffers
request or response bodies: file uploads and streamed downloads pass straight
through and the audit row is written after the response has been delivered.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, Optional, Set

from app.services.audit_actions import describe, safe_query_metadata, should_audit
from app.utils.jwt_utils import decode_jwt_payload

logger = logging.getLogger(__name__)

# Keep strong references to in-flight writes so they are not garbage collected.
_pending: Set[asyncio.Task] = set()

# user_id -> (display_name, expires_at). Avoids a profiles lookup per request.
_display_name_cache: Dict[str, tuple[Optional[str], float]] = {}
_DISPLAY_NAME_TTL_SECONDS = 300
_DISPLAY_NAME_CACHE_MAX = 500


def _header(scope_headers, name: bytes) -> Optional[str]:
    for key, value in scope_headers:
        if key.lower() == name:
            try:
                return value.decode("latin-1")
            except Exception:
                return None
    return None


def _client_ip(scope) -> Optional[str]:
    headers = scope.get("headers") or []
    xff = _header(headers, b"x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    xri = _header(headers, b"x-real-ip")
    if xri and xri.strip():
        return xri.strip()
    client = scope.get("client")
    if client and client[0]:
        return client[0]
    return None


def _bearer_claims(scope) -> Dict[str, Any]:
    auth = _header(scope.get("headers") or [], b"authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return {}
    return decode_jwt_payload(auth.split(" ", 1)[1].strip())


def _cached_display_name(db, user_id: str, email: Optional[str]) -> Optional[str]:
    now = time.monotonic()
    hit = _display_name_cache.get(user_id)
    if hit and hit[1] > now:
        return hit[0]

    name: Optional[str] = None
    try:
        resp = (
            db.table("profiles")
            .select("display_name, email")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        if row:
            name = (row.get("display_name") or "").strip() or None
            if not name:
                row_email = (row.get("email") or email or "").strip()
                name = row_email.split("@")[0] or None
    except Exception as exc:
        logger.debug("audit display-name lookup failed: %s", exc)

    if not name and email:
        name = email.split("@")[0] or None

    if len(_display_name_cache) >= _DISPLAY_NAME_CACHE_MAX:
        _display_name_cache.clear()
    _display_name_cache[user_id] = (name, now + _DISPLAY_NAME_TTL_SECONDS)
    return name


def _write_audit_row(
    *,
    user_id: str,
    email: Optional[str],
    client_type: str,
    ip_address: Optional[str],
    method: str,
    path: str,
    status_code: Optional[int],
    metadata: Dict[str, Any],
) -> None:
    """Runs in a worker thread; must never raise into the event loop."""
    try:
        from app.database import get_supabase
        from app.repositories.audit_log_repository import AuditLogRepository

        db = get_supabase()
        descriptor = describe(method, path)
        label = descriptor.label
        if status_code is not None and status_code >= 400:
            label = f"{label} (failed)"

        AuditLogRepository(db).record(
            action=descriptor.action,
            category=descriptor.category,
            label=label,
            user_id=user_id,
            user_display_name=_cached_display_name(db, user_id, email),
            user_email=email,
            client_type=client_type,
            ip_address=ip_address,
            method=method,
            path=path,
            status_code=status_code,
            detail=label,
            metadata=metadata,
        )
    except Exception as exc:
        logger.warning("audit middleware write failed for %s %s: %s", method, path, exc)


class AuditLogMiddleware:
    """Records mutating requests and file downloads made from the web app."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "")
        path = scope.get("path", "")
        if not should_audit(method, path):
            await self.app(scope, receive, send)
            return

        status_code: Optional[int] = None

        async def send_wrapper(message):
            nonlocal status_code
            if message.get("type") == "http.response.start":
                status_code = message.get("status")
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            try:
                self._schedule(scope, method, path, status_code)
            except Exception as exc:
                logger.warning("audit middleware scheduling failed: %s", exc)

    def _schedule(self, scope, method: str, path: str, status_code: Optional[int]) -> None:
        # Unauthenticated requests have no one to attribute the action to.
        claims = _bearer_claims(scope)
        user_id = claims.get("sub")
        if not user_id or not isinstance(user_id, str):
            return

        headers = scope.get("headers") or []
        client_type = (_header(headers, b"x-client-type") or "web").strip().lower()
        # The audit log covers the web app; the desktop build is tracked separately.
        if client_type != "web":
            return

        email = claims.get("email")
        query_string = (scope.get("query_string") or b"").decode("latin-1", "ignore")
        metadata = safe_query_metadata(query_string)

        task = asyncio.create_task(
            asyncio.to_thread(
                _write_audit_row,
                user_id=user_id,
                email=email if isinstance(email, str) else None,
                client_type=client_type,
                ip_address=_client_ip(scope),
                method=method.upper(),
                path=path,
                status_code=status_code,
                metadata=metadata,
            )
        )
        _pending.add(task)
        task.add_done_callback(_pending.discard)
