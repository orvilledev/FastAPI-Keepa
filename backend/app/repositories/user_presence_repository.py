"""Upsert and list user presence sessions (web + Electron)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from supabase import Client

# No heartbeat within this window → session is offline (excluded from live list).
ONLINE_GRACE_SECONDS = 90
# Activity within this window → "active"; otherwise "idle" while still online.
ACTIVE_SECONDS = 120
# Drop rows older than this on each list/upsert to keep the table small.
STALE_PURGE_SECONDS = 60 * 30


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def classify_status(last_heartbeat_at: Any, last_activity_at: Any, *, now: Optional[datetime] = None) -> str:
    """Return active | idle | offline."""
    now = now or _utcnow()
    hb = _parse_ts(last_heartbeat_at)
    act = _parse_ts(last_activity_at)
    if not hb or (now - hb).total_seconds() > ONLINE_GRACE_SECONDS:
        return "offline"
    if act and (now - act).total_seconds() <= ACTIVE_SECONDS:
        return "active"
    return "idle"


class UserPresenceRepository:
    table = "user_presence_sessions"

    def __init__(self, db: Client):
        self.db = db

    def upsert_heartbeat(
        self,
        *,
        session_id: str,
        user_id: str,
        email: Optional[str],
        display_name: Optional[str],
        client_type: str,
        ip_address: Optional[str],
        user_agent: Optional[str],
        path: Optional[str],
        is_active: bool,
    ) -> Dict[str, Any]:
        now = _utcnow()
        now_iso = now.isoformat()
        client = client_type if client_type in ("web", "electron") else "web"
        payload: Dict[str, Any] = {
            "session_id": session_id.strip()[:128],
            "user_id": str(user_id),
            "email": (email or "").strip().lower() or None,
            "display_name": (display_name or "").strip() or None,
            "client_type": client,
            "ip_address": (ip_address or "").strip()[:128] or None,
            "user_agent": (user_agent or "").strip()[:512] or None,
            "path": (path or "").strip()[:256] or None,
            "last_heartbeat_at": now_iso,
        }
        if is_active:
            payload["last_activity_at"] = now_iso

        # Preserve last_activity_at when idle by not overwriting via upsert of only heartbeat fields.
        existing = (
            self.db.table(self.table)
            .select("session_id, last_activity_at, created_at")
            .eq("session_id", payload["session_id"])
            .limit(1)
            .execute()
        )
        if existing.data:
            row = existing.data[0]
            if not is_active:
                payload["last_activity_at"] = row.get("last_activity_at") or now_iso
            payload["created_at"] = row.get("created_at") or now_iso
            self.db.table(self.table).update(payload).eq(
                "session_id", payload["session_id"]
            ).execute()
        else:
            payload["last_activity_at"] = now_iso
            payload["created_at"] = now_iso
            self.db.table(self.table).insert(payload).execute()

        self.purge_stale()
        return {
            "session_id": payload["session_id"],
            "status": classify_status(
                payload["last_heartbeat_at"],
                payload.get("last_activity_at"),
                now=now,
            ),
        }

    def delete_session(self, session_id: str, user_id: str) -> bool:
        response = (
            self.db.table(self.table)
            .delete()
            .eq("session_id", session_id.strip()[:128])
            .eq("user_id", str(user_id))
            .execute()
        )
        return bool(response.data)

    def purge_stale(self) -> None:
        cutoff = (_utcnow() - timedelta(seconds=STALE_PURGE_SECONDS)).isoformat()
        try:
            self.db.table(self.table).delete().lt("last_heartbeat_at", cutoff).execute()
        except Exception:
            pass

    def list_live_sessions(self) -> Dict[str, Any]:
        self.purge_stale()
        now = _utcnow()
        response = (
            self.db.table(self.table)
            .select("*")
            .order("last_heartbeat_at", desc=True)
            .limit(500)
            .execute()
        )
        sessions: List[Dict[str, Any]] = []
        web = electron = active = idle = 0
        for row in response.data or []:
            status = classify_status(
                row.get("last_heartbeat_at"),
                row.get("last_activity_at"),
                now=now,
            )
            if status == "offline":
                continue
            client = row.get("client_type") or "web"
            if client == "electron":
                electron += 1
            else:
                web += 1
            if status == "active":
                active += 1
            else:
                idle += 1
            sessions.append(
                {
                    "session_id": row.get("session_id"),
                    "user_id": row.get("user_id"),
                    "email": row.get("email"),
                    "display_name": row.get("display_name"),
                    "client_type": client,
                    "ip_address": row.get("ip_address"),
                    "path": row.get("path"),
                    "status": status,
                    "last_heartbeat_at": row.get("last_heartbeat_at"),
                    "last_activity_at": row.get("last_activity_at"),
                    "created_at": row.get("created_at"),
                }
            )

        return {
            "as_of": now.isoformat(),
            "online_total": web + electron,
            "web_count": web,
            "electron_count": electron,
            "active_count": active,
            "idle_count": idle,
            "online_grace_seconds": ONLINE_GRACE_SECONDS,
            "active_seconds": ACTIVE_SECONDS,
            "sessions": sessions,
        }
