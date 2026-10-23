"""Data access for dimensioner_scans (QBOID M2 uploads)."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from supabase import Client

logger = logging.getLogger(__name__)

_TABLE = "dimensioner_scans"
_MIGRATION_HINT = (
    "Run backend/database/migrations/create_dimensioner_scans.sql "
    "in the Supabase SQL Editor."
)
_COLUMNS = (
    "id, device, barcode, length_mm, width_mm, height_mm, weight_g, "
    "shape, note, attributes, scanned_at, received_at"
)


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


def _storage_error(action: str, exc: Exception) -> DimensionerStorageError:
    if _is_missing_table_error(exc):
        return DimensionerStorageError(f"The {_TABLE} table is missing. {_MIGRATION_HINT}")
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

    def list_recent(self, limit: int, barcode_search: Optional[str] = None) -> List[Dict[str, Any]]:
        """Newest uploads first, optionally filtered to barcodes containing the term."""
        try:
            query = self.db.table(_TABLE).select(_COLUMNS)
            term = (barcode_search or "").strip()
            if term:
                query = query.ilike("barcode", f"%{_escape_like(term)}%")
            response = query.order("received_at", desc=True).limit(limit).execute()
        except Exception as exc:
            logger.error("Failed to list dimensioner scans: %s", exc)
            raise _storage_error("load scans", exc) from exc
        return list(getattr(response, "data", None) or [])

    def delete(self, scan_id: str) -> bool:
        """Remove one scan. Returns False when it does not exist."""
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
