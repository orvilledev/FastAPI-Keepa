"""Data access for dimensioner_scans (QBOID M2 uploads)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from supabase import Client

logger = logging.getLogger(__name__)

_TABLE = "dimensioner_scans"
_MIGRATION_HINT = (
    "Run backend/database/migrations/create_dimensioner_scans.sql "
    "and add_dimensioner_scans_trash.sql in the Supabase SQL Editor."
)
_COLUMNS = (
    "id, device, barcode, length_mm, width_mm, height_mm, weight_g, "
    "shape, note, attributes, scanned_at, received_at, trashed_at"
)
# Cap bulk trash so one request cannot lock the table for too long.
_MAX_BULK = 200


class DimensionerStorageError(RuntimeError):
    """The scan could not be read or written (missing table, database down, ...)."""


def _message(exc: Exception) -> str:
    return str(exc).lower()


def _is_duplicate_error(exc: Exception) -> bool:
    message = _message(exc)
    return "23505" in message or "duplicate key" in message


def _is_missing_table_error(exc: Exception) -> bool:
    message = _message(exc)
    return _TABLE in message and (
        "does not exist" in message
        or "schema cache" in message
        or "pgrst205" in message
        or "could not find the table" in message
    )


def _is_missing_column_error(exc: Exception) -> bool:
    message = _message(exc)
    return "trashed_at" in message and (
        "does not exist" in message
        or "schema cache" in message
        or "42703" in message
        or "pgrst204" in message
    )


def _storage_error(action: str, exc: Exception) -> DimensionerStorageError:
    if _is_missing_table_error(exc):
        return DimensionerStorageError(f"The {_TABLE} table is missing. {_MIGRATION_HINT}")
    if _is_missing_column_error(exc):
        return DimensionerStorageError(
            f"The {_TABLE}.trashed_at column is missing. "
            "Run backend/database/migrations/add_dimensioner_scans_trash.sql "
            "in the Supabase SQL Editor."
        )
    return DimensionerStorageError(f"Failed to {action}: {exc}")


def _escape_like(term: str) -> str:
    """Make ``%`` / ``_`` / ``\\`` in a search term match literally."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class DimensionerScanRepository:
    def __init__(self, db: Client):
        self.db = db

    def insert(self, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Store a scan. Returns the saved row, or None when it was already stored."""
        try:
            response = self.db.table(_TABLE).insert(row).execute()
        except Exception as exc:  # postgrest raises APIError subclasses
            if _is_duplicate_error(exc):
                return None
            logger.error("Failed to insert dimensioner scan: %s", exc)
            raise _storage_error("save the scan", exc) from exc
        rows = getattr(response, "data", None) or []
        return rows[0] if rows else {}

    def list_recent(
        self,
        limit: int,
        barcode_search: Optional[str] = None,
        *,
        trashed: bool = False,
    ) -> List[Dict[str, Any]]:
        """Newest uploads first, optionally filtered to barcodes containing the term."""
        try:
            query = self.db.table(_TABLE).select(_COLUMNS)
            if trashed:
                query = query.not_.is_("trashed_at", "null")
            else:
                query = query.is_("trashed_at", "null")
            term = (barcode_search or "").strip()
            if term:
                query = query.ilike("barcode", f"%{_escape_like(term)}%")
            order_col = "trashed_at" if trashed else "received_at"
            response = query.order(order_col, desc=True).limit(limit).execute()
        except Exception as exc:
            logger.error("Failed to list dimensioner scans: %s", exc)
            raise _storage_error("load scans", exc) from exc
        return list(getattr(response, "data", None) or [])

    def trash(self, scan_id: str) -> bool:
        """Move one active scan to Trash. Returns False when it is not an active scan."""
        now = datetime.now(timezone.utc).isoformat()
        try:
            response = (
                self.db.table(_TABLE)
                .update({"trashed_at": now})
                .eq("id", scan_id)
                .is_("trashed_at", "null")
                .execute()
            )
        except Exception as exc:
            logger.error("Failed to trash dimensioner scan %s: %s", scan_id, exc)
            raise _storage_error("trash the scan", exc) from exc
        return bool(getattr(response, "data", None) or [])

    def trash_many(self, scan_ids: List[str]) -> int:
        """Move many active scans to Trash. Returns how many were moved."""
        ids = [str(item) for item in scan_ids if item][:_MAX_BULK]
        if not ids:
            return 0
        now = datetime.now(timezone.utc).isoformat()
        try:
            response = (
                self.db.table(_TABLE)
                .update({"trashed_at": now})
                .in_("id", ids)
                .is_("trashed_at", "null")
                .execute()
            )
        except Exception as exc:
            logger.error("Failed to trash dimensioner scans: %s", exc)
            raise _storage_error("trash the scans", exc) from exc
        return len(getattr(response, "data", None) or [])

    def restore(self, scan_id: str) -> bool:
        """Return one trashed scan to the active list."""
        try:
            response = (
                self.db.table(_TABLE)
                .update({"trashed_at": None})
                .eq("id", scan_id)
                .not_.is_("trashed_at", "null")
                .execute()
            )
        except Exception as exc:
            logger.error("Failed to restore dimensioner scan %s: %s", scan_id, exc)
            raise _storage_error("restore the scan", exc) from exc
        return bool(getattr(response, "data", None) or [])

    def delete(self, scan_id: str) -> bool:
        """Permanently remove one scan (used from Trash). Returns False when missing."""
        try:
            existing = (
                self.db.table(_TABLE).select("id").eq("id", scan_id).limit(1).execute()
            )
            if not (getattr(existing, "data", None) or []):
                return False
            self.db.table(_TABLE).delete().eq("id", scan_id).execute()
        except Exception as exc:
            logger.error("Failed to delete dimensioner scan %s: %s", scan_id, exc)
            raise _storage_error("delete the scan", exc) from exc
        return True

    def purge_trashed_older_than(self, retention_days: int) -> int:
        """Hard-delete trashed scans older than ``retention_days``. Returns count removed."""
        if retention_days <= 0:
            return 0
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        try:
            existing = (
                self.db.table(_TABLE)
                .select("id")
                .not_.is_("trashed_at", "null")
                .lt("trashed_at", cutoff.isoformat())
                .limit(1000)
                .execute()
            )
        except Exception as exc:
            logger.error("Failed to list expired dimensioner trash: %s", exc)
            raise _storage_error("list expired trash", exc) from exc
        ids = [str(row.get("id") or "") for row in (getattr(existing, "data", None) or []) if row.get("id")]
        if not ids:
            return 0
        try:
            self.db.table(_TABLE).delete().in_("id", ids).execute()
        except Exception as exc:
            logger.error("Failed to purge dimensioner trash: %s", exc)
            raise _storage_error("purge trash", exc) from exc
        return len(ids)
