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

FEEDBACK_COMPANY = "MetroShoe Warehouse"


def _row_to_item(rec: dict) -> FeedbackItem:
    first_name = str(rec.get("first_name") or "").strip()
    last_name = str(rec.get("last_name") or "").strip()
    merged = f"{first_name} {last_name}".strip()
    submitted_name = str(rec.get("submitted_name") or merged).strip()
    company = str(rec.get("company") or FEEDBACK_COMPANY).strip() or FEEDBACK_COMPANY
    return FeedbackItem(
        id=str(rec["id"]),
        company=company,
        first_name=first_name,
        last_name=last_name,
        submitted_name=submitted_name,
        position=str(rec.get("position") or "").strip(),
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
        .select(
            "id, company, first_name, last_name, submitted_name, position, message, created_at",
        )
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
    """Store feedback with name entered by the user."""
    _ensure_profile_row(db, current_user)

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
        "message": (payload.message or "").strip() or None,
    }

    inserted = db.table("app_feedback").insert(row).execute()
    data = getattr(inserted, "data", None) or []

    if not data:
        logger.error("app_feedback insert returned no row (check DB schema: first_name, last_name, company)")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save feedback. If this persists, run database migrations for app_feedback.",
        )

    rec = data[0]
    return _row_to_item(rec)
