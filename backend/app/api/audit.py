"""Superadmin audit log API (web-app actions only)."""
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_current_user, get_superadmin_user
from app.repositories.audit_log_repository import ALLOWED_ACTIONS, AuditLogRepository
from app.services.audit_log_service import record_audit_event
from app.utils.error_handler import handle_api_errors

router = APIRouter()


class AuditEventCreate(BaseModel):
    action: Literal["login", "logout"]
    detail: Optional[str] = Field(None, max_length=500)
    metadata: Optional[Dict[str, Any]] = None


@router.post("/audit/events")
@handle_api_errors("record audit event")
def create_audit_event(
    body: AuditEventCreate,
    request: Request,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Record login/logout from the web client (best-effort; never blocks UX)."""
    row = record_audit_event(
        db,
        action=body.action,
        current_user=current_user,
        request=request,
        detail=body.detail,
        metadata=body.metadata,
        web_only=True,
    )
    return {"ok": True, "recorded": row is not None, "event": row}


@router.get("/audit/events")
@handle_api_errors("list audit events")
def list_audit_events(
    limit: int = Query(100, ge=1, le=500),
    action: Optional[str] = Query(None),
    client_type: Optional[str] = Query("web"),
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase),
):
    """Superadmin-only list of audit events. Defaults to web-app events only."""
    if action and action.strip().lower() not in ALLOWED_ACTIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"action must be one of: {', '.join(sorted(ALLOWED_ACTIONS))}",
        )
    repo = AuditLogRepository(db)
    try:
        logs: List[Dict[str, Any]] = repo.list_logs(
            limit=limit,
            action=action,
            client_type=client_type,
        )
        return {"logs": logs, "available": True}
    except Exception as exc:
        return {"logs": [], "available": False, "detail": str(exc)}
