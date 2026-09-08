"""Per-user project tracker API. Isolated from Keepa jobs and warehouse flows."""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from supabase import Client

from app.api.auth import _ensure_profile_row
from app.database import get_supabase
from app.dependencies import get_projects_user
from app.models.project import (
    DONE_STATUSES,
    PROJECT_STATUSES,
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
)
from app.utils.error_handler import handle_api_errors

router = APIRouter()

_PROJECT_COLUMNS = (
    "id, user_id, name, notes, status, created_at, updated_at, completed_at"
)


def _normalize_row(raw: dict) -> dict:
    row = dict(raw)
    for key in ("id", "user_id"):
        if key in row and row[key] is not None and not isinstance(row[key], str):
            row[key] = str(row[key])
    return row


def _completed_at_for_status(status_value: str) -> Optional[str]:
    if status_value in DONE_STATUSES:
        return "now()"
    return None


def _fetch_owned(db: Client, project_id: str, user_id: str) -> dict | None:
    response = (
        db.table("projects")
        .select(_PROJECT_COLUMNS)
        .eq("id", project_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = getattr(response, "data", None) or []
    return rows[0] if rows else None


@router.get("/projects", response_model=List[ProjectResponse])
@handle_api_errors("list projects")
def list_projects(
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: dict = Depends(get_projects_user),
    db: Client = Depends(get_supabase),
):
    """Return the signed-in user's projects, newest update first."""
    query = (
        db.table("projects")
        .select(_PROJECT_COLUMNS)
        .eq("user_id", current_user["id"])
        .order("updated_at", desc=True)
    )
    if status_filter:
        if status_filter not in PROJECT_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid status filter.",
            )
        query = query.eq("status", status_filter)
    response = query.execute()
    rows = getattr(response, "data", None) or []
    return [ProjectResponse(**_normalize_row(row)) for row in rows]


@router.post("/projects", response_model=ProjectResponse, status_code=201)
@handle_api_errors("create project")
def create_project(
    payload: ProjectCreate,
    current_user: dict = Depends(get_projects_user),
    db: Client = Depends(get_supabase),
):
    """Create a project owned by the signed-in user."""
    _ensure_profile_row(db, current_user)
    row = {
        "user_id": current_user["id"],
        "name": payload.name,
        "notes": payload.notes,
        "status": payload.status,
        "completed_at": _completed_at_for_status(payload.status),
    }
    inserted = db.table("projects").insert(row).execute()
    data = getattr(inserted, "data", None) or []
    if not data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not save project. If this persists, run backend/database/migrations/create_projects.sql in the Supabase SQL Editor.",
        )
    return ProjectResponse(**_normalize_row(data[0]))


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
@handle_api_errors("update project")
def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    current_user: dict = Depends(get_projects_user),
    db: Client = Depends(get_supabase),
):
    """Update name, notes, and/or status on a project the user owns."""
    existing = _fetch_owned(db, str(project_id), current_user["id"])
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    patch = payload.model_dump(exclude_unset=True)
    if "notes" in patch and patch["notes"] == "":
        patch["notes"] = None
    if not patch:
        return ProjectResponse(**_normalize_row(existing))

    if "status" in patch:
        patch["completed_at"] = _completed_at_for_status(patch["status"])
    patch["updated_at"] = "now()"

    updated = (
        db.table("projects")
        .update(patch)
        .eq("id", str(project_id))
        .eq("user_id", current_user["id"])
        .execute()
    )
    data = getattr(updated, "data", None) or []
    if not data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not update project",
        )
    return ProjectResponse(**_normalize_row(data[0]))


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
@handle_api_errors("delete project")
def delete_project(
    project_id: UUID,
    current_user: dict = Depends(get_projects_user),
    db: Client = Depends(get_supabase),
):
    """Delete a project the user owns."""
    existing = _fetch_owned(db, str(project_id), current_user["id"])
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    db.table("projects").delete().eq("id", str(project_id)).eq("user_id", current_user["id"]).execute()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
