"""Team Chat API: user-to-user messaging (1:1 and group conversations)."""
import logging
from contextlib import contextmanager
from datetime import datetime
from typing import Iterator, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_current_user
from app.repositories.messenger_repository import (
    MessengerFileStore,
    MessengerRepository,
    MessengerStorageError,
)
from app.services.messenger import (
    MAX_FILE_NAME_LENGTH,
    MAX_GROUP_MEMBERS,
    MAX_MESSAGE_LENGTH,
    MAX_TITLE_LENGTH,
    MessengerError,
    MessengerService,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/messenger")


class ConversationCreateBody(BaseModel):
    member_ids: List[UUID] = Field(..., min_length=1, max_length=MAX_GROUP_MEMBERS)
    title: Optional[str] = Field(default=None, max_length=MAX_TITLE_LENGTH * 2)


class AttachmentRef(BaseModel):
    path: str = Field(..., min_length=1, max_length=300)
    name: str = Field(..., min_length=1, max_length=MAX_FILE_NAME_LENGTH * 4)
    mime_type: Optional[str] = Field(default=None, max_length=200)


class MessageCreateBody(BaseModel):
    # Allow surrounding whitespace past the limit; the service trims then enforces it.
    body: str = Field(default="", max_length=MAX_MESSAGE_LENGTH + 500)
    attachment: Optional[AttachmentRef] = None


class UploadRequestBody(BaseModel):
    file_name: str = Field(..., min_length=1, max_length=MAX_FILE_NAME_LENGTH * 4)
    size: int = Field(..., ge=0)


class DiscardUploadBody(BaseModel):
    path: str = Field(..., min_length=1, max_length=300)


def _service(db: Client) -> MessengerService:
    return MessengerService(MessengerRepository(db), MessengerFileStore())


@contextmanager
def _errors(action: str) -> Iterator[None]:
    try:
        yield
    except HTTPException:
        raise
    except MessengerError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except MessengerStorageError as exc:
        code = (
            status.HTTP_503_SERVICE_UNAVAILABLE
            if exc.missing_tables
            else status.HTTP_500_INTERNAL_SERVER_ERROR
        )
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Team Chat: failed to %s: %s", action, exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to {action}",
        ) from exc


@router.get("/users")
def list_chat_users(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """People the signed-in user can start a chat with."""
    with _errors("load people"):
        return {"users": _service(db).list_directory(current_user["id"])}


@router.get("/unread-count")
def chat_unread_count(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    with _errors("count unread messages"):
        return {"count": _service(db).total_unread(current_user["id"])}


@router.get("/conversations")
def list_conversations(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    with _errors("load conversations"):
        return {"conversations": _service(db).list_conversations(current_user["id"])}


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
def create_conversation(
    payload: ConversationCreateBody,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Open (or reuse) a 1:1 chat with one person, or create a group with several."""
    with _errors("start the conversation"):
        return _service(db).create_conversation(
            current_user["id"],
            [str(uid) for uid in payload.member_ids],
            payload.title,
        )


@router.get("/conversations/{conversation_id}")
def get_conversation(
    conversation_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    with _errors("load the conversation"):
        return _service(db).get_conversation(str(conversation_id), current_user["id"])


@router.get("/conversations/{conversation_id}/messages")
def list_messages(
    conversation_id: UUID,
    limit: int = Query(50, ge=1, le=100),
    before: Optional[datetime] = Query(None),
    after: Optional[datetime] = Query(None),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Messages oldest to newest. ``before`` pages back in history; ``after`` fetches new ones."""
    if before and after:
        raise HTTPException(status_code=422, detail="Use either before or after, not both.")
    with _errors("load messages"):
        return _service(db).list_messages(
            str(conversation_id),
            current_user["id"],
            limit=limit,
            before=before,
            after=after,
        )


@router.post("/conversations/{conversation_id}/messages", status_code=status.HTTP_201_CREATED)
def send_message(
    conversation_id: UUID,
    payload: MessageCreateBody,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    with _errors("send the message"):
        return _service(db).send_message(
            str(conversation_id),
            current_user["id"],
            payload.body,
            payload.attachment.model_dump() if payload.attachment else None,
        )


@router.post("/conversations/{conversation_id}/attachments", status_code=status.HTTP_201_CREATED)
def request_upload(
    conversation_id: UUID,
    payload: UploadRequestBody,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """One-time link for the browser to upload a file straight to storage before sending it."""
    with _errors("prepare the upload"):
        return _service(db).prepare_upload(
            str(conversation_id),
            current_user["id"],
            file_name=payload.file_name,
            size=payload.size,
        )


@router.post("/conversations/{conversation_id}/attachments/discard")
def discard_upload(
    conversation_id: UUID,
    payload: DiscardUploadBody,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    with _errors("discard the upload"):
        _service(db).discard_upload(str(conversation_id), current_user["id"], payload.path)
        return {"discarded": True}


@router.get("/messages/{message_id}/attachment")
def attachment_link(
    message_id: UUID,
    download: bool = Query(False),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Short-lived link to view (or, with ``download``, save) a shared file."""
    with _errors("open the file"):
        return _service(db).attachment_link(str(message_id), current_user["id"], download=download)


@router.post("/conversations/{conversation_id}/read")
def mark_conversation_read(
    conversation_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    with _errors("mark the conversation as read"):
        return _service(db).mark_read(str(conversation_id), current_user["id"])


@router.post("/conversations/{conversation_id}/leave")
def leave_conversation(
    conversation_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    with _errors("leave the conversation"):
        _service(db).leave_conversation(str(conversation_id), current_user["id"])
        return {"left": True}


@router.delete("/messages/{message_id}")
def unsend_message(
    message_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    with _errors("unsend the message"):
        return _service(db).unsend_message(str(message_id), current_user["id"])
