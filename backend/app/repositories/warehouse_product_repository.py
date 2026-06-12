"""Data access for warehouse_products (Scan & Print catalog)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from supabase import Client


def normalize_upc_key(upc: str) -> str:
    """Trim only — preserve amzn.gr.* and other non-numeric keys."""
    return (upc or "").strip()


class WarehouseProductRepository:
    def __init__(self, db: Client):
        self.db = db

    def lookup(self, upc: str) -> Optional[dict]:
        key = normalize_upc_key(upc)
        if not key:
            return None
        response = (
            self.db.table("warehouse_products")
            .select("*")
            .eq("upc", key)
            .limit(1)
            .execute()
        )
        if response.data:
            return response.data[0]
        return None

    def count(self, search: Optional[str] = None) -> int:
        query = self.db.table("warehouse_products").select("id", count="exact")
        if search and search.strip():
            s = search.strip().replace(",", " ")
            query = query.or_(
                f"upc.ilike.%{s}%,fnsku.ilike.%{s}%,style_name.ilike.%{s}%"
            )
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
        if search and search.strip():
            s = search.strip().replace(",", " ")
            query = query.or_(
                f"upc.ilike.%{s}%,fnsku.ilike.%{s}%,style_name.ilike.%{s}%"
            )
        response = (
            query.order("upc")
            .range(offset, offset + limit - 1)
            .execute()
        )
        total = int(response.count or 0)
        return response.data or [], total

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
            self.db.table("warehouse_products").upsert(
                chunk,
                on_conflict="upc",
            ).execute()
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
