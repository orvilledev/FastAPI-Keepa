"""Submit in-app feedback (authenticated users)."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.api.auth import _ensure_profile_row
from app.database import get_supabase
from app.dependencies import get_current_user
from app.models.feedback import FeedbackCreate, FeedbackResponse
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


@router.post("/feedback", response_model=FeedbackResponse, status_code=201)
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
    return FeedbackResponse(id=str(rec["id"]), created_at=str(rec["created_at"]))
