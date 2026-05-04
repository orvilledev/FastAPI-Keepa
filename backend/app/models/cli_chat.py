"""Pydantic models for CLI chat API."""
from pydantic import BaseModel, Field
from typing import List, Optional
from uuid import UUID


class CliChatTurnRequest(BaseModel):
    """Send one user message; optional existing session for memory."""

    session_id: Optional[UUID] = None
    message: str = Field(..., min_length=1, max_length=32000)


class CliChatTurnResponse(BaseModel):
    """Assistant reply and session id for follow-up turns."""

    session_id: UUID
    reply: str


class CliChatMessageOut(BaseModel):
    id: UUID
    role: str
    content: str
    created_at: str


class CliChatSessionOut(BaseModel):
    id: UUID
    title: Optional[str]
    created_at: str
    updated_at: str


class CliChatSessionListResponse(BaseModel):
    sessions: List[CliChatSessionOut]


class CliChatHistoryResponse(BaseModel):
    session_id: UUID
    messages: List[CliChatMessageOut]
