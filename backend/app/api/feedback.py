"""Submit and list in-app feedback (authenticated users)."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from supabase import Client

from app.api.auth import _ensure_profile_row
from app.api.feedback_blocklist import feedback_blocked_for_identity
from app.database import get_supabase
from app.dependencies import get_current_user, get_superadmin_user, is_superadmin_user
from app.models.feedback import FeedbackCreate, FeedbackItem, FeedbackUpdate
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

FEEDBACK_COMPANY = "MetroShoe Warehouse"


def _effective_signature(signature_raw: str | None, submitted_name: str) -> str:
    """Non-empty signature for DB; avoids NOT NULL violations if clients omit legacy field."""
    sig = (signature_raw or "").strip()
    fallback = (submitted_name or "").strip() or "—"
    return sig if sig else fallback


def _row_to_item(rec: dict) -> FeedbackItem:
    first_name = str(rec.get("first_name") or "").strip()
    last_name = str(rec.get("last_name") or "").strip()
    merged = f"{first_name} {last_name}".strip()
    submitted_name = str(rec.get("submitted_name") or merged).strip()
    company = str(rec.get("company") or FEEDBACK_COMPANY).strip() or FEEDBACK_COMPANY
    uid = rec.get("user_id")
    sig = str(rec.get("signature") or "").strip()
    if not sig:
        sig = submitted_name or "—"
    return FeedbackItem(
        user_id=str(uid) if uid is not None else "",
        id=str(rec["id"]),
        company=company,
        first_name=first_name,
        last_name=last_name,
        submitted_name=submitted_name,
        position=str(rec.get("position") or "").strip(),
        signature=sig,
        message=rec.get("message"),
        created_at=str(rec["created_at"]),
    )


def _fetch_feedback_row(db: Client, fid: str) -> dict | None:
    res = db.table("app_feedback").select("id, user_id").eq("id", fid).limit(1).execute()
    rows = getattr(res, "data", None) or []
    return rows[0] if rows else None


def _reject_if_feedback_blocked(db: Client, current_user: dict) -> None:
    prof = db.table("profiles").select("display_name,email").eq("id", current_user["id"]).limit(1).execute()
    dn = ""
    em = ""
    if getattr(prof, "data", None):
        row = prof.data[0]
        dn = str(row.get("display_name") or "").strip()
        em = str(row.get("email") or "").strip().lower()
    if not em:
        em = str(current_user.get("email") or "").strip().lower()
    if feedback_blocked_for_identity(dn, em):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Feedback is not available for your account.",
        )


def require_feedback_allowed(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
) -> dict:
    _reject_if_feedback_blocked(db, current_user)
    return current_user


def require_superadmin_feedback_allowed(
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase),
) -> dict:
    _reject_if_feedback_blocked(db, current_user)
    return current_user


@router.get("/feedback/me", response_model=list[FeedbackItem])
@handle_api_errors("list feedback")
def list_my_feedback(
    limit: int = Query(50, ge=1, le=100),
    current_user: dict = Depends(require_feedback_allowed),
    db: Client = Depends(get_supabase),
):
    """Return this user's feedback (at most one row per user once uniqueness is enforced)."""
    response = (
        db.table("app_feedback")
        .select(
            "id, user_id, company, first_name, last_name, submitted_name, position, signature, message, created_at",
        )
        .eq("user_id", current_user["id"])
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = getattr(response, "data", None) or []
    return [_row_to_item(r) for r in rows]


@router.get("/feedback/all", response_model=list[FeedbackItem])
@handle_api_errors("list all feedback")
def list_all_feedback(
    limit: int = Query(200, ge=1, le=500),
    current_user: dict = Depends(require_superadmin_feedback_allowed),
    db: Client = Depends(get_supabase),
):
    """Return all submitted feedback (newest first). Superadmin only."""
    response = (
        db.table("app_feedback")
        .select(
            "id, user_id, company, first_name, last_name, submitted_name, position, signature, message, created_at",
        )
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = getattr(response, "data", None) or []
    return [_row_to_item(r) for r in rows]


@router.delete("/feedback/{feedback_id}", status_code=status.HTTP_204_NO_CONTENT)
@handle_api_errors("delete feedback")
def delete_feedback(
    feedback_id: UUID,
    current_user: dict = Depends(require_feedback_allowed),
    db: Client = Depends(get_supabase),
):
    """Remove feedback. Allowed for superadmin (any row) or the submitter (own rows only)."""
    fid = str(feedback_id)
    row_meta = _fetch_feedback_row(db, fid)
    if not row_meta:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")

    owner_id = str(row_meta.get("user_id") or "")
    is_owner = owner_id == str(current_user["id"])
    if not is_superadmin_user(current_user, db) and not is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own feedback.",
        )

    db.table("app_feedback").delete().eq("id", fid).execute()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/feedback/{feedback_id}", response_model=FeedbackItem)
@handle_api_errors("update feedback")
def update_feedback(
    feedback_id: UUID,
    payload: FeedbackUpdate,
    current_user: dict = Depends(require_feedback_allowed),
    db: Client = Depends(get_supabase),
):
    """Update editable fields on own feedback only."""
    fid = str(feedback_id)
    row_meta = _fetch_feedback_row(db, fid)
    if not row_meta:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")

    if str(row_meta.get("user_id") or "") != str(current_user["id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own feedback.",
        )

    first_name = payload.first_name.strip()
    last_name = payload.last_name.strip()
    submitted_name = f"{first_name} {last_name}".strip()

    patch = {
        "first_name": first_name,
        "last_name": last_name,
        "submitted_name": submitted_name,
        "position": payload.position.strip(),
        "signature": _effective_signature(payload.signature, submitted_name),
        "message": (payload.message or "").strip() or None,
    }

    res = db.table("app_feedback").update(patch).eq("id", fid).execute()
    data = getattr(res, "data", None) or []
    if not data:
        logger.error("app_feedback patch returned no row for id=%s", fid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not update feedback",
        )

    rec = data[0]
    rec.setdefault("user_id", current_user["id"])
    return _row_to_item(rec)


@router.post("/feedback", response_model=FeedbackItem, status_code=201)
@handle_api_errors("submit feedback")
def submit_feedback(
    payload: FeedbackCreate,
    current_user: dict = Depends(require_feedback_allowed),
    db: Client = Depends(get_supabase),
):
    """Store feedback with name entered by the user. One submission per account at a time."""
    _ensure_profile_row(db, current_user)

    existing = (
        db.table("app_feedback")
        .select("id")
        .eq("user_id", current_user["id"])
        .limit(1)
        .execute()
    )
    if getattr(existing, "data", None):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have feedback. Edit or delete it before adding a new one.",
        )

    first_name = payload.first_name.strip()
    last_name = payload.last_name.strip()
    submitted_name = f"{first_name} {last_name}".strip()

    row = {
        "user_id": current_user["id"],
        "email": current_user.get("email"),
        "company": FEEDBACK_COMPANY,
        "first_name": first_name,
        "last_name": last_name,
        "submitted_name": submitted_name,
        "position": payload.position.strip(),
        "signature": _effective_signature(payload.signature, submitted_name),
        "message": (payload.message or "").strip() or None,
    }

    inserted = db.table("app_feedback").insert(row).execute()
    data = getattr(inserted, "data", None) or []

    if not data:
        logger.error("app_feedback insert returned no row (check DB schema includes signature)")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save feedback. If this persists, run database migrations for app_feedback.",
        )

    rec = data[0]
    rec.setdefault("user_id", current_user["id"])
    return _row_to_item(rec)
