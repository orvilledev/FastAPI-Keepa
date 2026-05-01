"""Repository for Notes database operations."""
from typing import List, Optional
from supabase import Client
from fastapi import HTTPException
import logging
from uuid import UUID
from passlib.context import CryptContext
import hashlib

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
    
    def _sanitize_note_row(
        self, note: dict, access_type: str = "owner", shared_permission: Optional[str] = None
    ) -> dict:
        """Strip secrets and attach access markers for API responses."""
        note_dict = dict(note)
        note_dict["has_password"] = bool(note_dict.get("password_hash"))
        if "password_hash" in note_dict:
            del note_dict["password_hash"]
        if "position" not in note_dict or note_dict["position"] is None:
            note_dict["position"] = 0
        note_dict["access_type"] = access_type
        note_dict["shared_permission"] = shared_permission if access_type == "shared" else None
        return note_dict

    def _note_matches_search_category(
        self, note: dict, search: Optional[str], category: Optional[str]
    ) -> bool:
        if category and category.strip():
            if (note.get("category") or "").strip() != category.strip():
                return False
        if search and search.strip():
            search_lower = search.strip().lower()
            if search_lower not in note.get("title", "").lower() and search_lower not in note.get(
                "content", ""
            ).lower():
                return False
        return True

    def _sort_notes_created_desc(self, notes: List[dict]) -> List[dict]:
        """Sort newest first."""

        def _key(row: dict) -> str:
            return str(row.get("created_at") or "")

        return sorted(notes, key=_key, reverse=True)

    def get_note_access(self, note_id: UUID, user_id: UUID) -> dict:
        """Return access flags or 404 when user cannot access the note."""
        row_resp = (
            self.db.table(self.table)
            .select("user_id")
            .eq("id", str(note_id))
            .limit(1)
            .execute()
        )
        if not row_resp.data:
            raise HTTPException(status_code=404, detail="Note not found")
        owner_id_str = str(row_resp.data[0]["user_id"])
        if owner_id_str == str(user_id):
            return {"is_owner": True, "can_view": True, "can_edit": True, "shared_permission": None}

        share_resp = (
            self.db.table("note_shares")
            .select("permission")
            .eq("note_id", str(note_id))
            .eq("shared_with_user_id", str(user_id))
            .limit(1)
            .execute()
        )
        if not share_resp.data:
            raise HTTPException(status_code=404, detail="Note not found")

        permission = share_resp.data[0]["permission"]
        return {
            "is_owner": False,
            "can_view": True,
            "can_edit": permission == "edit",
            "shared_permission": permission,
        }

    def _list_my_notes_filtered(
        self, user_id: UUID, search: Optional[str], category: Optional[str]
    ) -> List[dict]:
        """All notes owned by user (possibly filtered client-side like existing search semantics)."""
        query = self.db.table(self.table).select("*").eq("user_id", str(user_id))
        if search and search.strip():
            search_term = f"%{search.strip()}%"
            query = query.ilike("title", search_term)
        if category and category.strip():
            query = query.eq("category", category.strip())

        try:
            response = (
                query.order("position", desc=False).order("created_at", desc=True).execute()
            )
        except Exception as e:
            self.logger.warning(
                "Position column may not exist, falling back to created_at ordering: %s",
                str(e),
            )
            try:
                response = query.order("created_at", desc=True).execute()
            except Exception as e2:
                self.logger.error("Error ordering notes: %s", str(e2))
                response = query.execute()

        if search and search.strip():
            search_lower = search.strip().lower()
            response.data = [
                note
                for note in (response.data or [])
                if search_lower in note.get("title", "").lower()
                or search_lower in note.get("content", "").lower()
            ]

        notes_list: List[dict] = []
        for note in response.data or []:
            notes_list.append(self._sanitize_note_row(note, "owner", None))
        return self._sort_notes_created_desc(notes_list)

    def _list_shared_notes_filtered(
        self, user_id: UUID, search: Optional[str], category: Optional[str]
    ) -> List[dict]:
        """Notes granted via note_shares for the current user."""
        shr = (
            self.db.table("note_shares")
            .select("note_id, permission")
            .eq("shared_with_user_id", str(user_id))
            .execute()
        )
        share_rows = shr.data or []
        if not share_rows:
            return []

        perm_by_id: dict[str, str] = {
            str(r["note_id"]): r["permission"] for r in share_rows if r.get("note_id")
        }
        note_ids = list(perm_by_id.keys())
        merged: List[dict] = []
        chunk_size = 75
        for i in range(0, len(note_ids), chunk_size):
            chunk = note_ids[i : i + chunk_size]
            fetched = (
                self.db.table(self.table)
                .select("*")
                .in_("id", chunk)
                .execute()
            )
            for n in fetched.data or []:
                nd = dict(n)
                nid = str(nd["id"])
                perm = perm_by_id.get(nid, "view")
                if not self._note_matches_search_category(nd, search, category):
                    continue
                merged.append(self._sanitize_note_row(nd, "shared", perm))

        return self._sort_notes_created_desc(merged)

    def list_notes(
        self,
        user_id: UUID,
        limit: int = 100,
        offset: int = 0,
        search: Optional[str] = None,
        category: Optional[str] = None,
        scope: str = "my",
    ) -> List[dict]:
        """List notes with pagination; scope my | shared | all."""
        scope = (scope or "my").strip().lower()
        if scope not in {"my", "shared", "all"}:
            raise HTTPException(status_code=400, detail="scope must be 'my', 'shared', or 'all'")

        if scope == "shared":
            all_shared = self._list_shared_notes_filtered(user_id, search, category)
            return all_shared[offset : offset + limit]

        if scope == "all":
            owned = self._list_my_notes_filtered(user_id, search, category)
            shared = self._list_shared_notes_filtered(user_id, search, category)
            merged: dict = {}
            for n in owned:
                merged[str(n["id"])] = n
            for n in shared:
                if str(n["id"]) not in merged:
                    merged[str(n["id"])] = n
            combined_sorted = self._sort_notes_created_desc(list(merged.values()))
            return combined_sorted[offset : offset + limit]

        # scope == "my" — keep DB-side pagination behavior (matches pre-sharing semantics)
        query = self.db.table(self.table).select("*").eq("user_id", str(user_id))

        if search and search.strip():
            search_term = f"%{search.strip()}%"
            query = query.ilike("title", search_term)

        if category and category.strip():
            query = query.eq("category", category.strip())

        try:
            response = (
                query.order("position", desc=False)
                .order("created_at", desc=True)
                .range(offset, offset + limit - 1)
                .execute()
            )
        except Exception as e:
            self.logger.warning(
                "Position column may not exist, falling back to created_at ordering: %s", str(e)
            )
            try:
                response = (
                    query.order("created_at", desc=True)
                    .range(offset, offset + limit - 1)
                    .execute()
                )
            except Exception as e2:
                self.logger.error(f"Error ordering notes: {str(e2)}")
                response = query.range(offset, offset + limit - 1).execute()

        if search and search.strip():
            search_lower = search.strip().lower()
            response.data = [
                note
                for note in (response.data or [])
                if search_lower in note.get("title", "").lower()
                or search_lower in note.get("content", "").lower()
            ]

        return [self._sanitize_note_row(dict(note), "owner", None) for note in response.data or []]

    def get_notes_count(
        self,
        user_id: UUID,
        search: Optional[str] = None,
        category: Optional[str] = None,
        scope: str = "my",
    ) -> int:
        """Count notes for list pagination."""
        scope = (scope or "my").strip().lower()
        if scope not in {"my", "shared", "all"}:
            raise HTTPException(status_code=400, detail="scope must be 'my', 'shared', or 'all'")

        if scope == "shared":
            return len(self._list_shared_notes_filtered(user_id, search, category))

        if scope == "all":
            owned = self._list_my_notes_filtered(user_id, search, category)
            shared = self._list_shared_notes_filtered(user_id, search, category)
            merged_ids = set()
            for n in owned:
                merged_ids.add(str(n["id"]))
            for n in shared:
                merged_ids.add(str(n["id"]))
            return len(merged_ids)

        query = self.db.table(self.table).select("id", count="exact").eq("user_id", str(user_id))
        if category and category.strip():
            query = query.eq("category", category.strip())

        if search and search.strip():
            all_notes_query = self.db.table(self.table).select("*").eq("user_id", str(user_id))
            if category and category.strip():
                all_notes_query = all_notes_query.eq("category", category.strip())
            all_notes = all_notes_query.execute()
            search_lower = search.strip().lower()
            filtered = [
                note
                for note in (all_notes.data or [])
                if search_lower in note.get("title", "").lower()
                or search_lower in note.get("content", "").lower()
            ]
            return len(filtered)

        response = query.limit(0).execute()
        return response.count if hasattr(response, "count") else len(response.data)

    def get_note_by_id(self, note_id: UUID, user_id: UUID) -> dict:
        """Get one note when current user owns it or it is shared with them."""
        access = self.get_note_access(note_id, user_id)

        row = (
            self.db.table(self.table)
            .select("*")
            .eq("id", str(note_id))
            .limit(1)
            .execute()
        )
        if not row.data:
            raise HTTPException(status_code=404, detail="Note not found")
        note = row.data[0]

        if access["is_owner"]:
            return self._sanitize_note_row(dict(note), "owner", None)
        return self._sanitize_note_row(dict(note), "shared", access["shared_permission"])
    
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
            return self._sanitize_note_row(dict(response.data[0]), "owner", None)
        except Exception as e:
            self.logger.error(f"Error creating note: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to create note: {str(e)}")
    
    def update_note(self, note_id: UUID, user_id: UUID, title: Optional[str] = None, content: Optional[str] = None, category: Optional[str] = None, color: Optional[str] = None, importance: Optional[str] = None, is_protected: Optional[bool] = None, password: Optional[str] = None, remove_password: bool = False, require_password_always: Optional[bool] = None) -> dict:
        """Update a note (owner or shared collaborator with edit permission)."""
        access = self.get_note_access(note_id, user_id)

        if not access["is_owner"]:
            if (
                password is not None
                or remove_password
                or is_protected is not None
                or require_password_always is not None
            ):
                raise HTTPException(
                    status_code=403,
                    detail="Shared collaborators cannot change password or protection settings",
                )

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

        if not access["can_edit"]:
            raise HTTPException(status_code=403, detail="You do not have permission to edit this note")
        
        try:
            response = (
                self.db.table(self.table)
                .update(update_data)
                .eq("id", str(note_id))
                .execute()
            )
            if not response.data:
                raise HTTPException(status_code=404, detail="Note not found")

            fetched = dict(response.data[0])
            if access["is_owner"]:
                return self._sanitize_note_row(fetched, "owner", None)
            return self._sanitize_note_row(
                fetched, "shared", access.get("shared_permission")
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.error(f"Error updating note: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to update note: {str(e)}")
    
    def verify_note_password(self, note_id: UUID, user_id: UUID, password: str) -> bool:
        """Verify password for a protected note (owner or collaborator with shared access)."""
        try:
            self.get_note_access(note_id, user_id)

            response = (
                self.db.table(self.table)
                .select("password_hash")
                .eq("id", str(note_id))
                .limit(1)
                .execute()
            )
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
        """Delete a note (owner only)."""
        access = self.get_note_access(note_id, user_id)
        if not access["is_owner"]:
            raise HTTPException(status_code=403, detail="Only the note owner can delete this note")
        try:
            self.db.table(self.table).delete().eq("id", str(note_id)).eq("user_id", str(user_id)).execute()
            return True
        except Exception as e:
            self.logger.error(f"Error deleting note: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to delete note: {str(e)}")

    def ensure_note_owner(self, note_id: UUID, user_id: UUID) -> None:
        """Ensure the note exists and belongs to the current user."""
        response = (
            self.db.table(self.table)
            .select("id")
            .eq("id", str(note_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Note not found")

    def list_note_shares(self, note_id: UUID, user_id: UUID) -> List[dict]:
        """List all users a note is shared with (owner only)."""
        self.ensure_note_owner(note_id, user_id)

        shares_response = (
            self.db.table("note_shares")
            .select("shared_with_user_id, permission, created_at")
            .eq("note_id", str(note_id))
            .order("created_at", desc=False)
            .execute()
        )
        shares = shares_response.data or []
        if not shares:
            return []

        shared_user_ids = [row["shared_with_user_id"] for row in shares]
        profiles_response = (
            self.db.table("profiles")
            .select("id, email, display_name")
            .in_("id", shared_user_ids)
            .execute()
        )
        profiles = {row["id"]: row for row in (profiles_response.data or [])}

        result = []
        for share in shares:
            user_profile = profiles.get(share["shared_with_user_id"], {})
            result.append(
                {
                    "shared_with_user_id": share["shared_with_user_id"],
                    "permission": share["permission"],
                    "created_at": share["created_at"],
                    "email": user_profile.get("email"),
                    "display_name": user_profile.get("display_name"),
                }
            )
        return result

    def share_note(self, note_id: UUID, owner_user_id: UUID, shared_with_user_id: UUID, permission: str = "view") -> dict:
        """Share a note with another user (owner only)."""
        self.ensure_note_owner(note_id, owner_user_id)
        if str(owner_user_id) == str(shared_with_user_id):
            raise HTTPException(status_code=400, detail="You cannot share a note with yourself")

        # Ensure target user exists
        target_profile = (
            self.db.table("profiles")
            .select("id")
            .eq("id", str(shared_with_user_id))
            .limit(1)
            .execute()
        )
        if not target_profile.data:
            raise HTTPException(status_code=404, detail="Target user not found")

        # Upsert-like behavior: update existing share, otherwise insert
        existing = (
            self.db.table("note_shares")
            .select("id")
            .eq("note_id", str(note_id))
            .eq("shared_with_user_id", str(shared_with_user_id))
            .limit(1)
            .execute()
        )
        if existing.data:
            share_response = (
                self.db.table("note_shares")
                .update({"permission": permission})
                .eq("note_id", str(note_id))
                .eq("shared_with_user_id", str(shared_with_user_id))
                .execute()
            )
        else:
            share_response = (
                self.db.table("note_shares")
                .insert(
                    {
                        "note_id": str(note_id),
                        "owner_user_id": str(owner_user_id),
                        "shared_with_user_id": str(shared_with_user_id),
                        "permission": permission,
                    }
                )
                .execute()
            )

        if not share_response.data:
            raise HTTPException(status_code=500, detail="Failed to share note")
        profile_response = (
            self.db.table("profiles")
            .select("email, display_name")
            .eq("id", str(shared_with_user_id))
            .limit(1)
            .execute()
        )
        profile = profile_response.data[0] if profile_response.data else {}
        share_row = share_response.data[0]
        return {
            "shared_with_user_id": share_row["shared_with_user_id"],
            "permission": share_row["permission"],
            "created_at": share_row["created_at"],
            "email": profile.get("email"),
            "display_name": profile.get("display_name"),
        }

    def revoke_note_share(self, note_id: UUID, owner_user_id: UUID, shared_with_user_id: UUID) -> None:
        """Revoke note sharing for a specific user (owner only)."""
        self.ensure_note_owner(note_id, owner_user_id)
        self.db.table("note_shares").delete().eq("note_id", str(note_id)).eq("shared_with_user_id", str(shared_with_user_id)).execute()

