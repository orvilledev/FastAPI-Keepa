"""Personal My Space notes API. Fully user-scoped; isolated from other features."""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from supabase import Client

from app.api.auth import _ensure_profile_row
from app.database import get_supabase
from app.dependencies import get_current_user
from app.models.note import NoteCreate, NoteResponse, NoteUpdate
from app.utils.error_handler import handle_api_errors

router = APIRouter()

_NOTE_COLUMNS = "id, user_id, title, content, created_at, updated_at"


def _normalize_row(raw: dict) -> dict:
    row = dict(raw)
    for key in ("id", "user_id"):
        if key in row and row[key] is not None and not isinstance(row[key], str):
            row[key] = str(row[key])
    if row.get("content") is None:
        row["content"] = ""
    return row


def _fetch_owned(db: Client, note_id: str, user_id: str) -> dict | None:
    response = (
        db.table("notes")
        .select(_NOTE_COLUMNS)
        .eq("id", note_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = getattr(response, "data", None) or []
    return rows[0] if rows else None


@router.get("/my-space/notes", response_model=List[NoteResponse])
@handle_api_errors("list my-space notes")
def list_notes(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Return the signed-in user's notes, newest update first."""
    response = (
        db.table("notes")
        .select(_NOTE_COLUMNS)
        .eq("user_id", current_user["id"])
        .order("updated_at", desc=True)
        .execute()
    )
    rows = getattr(response, "data", None) or []
    return [NoteResponse(**_normalize_row(row)) for row in rows]


@router.post("/my-space/notes", response_model=NoteResponse, status_code=201)
@handle_api_errors("create my-space note")
def create_note(
    payload: NoteCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Create a note owned by the signed-in user."""
    _ensure_profile_row(db, current_user)
    row = {
        "user_id": current_user["id"],
        "title": payload.title,
        "content": payload.content,
    }
    inserted = db.table("notes").insert(row).execute()
    data = getattr(inserted, "data", None) or []
    if not data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Could not save note. If this persists, run "
                "backend/database/notes_schema.sql in the Supabase SQL Editor."
            ),
        )
    return NoteResponse(**_normalize_row(data[0]))


@router.patch("/my-space/notes/{note_id}", response_model=NoteResponse)
@handle_api_errors("update my-space note")
def update_note(
    note_id: UUID,
    payload: NoteUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Update title and/or content on a note the user owns."""
    existing = _fetch_owned(db, str(note_id), current_user["id"])
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

    patch = payload.model_dump(exclude_unset=True)
    if not patch:
        return NoteResponse(**_normalize_row(existing))

    patch["updated_at"] = "now()"
    updated = (
        db.table("notes")
        .update(patch)
        .eq("id", str(note_id))
        .eq("user_id", current_user["id"])
        .execute()
    )
    data = getattr(updated, "data", None) or []
    if not data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not update note",
        )
    return NoteResponse(**_normalize_row(data[0]))


@router.delete("/my-space/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
@handle_api_errors("delete my-space note")
def delete_note(
    note_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Delete a note the user owns."""
    existing = _fetch_owned(db, str(note_id), current_user["id"])
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

    db.table("notes").delete().eq("id", str(note_id)).eq("user_id", current_user["id"]).execute()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
