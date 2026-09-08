"""Data access for catalog_ship_to_addresses."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from supabase import Client

logger = logging.getLogger(__name__)

_TABLE = "catalog_ship_to_addresses"
_MIGRATION_HINT = (
    "Run backend/database/migrations/create_catalog_ship_to_addresses.sql "
    "in the Supabase SQL Editor."
)
_SEARCH_COLS = (
    "code",
    "full_address",
    "address_1",
    "city",
    "state",
    "postal_code",
)


def _build_or_filter(search: Optional[str], columns: Tuple[str, ...]) -> Optional[str]:
    if not search or not search.strip():
        return None
    term = " ".join(search.strip().replace(",", " ").split())
    if not term:
        return None
    escaped = term.replace("\\", "\\\\").replace('"', '\\"')
    escaped = escaped.replace("%", "\\%").replace("_", "\\_")
    pattern = f'"%{escaped}%"'
    return ",".join(f"{col}.ilike.{pattern}" for col in columns)


def _apply_search(query, search: Optional[str], columns: Tuple[str, ...]):
    search_filter = _build_or_filter(search, columns)
    if search_filter:
        query.params = query.params.add("or", f"({search_filter})")
    return query


def _raise_persist_error(exc: Exception, chunk_size: int) -> None:
    message = str(exc).lower()
    missing_table = _TABLE in message and (
        "does not exist" in message
        or "relation" in message
        or "schema cache" in message
        or "pgrst205" in message
        or "could not find the table" in message
    )
    if missing_table:
        raise ValueError(f"The {_TABLE} table is missing. {_MIGRATION_HINT}") from exc
    if "row-level security" in message or "permission denied" in message:
        raise ValueError(
            f"Import was blocked by database permissions on {_TABLE}. "
            "Confirm the API uses the Supabase service role key and apply "
            f"create_catalog_ship_to_addresses.sql. {_MIGRATION_HINT}"
        ) from exc
    raise ValueError(f"Failed to save {chunk_size} row(s) to {_TABLE}: {exc}") from exc


class CatalogShipToRepository:
    def __init__(self, db: Client):
        self.db = db

    def list_records(
        self,
        limit: int = 50,
        offset: int = 0,
        search: Optional[str] = None,
    ) -> Tuple[List[dict], int]:
        limit = max(1, min(limit, 200))
        offset = max(0, offset)
        query = self.db.table(_TABLE).select("*", count="exact")
        query = _apply_search(query, search, _SEARCH_COLS)
        response = (
            query.order("code")
            .order("address_1")
            .range(offset, offset + limit - 1)
            .execute()
        )
        return response.data or [], int(response.count or 0)

    def replace_all(self, rows: List[Dict[str, Any]]) -> Dict[str, int]:
        """Replace the entire ship-to catalog with the uploaded file contents."""
        try:
            self.db.table(_TABLE).delete().neq("code", "").execute()
        except Exception as exc:
            logger.error("catalog_ship_to delete failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, 0)

        if not rows:
            return {"imported": 0}

        now = datetime.utcnow().isoformat()
        for row in rows:
            row["updated_at"] = now
            row.pop("created_at", None)
            row.pop("id", None)

        chunk_size = 250
        imported = 0
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i : i + chunk_size]
            try:
                response = self.db.table(_TABLE).insert(chunk).execute()
            except Exception as exc:
                logger.error("catalog_ship_to insert failed: %s", exc, exc_info=True)
                _raise_persist_error(exc, len(chunk))
            if response.data == []:
                raise ValueError(
                    f"Ship-to import returned no saved rows. {_MIGRATION_HINT}"
                )
            imported += len(chunk)
        return {"imported": imported}
