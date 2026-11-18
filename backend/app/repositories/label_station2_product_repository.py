"""Data access for label_station2_products (Label Station II catalog).

FNSKUs are never stored in this table. They are resolved from the Label Station
catalog (``warehouse_products``) by UPC, so FNSKU fixes made there apply here too.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple

from supabase import Client

from app.repositories.warehouse_product_repository import normalize_upc_key

logger = logging.getLogger(__name__)

TABLE = "label_station2_products"
SOURCE_TABLE = "warehouse_products"

_SCHEMA_HINT = (
    "Run backend/database/migrations/create_label_station2_products.sql in the Supabase SQL Editor."
)
_SEARCH_COLUMNS = ("upc", "external_id", "description", "vendor_name", "size", "color", "mpn")
_CHUNK = 200


class LabelStation2NotFound(Exception):
    """Scan did not resolve to a Label Station II product."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _unique(values: Sequence[str]) -> List[str]:
    return list(dict.fromkeys(v for v in values if v))


def upc_match_keys(upc: str) -> List[str]:
    """UPC spellings that refer to the same product, exact value first.

    Excel drops leading zeros from numeric UPCs, so ``12345678905`` and
    ``012345678905`` must still find each other across the two catalogs.
    """
    key = normalize_upc_key(upc)
    if not key:
        return []
    keys = [key]
    if key.isdigit():
        stripped = key.lstrip("0") or "0"
        keys.append(stripped)
        keys.extend(stripped.zfill(width) for width in (12, 13, 14) if len(stripped) <= width)
    return _unique(keys)


def _quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_label_station2_search_filter(
    search: Optional[str], extra_upcs: Sequence[str] = ()
) -> Optional[str]:
    """PostgREST OR filter across catalog columns (plus UPCs matched by FNSKU)."""
    if not search or not search.strip():
        return None
    term = " ".join(search.strip().replace(",", " ").split())
    if not term:
        return None
    escaped = term.replace("\\", "\\\\").replace('"', '\\"')
    escaped = escaped.replace("%", "\\%").replace("_", "\\_")
    pattern = f'"%{escaped}%"'
    parts = [f"{col}.ilike.{pattern}" for col in _SEARCH_COLUMNS]
    upcs = _unique([u for u in extra_upcs if u])
    if upcs:
        parts.append(f"upc.in.({','.join(_quote(u) for u in upcs)})")
    return ",".join(parts)


