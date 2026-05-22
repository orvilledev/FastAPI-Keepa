"""CLI chat: OpenAI-backed turns with Supabase session memory."""
import asyncio
from datetime import datetime, timezone
from typing import Any, List
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from supabase import Client

from app.config import settings
from app.database import get_supabase
from app.dependencies import get_current_user
from app.middleware.rate_limiter import limiter, RateLimits
from app.models.cli_chat import (
    CliChatHistoryResponse,
    CliChatMessageOut,
    CliChatSessionListResponse,
    CliChatSessionOut,
    CliChatTurnRequest,
    CliChatTurnResponse,
)
from app.utils.error_handler import handle_api_errors

router = APIRouter()

SYSTEM_PROMPT = (
    "You are a helpful assistant for MSW Overwatch (Keepa inventory, jobs, reports). "
    "Be concise unless the user asks for detail."
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_session_owned(
    db: Client, user_id: str, session_id: UUID
) -> dict:
    r = (
        db.table("chat_sessions")
        .select("id, user_id, title")
        .eq("id", str(session_id))
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat session not found",
        )
    return r.data[0]


async def _openai_chat(messages: List[dict[str, str]]) -> str:
    key = (settings.openai_api_key or "").strip()
    if not key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Chat is not configured: set OPENAI_API_KEY on the server.",
        )
    model = (settings.cli_chat_model or "gpt-4o-mini").strip()
    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 2048,
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code != 200:
        err = resp.text[:500]
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenAI error ({resp.status_code}): {err}",
        )
    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OpenAI returned no choices",
        )
    msg = (choices[0].get("message") or {}).get("content")
    if not msg or not isinstance(msg, str):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OpenAI returned empty content",
        )
    return msg.strip()


@router.post("/cli-chat/turn", response_model=CliChatTurnResponse)
@limiter.limit(RateLimits.CHAT_TURN)
@handle_api_errors("cli chat turn")
async def cli_chat_turn(
    request: Request,
    body: CliChatTurnRequest,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """One user message → persisted history → OpenAI reply (same session = memory)."""
    user_id = current_user["id"]
    limit = max(1, min(settings.cli_chat_history_limit, 100))

    if body.session_id:
        await asyncio.to_thread(_ensure_session_owned, db, user_id, body.session_id)
        session_id = body.session_id
    else:
        title = (body.message.strip()[:120] or "Chat").replace("\n", " ")
        ins = await asyncio.to_thread(
            lambda: db.table("chat_sessions")
            .insert(
                {
                    "user_id": user_id,
                    "title": title,
                    "created_at": _now_iso(),
                    "updated_at": _now_iso(),
                }
            )
            .execute()
        )
        if not ins.data:
            raise HTTPException(
                status_code=500, detail="Failed to create chat session"
            )
        session_id = UUID(ins.data[0]["id"])

    hist = await asyncio.to_thread(
        lambda: db.table("chat_messages")
        .select("role, content, created_at")
        .eq("session_id", str(session_id))
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows: List[dict[str, Any]] = list(reversed(hist.data or []))

    await asyncio.to_thread(
        lambda: db.table("chat_messages").insert(
            {
                "session_id": str(session_id),
                "role": "user",
                "content": body.message.strip(),
                "created_at": _now_iso(),
            }
        ).execute()
    )

    openai_messages: List[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for row in rows:
        r, c = row.get("role"), row.get("content")
        if r in ("user", "assistant", "system") and c:
            openai_messages.append({"role": r, "content": c})
    openai_messages.append({"role": "user", "content": body.message.strip()})

    reply = await _openai_chat(openai_messages)

    await asyncio.to_thread(
        lambda: db.table("chat_messages").insert(
            {
                "session_id": str(session_id),
                "role": "assistant",
                "content": reply,
                "created_at": _now_iso(),
            }
        ).execute()
    )

    await asyncio.to_thread(
        lambda: db.table("chat_sessions").update({"updated_at": _now_iso()}).eq(
            "id", str(session_id)
        ).execute()
    )

    return CliChatTurnResponse(session_id=session_id, reply=reply)


@router.get("/cli-chat/sessions", response_model=CliChatSessionListResponse)
@handle_api_errors("list cli chat sessions")
def list_cli_chat_sessions(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
    limit: int = 50,
):
    lim = max(1, min(limit, 100))
    r = (
        db.table("chat_sessions")
        .select("id, title, created_at, updated_at")
        .eq("user_id", current_user["id"])
        .order("updated_at", desc=True)
        .limit(lim)
        .execute()
    )
    sessions = [
        CliChatSessionOut(
            id=UUID(row["id"]),
            title=row.get("title"),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )
        for row in (r.data or [])
    ]
    return CliChatSessionListResponse(sessions=sessions)


@router.get("/cli-chat/sessions/{session_id}/messages", response_model=CliChatHistoryResponse)
@handle_api_errors("get cli chat history")
def get_cli_chat_history(
    session_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    _ensure_session_owned(db, current_user["id"], session_id)
    r = (
        db.table("chat_messages")
        .select("id, role, content, created_at")
        .eq("session_id", str(session_id))
        .order("created_at", desc=False)
        .execute()
    )
    messages = [
        CliChatMessageOut(
            id=UUID(row["id"]),
            role=row["role"],
            content=row["content"],
            created_at=str(row["created_at"]),
        )
        for row in (r.data or [])
    ]
    return CliChatHistoryResponse(session_id=session_id, messages=messages)
