"""Data access for catalog_old_skus."""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from postgrest.types import ReturnMethod
from supabase import Client

logger = logging.getLogger(__name__)

_TABLE = "catalog_old_skus"
_MIGRATION_HINT = (
    "Run backend/database/migrations/create_catalog_old_skus.sql "
    "in the Supabase SQL Editor."
)
_SEARCH_COLS = (
    "old_sku",
    "vendor_name",
    "upc_code",
)
# Larger chunks + parallel workers cut ~64k-row imports from many minutes to tens of seconds.
_INSERT_CHUNK_SIZE = 2000
_INSERT_WORKERS = 4


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


def _hydrate_row_data(row: dict) -> dict:
    """Build display row_data from columns when missing (imports omit the JSON blob)."""
    existing = row.get("row_data")
    if isinstance(existing, dict) and existing:
        return row
    row["row_data"] = {
        "OLD SKU": row.get("old_sku") or "",
        "Vendor Name": row.get("vendor_name") or "",
        "UPC Code": row.get("upc_code") or "",
    }
    return row


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
            f"create_catalog_old_skus.sql. {_MIGRATION_HINT}"
        ) from exc
    raise ValueError(f"Failed to save {chunk_size} row(s) to {_TABLE}: {exc}") from exc


class CatalogOldSkusRepository:
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
            query.order("old_sku")
            .order("vendor_name")
            .range(offset, offset + limit - 1)
            .execute()
        )
        items = [_hydrate_row_data(row) for row in (response.data or [])]
        return items, int(response.count or 0)

    def _insert_chunk(self, chunk: List[Dict[str, Any]]) -> int:
        try:
            self.db.table(_TABLE).insert(
                chunk,
                returning=ReturnMethod.minimal,
            ).execute()
        except Exception as exc:
            logger.error("catalog_old_skus insert failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, len(chunk))
        return len(chunk)

    def replace_all(self, rows: List[Dict[str, Any]]) -> Dict[str, int]:
        """Replace the entire Old SKUs catalog with the uploaded file contents."""
        try:
            self.db.table(_TABLE).delete(
                returning=ReturnMethod.minimal,
            ).neq("old_sku", "").execute()
        except Exception as exc:
            logger.error("catalog_old_skus delete failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, 0)

        if not rows:
            return {"imported": 0}

        now = datetime.utcnow().isoformat()
        prepared: List[Dict[str, Any]] = []
        for row in rows:
            prepared.append(
                {
                    "old_sku": row.get("old_sku") or "",
                    "vendor_name": row.get("vendor_name") or "",
                    "upc_code": row.get("upc_code") or "",
                    # Omit bulky duplicated JSON on write; hydrate on read.
                    "row_data": {},
                    "updated_at": now,
                }
            )

        chunks = [
            prepared[i : i + _INSERT_CHUNK_SIZE]
            for i in range(0, len(prepared), _INSERT_CHUNK_SIZE)
        ]

        imported = 0
        # Parallelize PostgREST inserts — sequential 250-row chunks were too slow for ~64k rows.
        workers = min(_INSERT_WORKERS, max(1, len(chunks)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(self._insert_chunk, chunk) for chunk in chunks]
            for future in as_completed(futures):
                imported += future.result()

        return {"imported": imported}