class LabelStation2ProductRepository:
    def __init__(self, db: Client):
        self.db = db

    # --- FNSKU resolution (Label Station catalog) ----------------------------

    def _source_rows_by_fnsku(self, fnsku: str) -> List[dict]:
        keys = _unique([fnsku, fnsku.upper()])
        if not keys:
            return []
        response = (
            self.db.table(SOURCE_TABLE)
            .select("upc,fnsku")
            .in_("fnsku", keys)
            .limit(20)
            .execute()
        )
        return [row for row in (response.data or []) if (row.get("upc") or "").strip()]

    def fnsku_by_upcs(self, upcs: Sequence[str]) -> Dict[str, str]:
        """Return ``{upc: fnsku}`` from the Label Station catalog (exact UPC wins)."""
        originals = _unique([normalize_upc_key(u) for u in upcs])
        if not originals:
            return {}
        variants = _unique([k for upc in originals for k in upc_match_keys(upc)])

        fnsku_by_source_upc: Dict[str, str] = {}
        for index in range(0, len(variants), _CHUNK):
            chunk = variants[index : index + _CHUNK]
            response = (
                self.db.table(SOURCE_TABLE)
                .select("upc,fnsku")
                .in_("upc", chunk)
                .execute()
            )
            for row in response.data or []:
                upc = (row.get("upc") or "").strip()
                fnsku = (row.get("fnsku") or "").strip()
                if upc and fnsku and upc not in fnsku_by_source_upc:
                    fnsku_by_source_upc[upc] = fnsku

        found: Dict[str, str] = {}
        for upc in originals:
            for key in upc_match_keys(upc):
                if key in fnsku_by_source_upc:
                    found[upc] = fnsku_by_source_upc[key]
                    break
        return found

    def _attach_fnskus(self, rows: List[dict]) -> List[dict]:
        fnskus = self.fnsku_by_upcs([row.get("upc") or "" for row in rows])
        out = []
        for row in rows:
            upc = normalize_upc_key(row.get("upc") or "")
            out.append({**row, "fnsku": fnskus.get(upc, "")})
        return out

    # --- Catalog reads -------------------------------------------------------

    def _rows_by_upc_keys(self, keys: Sequence[str]) -> Dict[str, dict]:
        keys = _unique(list(keys))
        if not keys:
            return {}
        rows: Dict[str, dict] = {}
        for index in range(0, len(keys), _CHUNK):
            response = (
                self.db.table(TABLE)
                .select("*")
                .in_("upc", keys[index : index + _CHUNK])
                .execute()
            )
            for row in response.data or []:
                upc = (row.get("upc") or "").strip()
                if upc and upc not in rows:
                    rows[upc] = row
        return rows

    def _find_by_upc(self, upc: str) -> Optional[dict]:
        keys = upc_match_keys(upc)
        rows = self._rows_by_upc_keys(keys)
        for key in keys:
            if key in rows:
                return rows[key]
        return None

    def resolve_scan(self, scan_key: str) -> dict:
        """Resolve a scanned FNSKU (or UPC / External ID) to label fields.

        FNSKU → UPC comes from the Label Station catalog; the label fields come
        from Label Station II. Raises ``LabelStation2NotFound`` with a reason.
        """
        key = normalize_upc_key(scan_key)
        if not key:
            raise LabelStation2NotFound("Scan an FNSKU.")

        source_rows = self._source_rows_by_fnsku(key)
        if source_rows:
            keys_in_order: List[str] = []
            for source in source_rows:
                keys_in_order.extend(upc_match_keys(source["upc"]))
            rows = self._rows_by_upc_keys(keys_in_order)
            for source in source_rows:
                for upc_key in upc_match_keys(source["upc"]):
                    if upc_key in rows:
                        return {**rows[upc_key], "fnsku": (source.get("fnsku") or "").strip()}

        row = self._find_by_upc(key)
        if row is None:
            response = (
                self.db.table(TABLE).select("*").eq("external_id", key).limit(1).execute()
            )
            row = (response.data or [None])[0]
        if row is not None:
            return self._attach_fnskus([row])[0]

        if source_rows:
            upcs = ", ".join(_unique([source["upc"].strip() for source in source_rows]))
            raise LabelStation2NotFound(
                f"FNSKU {key} is UPC {upcs} in Label Station, but that UPC is not in the "
                "Label Station II catalog."
            )
        raise LabelStation2NotFound(
            f"{key} was not found. Check that the FNSKU is in the Label Station catalog."
        )

    def _search_filter(self, search: Optional[str]) -> Optional[str]:
        if not search or not search.strip():
            return None
        term = search.strip()
        extra: List[str] = []
        for source in self._source_rows_by_fnsku(term):
            extra.extend(upc_match_keys(source["upc"]))
        return build_label_station2_search_filter(search, extra)

    @staticmethod
    def _apply_filter(query, search_filter: Optional[str]):
        # postgrest 0.13 has no QueryBuilder.or_(); attach the raw or=(...) param.
        if search_filter:
            query.params = query.params.add("or", f"({search_filter})")
        return query

    def count(self, search: Optional[str] = None) -> int:
        query = self.db.table(TABLE).select("id", count="exact")
        query = self._apply_filter(query, self._search_filter(search))
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
        query = self.db.table(TABLE).select("*", count="exact")
        query = self._apply_filter(query, self._search_filter(search))
        response = (
            query.order("updated_at", desc=True)
            .order("upc")
            .range(offset, offset + limit - 1)
            .execute()
        )
        total = int(response.count or 0)
        return self._attach_fnskus(response.data or []), total

    # --- Catalog writes ------------------------------------------------------

    def _raise_persist_error(self, exc: Exception, chunk_size: int) -> None:
        message = str(exc).lower()
        if TABLE in message and ("does not exist" in message or "relation" in message):
            raise ValueError(
                f"The {TABLE} table is missing. {_SCHEMA_HINT}"
            ) from exc
        if "row-level security" in message or "permission denied" in message:
            raise ValueError(
                "Catalog import was blocked by database permissions. "
                "Confirm the API uses the Supabase service role key and apply "
                f"the {TABLE} RLS policies. {_SCHEMA_HINT}"
            ) from exc
        raise ValueError(
            f"Failed to save {chunk_size} catalog row(s) to the database: {exc}"
        ) from exc

    def upsert_batch(self, rows: List[Dict[str, Any]]) -> int:
        """Upsert on UPC. Returns the number of rows saved."""
        if not rows:
            return 0
        now = datetime.utcnow().isoformat()
        payload = []
        for row in rows:
            item = {k: v for k, v in row.items() if k not in ("created_at", "fnsku", "id")}
            item["updated_at"] = now
            payload.append(item)

        chunk_size = 500
        saved = 0
        for index in range(0, len(payload), chunk_size):
            chunk = payload[index : index + chunk_size]
            try:
                response = self.db.table(TABLE).upsert(chunk, on_conflict="upc").execute()
            except Exception as exc:
                logger.error("%s upsert failed: %s", TABLE, exc, exc_info=True)
                self._raise_persist_error(exc, len(chunk))
            if response.data == []:
                raise ValueError(
                    f"Catalog import returned no saved rows. Check database setup. {_SCHEMA_HINT}"
                )
            saved += len(chunk)
        return saved

    def delete_by_upc(self, upc: str) -> bool:
        key = normalize_upc_key(upc)
        if not key:
            return False
        response = self.db.table(TABLE).delete().eq("upc", key).execute()
        return bool(response.data)
