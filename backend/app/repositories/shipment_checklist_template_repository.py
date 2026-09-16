"""Data access for per-vendor shipment checklist templates."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from supabase import Client

logger = logging.getLogger(__name__)

_TABLE = "shipment_vendor_checklists"
_MIGRATION_HINT = (
    "Run backend/database/migrations/create_shipment_vendor_checklists.sql "
    "in the Supabase SQL Editor."
)


def _raise_persist_error(exc: Exception) -> None:
    message = str(exc).lower()
    missing = _TABLE in message and (
        "does not exist" in message
        or "relation" in message
        or "schema cache" in message
        or "pgrst205" in message
        or "could not find the table" in message
    )
    if missing:
        raise ValueError(f"The {_TABLE} table is missing. {_MIGRATION_HINT}") from exc
    if "row-level security" in message or "permission denied" in message:
        raise ValueError(
            f"The request was blocked by database permissions on {_TABLE}. "
            f"Confirm the API uses the Supabase service role key. {_MIGRATION_HINT}"
        ) from exc
    raise ValueError(f"Shipment checklist template error: {exc}") from exc


class ShipmentChecklistTemplateRepository:
    def __init__(self, db: Client):
        self.db = db

    def get_steps(self, vendor: str) -> Optional[List[dict]]:
        """Return stored steps for vendor, or None if no row exists."""
        code = (vendor or "").strip().upper()
        if not code:
            return None
        try:
            response = (
                self.db.table(_TABLE).select("steps").eq("vendor", code).limit(1).execute()
            )
        except Exception as exc:
            logger.error("checklist template fetch failed: %s", exc, exc_info=True)
            _raise_persist_error(exc)
        rows = response.data or []
        if not rows:
            return None
        steps = rows[0].get("steps")
        return steps if isinstance(steps, list) else []

    def upsert_steps(
        self,
        vendor: str,
        steps: List[Dict[str, Any]],
        *,
        updated_by: Optional[str] = None,
    ) -> List[dict]:
        code = (vendor or "").strip().upper()
        if not code:
            raise ValueError("Vendor is required.")
        payload: Dict[str, Any] = {
            "vendor": code,
            "steps": steps,
            "updated_at": datetime.utcnow().isoformat(),
        }
        if updated_by:
            payload["updated_by"] = updated_by
        try:
            response = self.db.table(_TABLE).upsert(payload, on_conflict="vendor").execute()
        except Exception as exc:
            logger.error("checklist template upsert failed: %s", exc, exc_info=True)
            _raise_persist_error(exc)
        data = response.data or []
        if not data:
            # Some PostgREST configs return empty on upsert; re-read.
            stored = self.get_steps(code)
            return stored if stored is not None else steps
        result = data[0].get("steps")
        return result if isinstance(result, list) else steps
