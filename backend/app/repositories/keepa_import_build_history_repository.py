"""Persist Keepa Import File builds to Supabase for history and re-download."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from supabase import Client

logger = logging.getLogger(__name__)

_TABLE = "keepa_import_build_history"
BuildStatus = Literal["building", "complete", "failed", "cancelled"]

_SUMMARY_COLUMNS = (
    "id,user_id,created_by_name,category,status,upc_count,completed_upcs,"
    "progress_percent,phase,message,error,filename,created_at,"
    "updated_at,completed_at"
)

# Throttle progress writes so we don't hammer PostgREST on every UPC.
_PROGRESS_MIN_INTERVAL_SECONDS = 3.0
_last_progress_write: dict[str, float] = {}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bytea_hex(file_bytes: bytes) -> str:
    """PostgREST accepts bytea as \\x-prefixed hex in JSON payloads."""
    return "\\x" + file_bytes.hex()


def _decode_bytea(value: Any) -> Optional[bytes]:
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    if isinstance(value, str):
        raw = value.strip()
        if raw.startswith("\\x"):
            return bytes.fromhex(raw[2:])
        if raw.startswith("0x"):
            return bytes.fromhex(raw[2:])
        # Some drivers return base64 — fall back if hex fails.
        try:
            return bytes.fromhex(raw)
        except ValueError:
            import base64

            return base64.b64decode(raw)
    return None


class KeepaImportBuildHistoryRepository:
    def __init__(self, db: Client) -> None:
        self._db = db

    def create(
        self,
        build_id: str,
        user_id: str,
        category: str,
        upc_count: int,
        created_by_name: Optional[str] = None,
    ) -> None:
        row = {
            "id": build_id,
            "user_id": user_id,
            "created_by_name": created_by_name,
            "category": category,
            "status": "building",
            "upc_count": upc_count,
            "completed_upcs": 0,
            "progress_percent": 0,
            "phase": "pass1",
            "message": "Fetching buy-box data…",
            "updated_at": _utc_now_iso(),
        }
        try:
            self._db.table(_TABLE).insert(row).execute()
        except Exception as exc:
            logger.warning("Could not create keepa import build history row: %s", exc)

    def update_progress(
        self,
        build_id: str,
        *,
        phase: Optional[str] = None,
        completed_upcs: Optional[int] = None,
        progress_percent: Optional[int] = None,
        message: Optional[str] = None,
        force: bool = False,
    ) -> None:
        now = time.monotonic()
        last = _last_progress_write.get(build_id, 0.0)
        if not force and (now - last) < _PROGRESS_MIN_INTERVAL_SECONDS:
            return
        _last_progress_write[build_id] = now

        patch: dict[str, Any] = {"updated_at": _utc_now_iso()}
        if phase is not None:
            patch["phase"] = phase
        if completed_upcs is not None:
            patch["completed_upcs"] = completed_upcs
        if progress_percent is not None:
            patch["progress_percent"] = progress_percent
        if message is not None:
            patch["message"] = message
        try:
            self._db.table(_TABLE).update(patch).eq("id", build_id).eq("status", "building").execute()
        except Exception as exc:
            logger.warning("Could not update keepa import build progress: %s", exc)

    def list_building(self) -> list[dict]:
        """All rows still marked building (used to detect orphans after worker restart)."""
        try:
            resp = (
                self._db.table(_TABLE)
                .select("id,updated_at,category,progress_percent,created_by_name")
                .eq("status", "building")
                .execute()
            )
            return list(resp.data or [])
        except Exception as exc:
            logger.warning("Could not list building keepa import rows: %s", exc)
            return []

    def list_stale_building(self, *, older_than_minutes: int = 30) -> list[dict]:
        """Building rows with no updates for a while (likely orphaned after deploy)."""
        cutoff = (
            datetime.now(timezone.utc) - timedelta(minutes=max(older_than_minutes, 1))
        ).isoformat()
        try:
            resp = (
                self._db.table(_TABLE)
                .select("id,updated_at,category,progress_percent,created_by_name")
                .eq("status", "building")
                .lt("updated_at", cutoff)
                .execute()
            )
            return list(resp.data or [])
        except Exception as exc:
            logger.warning("Could not list stale keepa import builds: %s", exc)
            return []

    def complete(self, build_id: str, filename: str, file_bytes: bytes) -> None:
        _last_progress_write.pop(build_id, None)
        patch = {
            "status": "complete",
            "phase": "done",
            "progress_percent": 100,
            "message": "Ready to download",
            "filename": filename,
            "file_data": _bytea_hex(file_bytes),
            "completed_at": _utc_now_iso(),
            "updated_at": _utc_now_iso(),
        }
        try:
            self._db.table(_TABLE).update(patch).eq("id", build_id).eq("status", "building").execute()
        except Exception as exc:
            logger.exception("Could not persist completed keepa import build: %s", exc)

    def fail(self, build_id: str, error: str) -> None:
        _last_progress_write.pop(build_id, None)
        patch = {
            "status": "failed",
            "error": error,
            "message": "Build failed",
            "completed_at": _utc_now_iso(),
            "updated_at": _utc_now_iso(),
        }
        try:
            self._db.table(_TABLE).update(patch).eq("id", build_id).eq("status", "building").execute()
        except Exception as exc:
            logger.warning("Could not mark keepa import build failed: %s", exc)

    def cancel(self, build_id: str) -> None:
        _last_progress_write.pop(build_id, None)
        patch = {
            "status": "cancelled",
            "phase": "cancelled",
            "message": "Build cancelled",
            "completed_at": _utc_now_iso(),
            "updated_at": _utc_now_iso(),
        }
        try:
            self._db.table(_TABLE).update(patch).eq("id", build_id).execute()
        except Exception as exc:
            logger.warning("Could not mark keepa import build cancelled: %s", exc)

    def list_all(self, *, limit: int = 100) -> list[dict]:
        """All builds, newest first — visible to every Keepa-access user."""
        try:
            resp = (
                self._db.table(_TABLE)
                .select(_SUMMARY_COLUMNS)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return list(resp.data or [])
        except Exception as exc:
            logger.warning("Could not list keepa import build history: %s", exc)
            return []

    def list_for_user(self, user_id: str, *, limit: int = 50) -> list[dict]:
        try:
            resp = (
                self._db.table(_TABLE)
                .select(_SUMMARY_COLUMNS)
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return list(resp.data or [])
        except Exception as exc:
            logger.warning("Could not list keepa import build history: %s", exc)
            return []

    def get_by_id(self, build_id: str) -> Optional[dict]:
        try:
            resp = (
                self._db.table(_TABLE)
                .select("*")
                .eq("id", build_id)
                .limit(1)
                .execute()
            )
            if not resp.data:
                return None
            return resp.data[0]
        except Exception as exc:
            logger.warning("Could not load keepa import build history row: %s", exc)
            return None

    def get_for_user(self, build_id: str, user_id: str) -> Optional[dict]:
        row = self.get_by_id(build_id)
        if not row or row.get("user_id") != user_id:
            return None
        return row

    def get_active_for_user(self, user_id: str) -> Optional[dict]:
        """Most recent building or just-completed row for resume/download."""
        try:
            resp = (
                self._db.table(_TABLE)
                .select(_SUMMARY_COLUMNS)
                .eq("user_id", user_id)
                .in_("status", ["building", "complete"])
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if not resp.data:
                return None
            return resp.data[0]
        except Exception as exc:
            logger.warning("Could not load active keepa import build: %s", exc)
            return None

    def get_any_active_build(self) -> Optional[dict]:
        """Most recent building row across all users/vendors."""
        try:
            resp = (
                self._db.table(_TABLE)
                .select(_SUMMARY_COLUMNS)
                .eq("status", "building")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if not resp.data:
                return None
            return resp.data[0]
        except Exception as exc:
            logger.warning("Could not load global active keepa import build: %s", exc)
            return None

    def get_file_bytes(self, build_id: str) -> tuple[Optional[bytes], Optional[str]]:
        row = self.get_by_id(build_id)
        if not row or row.get("status") != "complete":
            return None, None
        return _decode_bytea(row.get("file_data")), row.get("filename")

    def delete_by_id(self, build_id: str) -> bool:
        """Remove one history row. Returns False if missing or still building."""
        row = self.get_by_id(build_id)
        if not row:
            return False
        if row.get("status") == "building":
            return False
        try:
            self._db.table(_TABLE).delete().eq("id", build_id).execute()
            _last_progress_write.pop(build_id, None)
            return True
        except Exception as exc:
            logger.warning("Could not delete keepa import build history row: %s", exc)
            return False

    def delete_finished(self) -> int:
        """Remove all completed, failed, and cancelled rows (keeps in-progress builds)."""
        try:
            resp = (
                self._db.table(_TABLE)
                .delete()
                .in_("status", ["complete", "failed", "cancelled"])
                .execute()
            )
            rows = list(resp.data or [])
            for row in rows:
                row_id = row.get("id")
                if row_id:
                    _last_progress_write.pop(str(row_id), None)
            return len(rows)
        except Exception as exc:
            logger.warning("Could not clear keepa import build history: %s", exc)
            return 0
