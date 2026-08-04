"""Data access for catalog_upc_records and catalog_dims_records."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from supabase import Client

logger = logging.getLogger(__name__)

_UPC_TABLE = "catalog_upc_records"
_DIMS_TABLE = "catalog_dims_records"
_MIGRATION_HINT = (
    "Run backend/database/catalog_upc_dims_schema.sql in the Supabase SQL Editor."
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


def _raise_persist_error(exc: Exception, table: str, chunk_size: int) -> None:
    message = str(exc).lower()
    if table in message and ("does not exist" in message or "relation" in message):
        raise ValueError(
            f"The {table} table is missing. {_MIGRATION_HINT}"
        ) from exc
    if "row-level security" in message or "permission denied" in message:
        raise ValueError(
            f"Import was blocked by database permissions on {table}. "
            "Confirm the API uses the Supabase service role key and apply "
            f"catalog_upc_dims_schema.sql. {_MIGRATION_HINT}"
        ) from exc
    raise ValueError(
        f"Failed to save {chunk_size} row(s) to {table}: {exc}"
    ) from exc


class CatalogUpcRepository:
    _SEARCH_COLS = (
        "upc_code",
        "scs",
        "vendor_name",
        "display_name",
        "netsuite_style_name",
        "status",
    )

    def __init__(self, db: Client):
        self.db = db

    def count(self, search: Optional[str] = None) -> int:
        query = self.db.table(_UPC_TABLE).select("id", count="exact")
        query = _apply_search(query, search, self._SEARCH_COLS)
        response = query.execute()
        return int(response.count or 0)

    def list_records(
        self,
        limit: int = 50,
        offset: int = 0,
        search: Optional[str] = None,
    ) -> Tuple[List[dict], int]:
        limit = max(1, min(limit, 200))
        offset = max(0, offset)
        query = self.db.table(_UPC_TABLE).select("*", count="exact")
        query = _apply_search(query, search, self._SEARCH_COLS)
        response = (
            query.order("vendor_name")
            .order("upc_code")
            .range(offset, offset + limit - 1)
            .execute()
        )
        return response.data or [], int(response.count or 0)

    def replace_all(self, rows: List[Dict[str, Any]]) -> Dict[str, int]:
        """Replace the entire UPC catalog with the uploaded file contents."""
        try:
            self.db.table(_UPC_TABLE).delete().neq("upc_code", "").execute()
        except Exception as exc:
            logger.error("catalog_upc delete failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _UPC_TABLE, 0)

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
                response = self.db.table(_UPC_TABLE).insert(chunk).execute()
            except Exception as exc:
                logger.error("catalog_upc insert failed: %s", exc, exc_info=True)
                _raise_persist_error(exc, _UPC_TABLE, len(chunk))
            if response.data == []:
                raise ValueError(
                    f"UPC import returned no saved rows. {_MIGRATION_HINT}"
                )
            imported += len(chunk)
        return {"imported": imported}


class CatalogDimsRepository:
    _SEARCH_COLS = (
        "upc_number",
        "sku",
        "brand",
        "description",
        "current_season",
        "item_status",
    )

    def __init__(self, db: Client):
        self.db = db

    def count(self, search: Optional[str] = None) -> int:
        query = self.db.table(_DIMS_TABLE).select("id", count="exact")
        query = _apply_search(query, search, self._SEARCH_COLS)
        response = query.execute()
        return int(response.count or 0)

    def list_records(
        self,
        limit: int = 50,
        offset: int = 0,
        search: Optional[str] = None,
    ) -> Tuple[List[dict], int]:
        limit = max(1, min(limit, 200))
        offset = max(0, offset)
        query = self.db.table(_DIMS_TABLE).select("*", count="exact")
        query = _apply_search(query, search, self._SEARCH_COLS)
        response = (
            query.order("brand")
            .order("sku")
            .range(offset, offset + limit - 1)
            .execute()
        )
        return response.data or [], int(response.count or 0)

    def replace_all(self, rows: List[Dict[str, Any]]) -> Dict[str, int]:
        """Replace the entire DIMS catalog with the uploaded file contents."""
        try:
            self.db.table(_DIMS_TABLE).delete().neq("upc_number", "").execute()
        except Exception as exc:
            logger.error("catalog_dims delete failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _DIMS_TABLE, 0)

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
                response = self.db.table(_DIMS_TABLE).insert(chunk).execute()
            except Exception as exc:
                logger.error("catalog_dims insert failed: %s", exc, exc_info=True)
                _raise_persist_error(exc, _DIMS_TABLE, len(chunk))
            if response.data == []:
                raise ValueError(
                    f"DIMS import returned no saved rows. {_MIGRATION_HINT}"
                )
            imported += len(chunk)
        return {"imported": imported}
