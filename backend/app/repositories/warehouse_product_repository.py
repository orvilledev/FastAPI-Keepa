"""Data access for warehouse_products (Scan & Print catalog)."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from supabase import Client

logger = logging.getLogger(__name__)

_MIGRATION_HINT = (
    "Run backend/database/migrations/add_sku_to_warehouse_products.sql in the Supabase SQL Editor."
)


def normalize_upc_key(upc: str) -> str:
    """Trim only — preserve amzn.gr.* and other non-numeric keys."""
    return (upc or "").strip()


def sku_digit_count(sku: str) -> int:
    return sum(1 for c in (sku or "") if c.isdigit())


def uses_sku_for_scan(sku: str) -> bool:
    """Products with a short SKU (≤7 digits) are scanned by SKU; longer SKUs use UPC."""
    trimmed = (sku or "").strip()
    if not trimmed:
        return False
    return sku_digit_count(trimmed) <= 7


def build_warehouse_product_search_filter(search: Optional[str]) -> Optional[str]:
    """Build a PostgREST OR filter for catalog search.

    Values are double-quoted so dots, commas, and other punctuation in UPCs
    or style names do not break filter parsing.
    """
    if not search or not search.strip():
        return None
    term = " ".join(search.strip().replace(",", " ").split())
    if not term:
        return None
    escaped = term.replace("\\", "\\\\").replace('"', '\\"')
    escaped = escaped.replace("%", "\\%").replace("_", "\\_")
    pattern = f'"%{escaped}%"'
    columns = ("upc", "sku", "fnsku", "style_name", "condition")
    return ",".join(f"{col}.ilike.{pattern}" for col in columns)


def apply_warehouse_product_search(query, search: Optional[str]):
    """Apply multi-column search to a Supabase select/count query.

    postgrest 0.13 (bundled with supabase 2.0.3) has no QueryBuilder.or_(), so we
    attach the raw PostgREST ``or=(...)`` parameter instead.
    """
    search_filter = build_warehouse_product_search_filter(search)
    if search_filter:
        query.params = query.params.add("or", f"({search_filter})")
    return query


class WarehouseProductRepository:
    def __init__(self, db: Client):
        self.db = db

    def lookup(self, scan_key: str) -> Optional[dict]:
        key = normalize_upc_key(scan_key)
        if not key:
            return None

        sku_response = (
            self.db.table("warehouse_products")
            .select("*")
            .eq("sku", key)
            .limit(5)
            .execute()
        )
        for row in sku_response.data or []:
            if uses_sku_for_scan(row.get("sku") or ""):
                return row

        upc_response = (
            self.db.table("warehouse_products")
            .select("*")
            .eq("upc", key)
            .limit(1)
            .execute()
        )
        if upc_response.data:
            row = upc_response.data[0]
            if not uses_sku_for_scan(row.get("sku") or ""):
                return row
        return None

    def count(self, search: Optional[str] = None) -> int:
        query = self.db.table("warehouse_products").select("id", count="exact")
        query = apply_warehouse_product_search(query, search)
        response = query.execute()
        return int(response.count or 0)

    def list_products(
        self,
        limit: int = 50,
        offset: int = 0,
        search: Optional[str] = None,
    ) -> Tuple[List[dict], int]:
        limit = max(1, min(limit, 200))
        offset = max(0, offset)
        query = self.db.table("warehouse_products").select("*", count="exact")
        query = apply_warehouse_product_search(query, search)
        response = (
            query.order("upc")
            .range(offset, offset + limit - 1)
            .execute()
        )
        total = int(response.count or 0)
        return response.data or [], total

    def _raise_persist_error(self, exc: Exception, chunk_size: int) -> None:
        message = str(exc).lower()
        if "warehouse_products" in message and (
            "does not exist" in message or "relation" in message
        ):
            raise ValueError(
                "The warehouse_products table is missing. "
                "Run backend/database/warehouse_products_schema.sql in the Supabase SQL Editor."
            ) from exc
        if "sku" in message and "does not exist" in message:
            raise ValueError(
                f"The warehouse_products table is missing the sku column. {_MIGRATION_HINT}"
            ) from exc
        if "row-level security" in message or "permission denied" in message:
            raise ValueError(
                "Catalog import was blocked by database permissions. "
                "Confirm the API uses the Supabase service role key and apply the latest "
                "warehouse_products RLS policies."
            ) from exc
        raise ValueError(
            f"Failed to save {chunk_size} catalog row(s) to the database: {exc}"
        ) from exc

    def upsert_batch(self, rows: List[Dict[str, Any]]) -> Dict[str, int]:
        """Upsert products on conflict (upc). Returns counts."""
        if not rows:
            return {"imported": 0, "updated": 0, "skipped": 0}

        now = datetime.utcnow().isoformat()
        for row in rows:
            row["updated_at"] = now
            if "created_at" not in row:
                row["created_at"] = now

        chunk_size = 500
        upserted = 0
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i : i + chunk_size]
            try:
                response = (
                    self.db.table("warehouse_products")
                    .upsert(chunk, on_conflict="upc")
                    .execute()
                )
            except Exception as exc:
                logger.error("warehouse_products upsert failed: %s", exc, exc_info=True)
                self._raise_persist_error(exc, len(chunk))

            if response.data == []:
                raise ValueError(
                    "Catalog import returned no saved rows. "
                    f"Check database setup and RLS policies. {_MIGRATION_HINT}"
                )
            upserted += len(chunk)

        return {
            "imported": upserted,
            "updated": 0,
            "skipped": 0,
        }

    def delete_by_upc(self, upc: str) -> bool:
        key = normalize_upc_key(upc)
        if not key:
            return False
        response = (
            self.db.table("warehouse_products")
            .delete()
            .eq("upc", key)
            .execute()
        )
        return bool(response.data)
