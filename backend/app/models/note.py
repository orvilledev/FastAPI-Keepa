"""Pydantic models for Notes."""
from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime
from uuid import UUID
from passlib.context import CryptContext

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class NoteCreate(BaseModel):
    """Model for creating a note."""
    title: str
    content: str
    category: Optional[str] = None
    color: Optional[str] = "yellow"
    importance: Optional[str] = "normal"
    is_protected: Optional[bool] = False
    password: Optional[str] = None  # Plain password, will be hashed before storage
    require_password_always: Optional[bool] = False  # If True, requires password even for owner
    
    @field_validator('password')
    @classmethod
    def validate_password(cls, v: Optional[str]) -> Optional[str]:
        """Validate password: must be at least 7 characters if provided."""
        if v is not None and len(v) < 7:
            raise ValueError('Password must be at least 7 characters long')
        return v


class NoteUpdate(BaseModel):
    """Model for updating a note."""
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    color: Optional[str] = None
    importance: Optional[str] = None
    is_protected: Optional[bool] = None
    password: Optional[str] = None  # Plain password, will be hashed before storage
    remove_password: Optional[bool] = False  # Set to True to remove password protection
    require_password_always: Optional[bool] = None  # If True, requires password even for owner
    
    @field_validator('password')
    @classmethod
    def validate_password(cls, v: Optional[str]) -> Optional[str]:
        """Validate password: must be at least 7 characters if provided."""
        if v is not None and len(v) < 7:
            raise ValueError('Password must be at least 7 characters long')
        return v


class NoteResponse(BaseModel):
    """Model for note response."""
    id: UUID
    user_id: UUID
    title: str
    content: str
    category: Optional[str] = None
    color: Optional[str] = "yellow"
    importance: Optional[str] = "normal"
    is_protected: Optional[bool] = False
    has_password: Optional[bool] = False  # Indicates if note has password protection (not the hash itself)
    require_password_always: Optional[bool] = False  # If True, requires password even for owner
    position: Optional[int] = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class NoteReorder(BaseModel):
    """Model for reordering notes."""
    note_ids: List[UUID]  # List of note IDs in the desired order


class NotePasswordVerify(BaseModel):
    """Model for verifying note password."""
    password: str

