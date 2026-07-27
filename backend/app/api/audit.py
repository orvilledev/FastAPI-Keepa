"""Superadmin audit log API (web-app actions only)."""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_current_user, get_superadmin_user
from app.repositories.audit_log_repository import AuditLogRepository
from app.services.audit_actions import CATEGORIES
from app.services.audit_log_service import record_audit_event
from app.utils.error_handler import handle_api_errors

router = APIRouter()

# Actions the browser is allowed to report. Server-side actions are captured by
# the audit middleware instead; keeping this an allowlist stops the log from
# being polluted with arbitrary client-supplied action names.
CLIENT_ACTIONS: Dict[str, tuple[str, str]] = {
    "login": ("auth", "Signed in"),
    "logout": ("auth", "Signed out"),
    "playground.run": ("playground", "Ran a Testing Playground tool"),
    "playground.download": ("playground", "Downloaded a Playground test output"),
    "playground.fixture_upload": ("playground", "Uploaded a Playground test file"),
    "playground.fixture_remove": ("playground", "Removed a Playground test file"),
    "playground.tool_add": ("playground", "Added a tool to the Playground"),
    "playground.tool_remove": ("playground", "Removed a tool from the Playground"),
    "fnsku.parse": ("tool", "Loaded a file into FNSKU Labels"),
    "fnsku.download": ("download", "Downloaded FNSKU labels"),
    "fnsku.history_delete": ("data", "Deleted an FNSKU Labels history entry"),
    "fnsku.history_clear": ("data", "Cleared FNSKU Labels history"),
    "tracking.scan_browser": ("tool", "Scanned PDFs with the Tracking Extractor"),
    "tracking.export_excel": ("download", "Exported Tracking Extractor rows to Excel"),
    "label_station.print": ("tool", "Printed a warehouse label"),
    "label_station.download_pdf": ("download", "Downloaded a warehouse label PDF"),
    "label_station.template_download": ("download", "Downloaded the warehouse products template"),
}

_MAX_METADATA_KEYS = 12
_MAX_METADATA_VALUE_CHARS = 200


def _sanitize_metadata(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Keep client-supplied metadata small and flat before storing it."""
    out: Dict[str, Any] = {}
    for key, value in (raw or {}).items():
        if len(out) >= _MAX_METADATA_KEYS:
            break
        if isinstance(value, (bool, int, float)) or value is None:
            out[str(key)[:40]] = value
        else:
            out[str(key)[:40]] = str(value)[:_MAX_METADATA_VALUE_CHARS]
    return out


class AuditEventCreate(BaseModel):
    action: str = Field(..., min_length=2, max_length=64)
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
    """Record a browser-side action that the audit middleware cannot observe."""
    action = body.action.strip().lower()
    known = CLIENT_ACTIONS.get(action)
    if known is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported client audit action: {action}",
        )
    category, default_label = known

    row = record_audit_event(
        db,
        action=action,
        current_user=current_user,
        request=request,
        category=category,
        label=default_label,
        detail=body.detail or default_label,
        metadata=_sanitize_metadata(body.metadata),
        web_only=True,
    )
    return {"ok": True, "recorded": row is not None, "event": row}


@router.get("/audit/events")
@handle_api_errors("list audit events")
def list_audit_events(
    limit: int = Query(200, ge=1, le=500),
    action: Optional[str] = Query(None, max_length=64),
    category: Optional[str] = Query(None, max_length=32),
    search: Optional[str] = Query(None, max_length=120),
    client_type: Optional[str] = Query("web"),
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase),
):
    """Superadmin-only list of audit events. Defaults to web-app events only."""
    if category and category.strip().lower() not in CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"category must be one of: {', '.join(CATEGORIES)}",
        )
    repo = AuditLogRepository(db)
    try:
        logs: List[Dict[str, Any]] = repo.list_logs(
            limit=limit,
            action=action,
            category=category,
            client_type=client_type,
            search=search,
        )
        return {"logs": logs, "available": True, "categories": list(CATEGORIES)}
    except Exception as exc:
        return {
            "logs": [],
            "available": False,
            "categories": list(CATEGORIES),
            "detail": str(exc),
        }
