"""Presence heartbeat + superadmin live session listing."""

import logging
import re
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_current_user, get_superadmin_user
from app.repositories.user_presence_repository import UserPresenceRepository
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_SESSION_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.I,
)


class PresenceHeartbeatBody(BaseModel):
    session_id: str = Field(..., min_length=8, max_length=128)
    client_type: Literal["web", "electron"] = "web"
    is_active: bool = True
    path: Optional[str] = Field(None, max_length=256)


class PresenceLeaveBody(BaseModel):
    session_id: str = Field(..., min_length=8, max_length=128)


def _client_ip(request: Request) -> Optional[str]:
    xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip() or None
    xri = request.headers.get("x-real-ip") or request.headers.get("X-Real-IP")
    if xri:
        return xri.strip() or None
    if request.client and request.client.host:
        return request.client.host
    return None


def _validate_session_id(session_id: str) -> str:
    sid = session_id.strip()
    if not _SESSION_ID_RE.match(sid):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="session_id must be a UUID",
        )
    return sid


def _profile_bits(db: Client, user_id: str, fallback_email: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    email = (fallback_email or "").strip().lower() or None
    display_name = None
    try:
        resp = (
            db.table("profiles")
            .select("email, display_name")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        if resp.data:
            row = resp.data[0]
            email = (row.get("email") or email or "").strip().lower() or email
            display_name = (row.get("display_name") or "").strip() or None
    except Exception as e:
        logger.debug("presence profile lookup failed: %s", e)
    return email, display_name


@router.post("/presence/heartbeat")
@handle_api_errors("presence heartbeat")
def presence_heartbeat(
    body: PresenceHeartbeatBody,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Any signed-in client reports open/active/idle presence (one row per session)."""
    session_id = _validate_session_id(body.session_id)
    user_id = current_user["id"]
    email, display_name = _profile_bits(db, user_id, current_user.get("email"))
    repo = UserPresenceRepository(db)
    result = repo.upsert_heartbeat(
        session_id=session_id,
        user_id=user_id,
        email=email,
        display_name=display_name,
        client_type=body.client_type,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        path=body.path,
        is_active=body.is_active,
    )
    return {"ok": True, **result}


@router.post("/presence/leave")
@handle_api_errors("presence leave")
def presence_leave(
    body: PresenceLeaveBody,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Best-effort clear session when the tab/app closes."""
    session_id = _validate_session_id(body.session_id)
    deleted = UserPresenceRepository(db).delete_session(session_id, current_user["id"])
    return {"ok": True, "deleted": deleted}


@router.get("/presence/sessions")
@handle_api_errors("list presence sessions")
def list_presence_sessions(
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase),
):
    """Superadmin-only: live web + Electron sessions with email and IP."""
    return UserPresenceRepository(db).list_live_sessions()
