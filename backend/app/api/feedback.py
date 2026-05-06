"""Submit and list in-app feedback (authenticated users)."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from supabase import Client

from app.api.auth import _ensure_profile_row
from app.database import get_supabase
from app.dependencies import get_current_user
from app.models.feedback import FeedbackCreate, FeedbackItem
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()


def _submitter_display_name(profile: dict, current_user: dict) -> str:
    raw = profile.get("display_name")
    if raw is not None and str(raw).strip():
        return str(raw).strip()
    email = (current_user.get("email") or profile.get("email") or "").strip()
    if "@" in email:
        return email.split("@", 1)[0]
    return email or "User"


def _row_to_item(rec: dict) -> FeedbackItem:
    return FeedbackItem(
        id=str(rec["id"]),
        submitted_name=rec.get("submitted_name") or "",
        position=rec.get("position") or "",
        message=rec.get("message"),
        created_at=str(rec["created_at"]),
    )


@router.get("/feedback/me", response_model=list[FeedbackItem])
@handle_api_errors("list feedback")
async def list_my_feedback(
    limit: int = Query(50, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Return this user's submitted feedback, newest first."""
    response = (
        db.table("app_feedback")
        .select("id, submitted_name, position, message, created_at")
        .eq("user_id", current_user["id"])
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = getattr(response, "data", None) or []
    return [_row_to_item(r) for r in rows]


@router.post("/feedback", response_model=FeedbackItem, status_code=201)
@handle_api_errors("submit feedback")
async def submit_feedback(
    payload: FeedbackCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Store feedback with name derived from the user's profile (not client-supplied)."""
    profile = _ensure_profile_row(db, current_user)
    submitted_name = _submitter_display_name(profile, current_user)

    row = {
        "user_id": current_user["id"],
        "email": current_user.get("email"),
        "submitted_name": submitted_name,
        "position": payload.position.strip(),
        "message": (payload.message or "").strip() or None,
    }

    inserted = db.table("app_feedback").insert(row).execute()
    data = getattr(inserted, "data", None) or []

    if not data:
        logger.error("app_feedback insert returned no row")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save feedback",
        )

    rec = data[0]
    return _row_to_item(rec)
