"""Repository for Notes database operations."""
from typing import List, Optional
from supabase import Client
from fastapi import HTTPException
import logging
from uuid import UUID
from passlib.context import CryptContext
import hashlib
import base64

# Password hashing context
# We pre-hash all passwords with SHA-256 before passing to bcrypt
# This allows passwords of any length while staying within bcrypt's 72-byte limit
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class NoteRepository:
    """Repository for notes table operations."""
    
    def __init__(self, db: Client):
        self.db = db
        self.table = "notes"
        self.logger = logging.getLogger(__name__)
    
    def _prepare_password(self, password: str) -> str:
        """Prepare password for hashing by pre-hashing with SHA-256 to support passwords of any length."""
        # Bcrypt has a 72-byte limit, so we always pre-hash with SHA-256
        # We convert to hex string (64 chars = 64 bytes) which is within the limit
        # This ensures consistent handling regardless of original password length
        password_bytes = password.encode('utf-8')
        sha256_hash_bytes = hashlib.sha256(password_bytes).digest()  # 32 bytes
        # Convert to hex string (64 characters = 64 bytes in UTF-8)
        hex_string = sha256_hash_bytes.hex()
        return hex_string
    
    def list_notes(self, user_id: UUID, limit: int = 100, offset: int = 0, search: Optional[str] = None, category: Optional[str] = None) -> List[dict]:
        """List notes for a user with pagination and optional search."""
        query = self.db.table(self.table).select("*").eq("user_id", str(user_id))
        
        # If search term provided, filter by title or content (case-insensitive partial match)
        if search and search.strip():
            search_term = f"%{search.strip()}%"
            # Search in title (can be extended to search in content with a DB function)
            query = query.ilike("title", search_term)
        
        # Filter by category if provided
        if category and category.strip():
            query = query.eq("category", category.strip())
        
        # Order by position first, then by created_at
        # If position column doesn't exist yet, this will fall back to created_at ordering
        try:
            # Try to order by position, but if column doesn't exist, fall back
            response = query.order("position", desc=False).order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        except Exception as e:
            # Fallback if position column doesn't exist (migration not run yet)
            self.logger.warning(f"Position column may not exist, falling back to created_at ordering: {str(e)}")
            try:
                response = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
            except Exception as e2:
                # If that also fails, try without ordering
                self.logger.error(f"Error ordering notes: {str(e2)}")
                response = query.range(offset, offset + limit - 1).execute()
        
        # If search provided, also filter by content in the results (client-side for OR logic)
        if search and search.strip():
            search_lower = search.strip().lower()
            response.data = [
                note for note in response.data
                if search_lower in note.get("title", "").lower() or search_lower in note.get("content", "").lower()
            ]
        
        # Don't return password hashes, but indicate if password exists
        # Also ensure position field exists
        notes_list = []
        for note in response.data:
            # Create a copy to avoid modifying the original
            note_dict = dict(note)
            note_dict["has_password"] = bool(note_dict.get("password_hash"))
            if "password_hash" in note_dict:
                del note_dict["password_hash"]
            # Ensure position field exists, default to 0 if not
            if "position" not in note_dict or note_dict["position"] is None:
                note_dict["position"] = 0
            notes_list.append(note_dict)
        
        return notes_list
    
    def get_notes_count(self, user_id: UUID, search: Optional[str] = None, category: Optional[str] = None) -> int:
        """Get count of notes for a user matching search criteria."""
        query = self.db.table(self.table).select("id", count="exact").eq("user_id", str(user_id))
        
        # Filter by category if provided
        if category and category.strip():
            query = query.eq("category", category.strip())
        
        # For search, we need to get all notes and filter client-side for accurate count
        # This is less efficient but necessary for OR conditions with Supabase
        if search and search.strip():
            # Get all user notes and filter
            all_notes_query = self.db.table(self.table).select("*").eq("user_id", str(user_id))
            if category and category.strip():
                all_notes_query = all_notes_query.eq("category", category.strip())
            all_notes = all_notes_query.execute()
            search_lower = search.strip().lower()
            filtered = [
                note for note in all_notes.data
                if search_lower in note.get("title", "").lower() or search_lower in note.get("content", "").lower()
            ]
            return len(filtered)
        else:
            response = query.limit(0).execute()
            return response.count if hasattr(response, 'count') else len(response.data)
    
    def get_note_by_id(self, note_id: UUID, user_id: UUID) -> dict:
        """Get a note by ID, ensuring it belongs to the user."""
        response = self.db.table(self.table).select("*").eq("id", str(note_id)).eq("user_id", str(user_id)).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Note not found")
        note = response.data[0]
        # Don't return the password hash
        note["has_password"] = bool(note.get("password_hash"))
        if "password_hash" in note:
            del note["password_hash"]
        return note
    
    def create_note(self, user_id: UUID, title: str, content: str, category: Optional[str] = None, color: Optional[str] = "yellow", importance: str = "normal", is_protected: bool = False, password: Optional[str] = None, require_password_always: bool = False, position: Optional[int] = None) -> dict:
        """Create a new note."""
        try:
            # If position not provided, set it to the maximum position + 1 for this user
            if position is None:
                max_position_response = self.db.table(self.table).select("position").eq("user_id", str(user_id)).order("position", desc=True).limit(1).execute()
                if max_position_response.data and max_position_response.data[0].get("position") is not None:
                    position = max_position_response.data[0]["position"] + 1
                else:
                    position = 0
            
            note_data = {
                "user_id": str(user_id),
                "title": title,
                "content": content,
                "importance": importance,
                "color": color or "yellow",
                "is_protected": is_protected,
                "require_password_always": require_password_always,
                "position": position
            }
            if category:
                note_data["category"] = category
            if password:
                # Always pre-hash with SHA-256 to support passwords of any length
                # This ensures we never hit bcrypt's 72-byte limit
                prepared_password = self._prepare_password(password)  # Returns hex string (64 bytes)
                # Verify it's within limits (should always be 64 bytes)
                prepared_bytes = len(prepared_password.encode('utf-8'))
                if prepared_bytes > 72:
                    self.logger.error(f"Prepared password too long: {prepared_bytes} bytes")
                    raise HTTPException(status_code=500, detail="Password processing failed")
                try:
                    note_data["password_hash"] = pwd_context.hash(prepared_password)
                except Exception as e:
                    # Log the full error for debugging
                    error_str = str(e)
                    self.logger.error(f"Password hashing error: {error_str}, type: {type(e).__name__}, prepared_len: {prepared_bytes} bytes")
                    # Check if it's the 72-byte error
                    error_msg = error_str.lower()
                    if '72' in error_msg or 'byte' in error_msg or 'truncate' in error_msg:
                        raise HTTPException(
                            status_code=400, 
                            detail="Password processing error. Please try a different password or contact support."
                        )
                    raise HTTPException(status_code=400, detail=f"Password processing error: {error_str}")
            response = self.db.table(self.table).insert(note_data).execute()
            if not response.data:
                raise HTTPException(status_code=500, detail="Failed to create note")
            # Don't return the password hash
            note = response.data[0]
            note["has_password"] = bool(note.get("password_hash"))
            if "password_hash" in note:
                del note["password_hash"]
            return note
        except Exception as e:
            self.logger.error(f"Error creating note: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to create note: {str(e)}")
    
    def update_note(self, note_id: UUID, user_id: UUID, title: Optional[str] = None, content: Optional[str] = None, category: Optional[str] = None, color: Optional[str] = None, importance: Optional[str] = None, is_protected: Optional[bool] = None, password: Optional[str] = None, remove_password: bool = False, require_password_always: Optional[bool] = None) -> dict:
        """Update a note."""
        update_data = {}
        if title is not None:
            update_data["title"] = title
        if content is not None:
            update_data["content"] = content
        if category is not None:
            update_data["category"] = category if category.strip() else None
        if color is not None:
            update_data["color"] = color
        if importance is not None:
            update_data["importance"] = importance
        if is_protected is not None:
            update_data["is_protected"] = is_protected
        if require_password_always is not None:
            update_data["require_password_always"] = require_password_always
        if remove_password:
            update_data["password_hash"] = None
        elif password:
            # Always pre-hash with SHA-256 to support passwords of any length
            # This ensures we never hit bcrypt's 72-byte limit
            prepared_password = self._prepare_password(password)  # Returns hex string (64 bytes)
            # Verify it's within limits (should always be 64 bytes)
            prepared_bytes = len(prepared_password.encode('utf-8'))
            if prepared_bytes > 72:
                self.logger.error(f"Prepared password too long: {prepared_bytes} bytes")
                raise HTTPException(status_code=500, detail="Password processing failed")
            try:
                update_data["password_hash"] = pwd_context.hash(prepared_password)
            except Exception as e:
                # Log the full error for debugging
                error_str = str(e)
                self.logger.error(f"Password hashing error: {error_str}, type: {type(e).__name__}, prepared_len: {prepared_bytes} bytes")
                # Check if it's the 72-byte error
                error_msg = error_str.lower()
                if '72' in error_msg or 'byte' in error_msg or 'truncate' in error_msg:
                    raise HTTPException(
                        status_code=400, 
                        detail="Password processing error. Please try a different password or contact support."
                    )
                raise HTTPException(status_code=400, detail=f"Password processing error: {error_str}")
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        try:
            response = self.db.table(self.table).update(update_data).eq("id", str(note_id)).eq("user_id", str(user_id)).execute()
            if not response.data:
                raise HTTPException(status_code=404, detail="Note not found")
            # Don't return the password hash
            note = response.data[0]
            note["has_password"] = bool(note.get("password_hash"))
            if "password_hash" in note:
                del note["password_hash"]
            return note
        except Exception as e:
            self.logger.error(f"Error updating note: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to update note: {str(e)}")
    
    def verify_note_password(self, note_id: UUID, user_id: UUID, password: str) -> bool:
        """Verify password for a protected note."""
        try:
            response = self.db.table(self.table).select("password_hash").eq("id", str(note_id)).eq("user_id", str(user_id)).execute()
            if not response.data or not response.data[0].get("password_hash"):
                return False
            password_hash = response.data[0]["password_hash"]
            # Prepare password the same way as when storing (pre-hash with SHA-256)
            prepared_password = self._prepare_password(password)  # Returns hex string (64 bytes)
            return pwd_context.verify(prepared_password, password_hash)
        except Exception as e:
            self.logger.error(f"Error verifying password: {str(e)}")
            return False
    
    def reorder_notes(self, user_id: UUID, note_ids: List[UUID]) -> None:
        """Reorder notes by updating their positions."""
        try:
            for index, note_id in enumerate(note_ids):
                self.db.table(self.table).update({"position": index}).eq("id", str(note_id)).eq("user_id", str(user_id)).execute()
        except Exception as e:
            self.logger.error(f"Error reordering notes: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to reorder notes: {str(e)}")
    
    def delete_note(self, note_id: UUID, user_id: UUID) -> bool:
        """Delete a note."""
        try:
            response = self.db.table(self.table).delete().eq("id", str(note_id)).eq("user_id", str(user_id)).execute()
            return True
        except Exception as e:
            self.logger.error(f"Error deleting note: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to delete note: {str(e)}")

