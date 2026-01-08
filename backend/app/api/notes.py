"""Notes management API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from app.dependencies import get_current_user
from app.models.note import NoteResponse, NoteCreate, NoteUpdate, NotePasswordVerify, NoteReorder
from app.database import get_supabase
from app.repositories.note_repository import NoteRepository
from app.utils.error_handler import handle_api_errors
from supabase import Client
from uuid import UUID
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/notes", response_model=NoteResponse, status_code=201)
@handle_api_errors("create note")
async def create_note(
    note: NoteCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Create a new note for the current user."""
    repository = NoteRepository(db)
    user_id = UUID(current_user["id"])
    
    created_note = repository.create_note(
        user_id=user_id,
        title=note.title,
        content=note.content,
        category=note.category,
        color=note.color or "yellow",
        importance=note.importance or "normal",
        is_protected=note.is_protected or False,
        password=note.password,
        require_password_always=note.require_password_always or False
    )
    
    return NoteResponse(**created_note)


@router.get("/notes", response_model=dict)
@handle_api_errors("list notes")
async def list_notes(
    page: int = Query(0, ge=0, description="Page number (0-indexed)"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    search: Optional[str] = Query(None, description="Search term for title or content"),
    category: Optional[str] = Query(None, description="Filter by category"),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """List notes for the current user with pagination and optional search and category filter."""
    repository = NoteRepository(db)
    user_id = UUID(current_user["id"])
    
    offset = page * page_size
    
    notes = repository.list_notes(
        user_id=user_id,
        limit=page_size,
        offset=offset,
        search=search,
        category=category
    )
    
    total_count = repository.get_notes_count(user_id=user_id, search=search, category=category)
    
    try:
        note_responses = []
        for note in notes:
            # Ensure position field exists, default to 0 if not
            if "position" not in note or note["position"] is None:
                note["position"] = 0
            note_responses.append(NoteResponse(**note))
        
        return {
            "notes": note_responses,
            "total": total_count,
            "page": page,
            "page_size": page_size,
            "total_pages": (total_count + page_size - 1) // page_size if total_count > 0 else 0
        }
    except Exception as e:
        logger.error(f"Error serializing notes: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to serialize notes: {str(e)}")


@router.get("/notes/{note_id}", response_model=NoteResponse)
@handle_api_errors("get note")
async def get_note(
    note_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get a specific note by ID."""
    repository = NoteRepository(db)
    user_id = UUID(current_user["id"])
    
    note = repository.get_note_by_id(note_id=note_id, user_id=user_id)
    return NoteResponse(**note)


@router.put("/notes/{note_id}", response_model=NoteResponse)
@handle_api_errors("update note")
async def update_note(
    note_id: UUID,
    note: NoteUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Update a note."""
    repository = NoteRepository(db)
    user_id = UUID(current_user["id"])
    
    updated_note = repository.update_note(
        note_id=note_id,
        user_id=user_id,
        title=note.title,
        content=note.content,
        category=note.category,
        color=note.color,
        importance=note.importance,
        is_protected=note.is_protected,
        password=note.password,
        remove_password=note.remove_password or False,
        require_password_always=note.require_password_always
    )
    
    return NoteResponse(**updated_note)


@router.delete("/notes/{note_id}", status_code=204)
@handle_api_errors("delete note")
async def delete_note(
    note_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Delete a note."""
    repository = NoteRepository(db)
    user_id = UUID(current_user["id"])
    
    repository.delete_note(note_id=note_id, user_id=user_id)
    return None


@router.post("/notes/{note_id}/verify-password", response_model=dict)
@handle_api_errors("verify note password")
async def verify_note_password(
    note_id: UUID,
    password_data: NotePasswordVerify,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Verify password for a protected note."""
    repository = NoteRepository(db)
    user_id = UUID(current_user["id"])
    
    is_valid = repository.verify_note_password(
        note_id=note_id,
        user_id=user_id,
        password=password_data.password
    )
    
    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid password")
    
    return {"verified": True}


@router.post("/notes/reorder", response_model=dict)
@handle_api_errors("reorder notes")
async def reorder_notes(
    reorder_data: NoteReorder,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Reorder notes by providing a list of note IDs in the desired order."""
    repository = NoteRepository(db)
    user_id = UUID(current_user["id"])
    
    # Verify all notes belong to the user
    for note_id in reorder_data.note_ids:
        note = repository.get_note_by_id(note_id, user_id)
        if not note:
            raise HTTPException(status_code=404, detail=f"Note {note_id} not found")
    
    repository.reorder_notes(user_id=user_id, note_ids=reorder_data.note_ids)
    return {"message": "Notes reordered successfully"}

