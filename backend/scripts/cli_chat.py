#!/usr/bin/env python3
"""
Interactive terminal client for MSW Overwatch CLI chat (server-side OpenAI + Supabase memory).

Environment:
  MSW_API_BASE   API root, default http://127.0.0.1:8000
  MSW_AUTH_TOKEN Supabase JWT (same as web app). Copy from browser devtools after sign-in.

Commands inside the REPL:
  /exit /quit     Leave
  /new            Start a new session (forget current thread)
  /sessions       List recent sessions (ids + titles)
  /history        Print messages for the current session

Requires backend migration: database/migrations/create_cli_chat.sql
and server .env: OPENAI_API_KEY, plus existing Supabase + app access.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

try:
    import httpx
except ImportError:
    print("Install httpx in this environment: pip install httpx", file=sys.stderr)
    sys.exit(1)

DEFAULT_BASE = "http://127.0.0.1:8000"
SESSION_FILE = Path.home() / ".msw_cli_chat_session"


def _base() -> str:
    return (os.environ.get("MSW_API_BASE") or DEFAULT_BASE).rstrip("/")


def _token() -> str:
    t = (os.environ.get("MSW_AUTH_TOKEN") or "").strip()
    if not t:
        print(
            "Set MSW_AUTH_TOKEN to your Supabase access_token (JWT) from the web session.",
            file=sys.stderr,
        )
        sys.exit(1)
    return t


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_token()}",
        "Content-Type": "application/json",
    }


def _load_saved_session() -> Optional[str]:
    try:
        if SESSION_FILE.is_file():
            return SESSION_FILE.read_text(encoding="utf-8").strip() or None
    except OSError:
        pass
    return None


def _save_session(sid: str) -> None:
    try:
        SESSION_FILE.write_text(sid, encoding="utf-8")
    except OSError as e:
        print(f"(Could not save session id to {SESSION_FILE}: {e})", file=sys.stderr)


def _request(method: str, path: str, **kw: Any) -> httpx.Response:
    url = f"{_base()}{path}"
    with httpx.Client(timeout=120.0) as client:
        return client.request(method, url, headers=_headers(), **kw)


def main() -> None:
    api_prefix = "/api/v1"
    session_id: Optional[str] = _load_saved_session()
    print("MSW CLI chat. Type a message or /help. Ctrl+C to exit.\n")
    if session_id:
        print(f"Resuming session {session_id} (from {SESSION_FILE})\n")

    while True:
        try:
            line = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not line:
            continue
        if line in ("/exit", "/quit"):
            break
        if line == "/help":
            print(__doc__)
            continue
        if line == "/new":
            session_id = None
            try:
                SESSION_FILE.unlink(missing_ok=True)  # py3.8+ missing_ok
            except TypeError:
                if SESSION_FILE.is_file():
                    SESSION_FILE.unlink()
            print("New session on next message.\n")
            continue
        if line == "/sessions":
            r = _request("GET", f"{api_prefix}/cli-chat/sessions")
            if r.status_code != 200:
                print(f"Error {r.status_code}: {r.text[:500]}\n")
                continue
            data = r.json()
            for s in data.get("sessions") or []:
                print(f"  {s.get('id')}  {s.get('title') or ''}")
            print()
            continue
        if line == "/history":
            if not session_id:
                print("No session yet.\n")
                continue
            r = _request("GET", f"{api_prefix}/cli-chat/sessions/{session_id}/messages")
            if r.status_code != 200:
                print(f"Error {r.status_code}: {r.text[:500]}\n")
                continue
            for m in r.json().get("messages") or []:
                print(f"[{m.get('role')}] {m.get('content')}\n")
            continue

        body: dict[str, Any] = {"message": line}
        if session_id:
            body["session_id"] = session_id
        r = _request("POST", f"{api_prefix}/cli-chat/turn", content=json.dumps(body))
        if r.status_code != 200:
            print(f"Error {r.status_code}: {r.text[:800]}\n")
            continue
        out = r.json()
        session_id = out.get("session_id")
        if session_id:
            _save_session(str(session_id))
        print(f"\nassistant> {out.get('reply', '')}\n")


if __name__ == "__main__":
    main()
