"""Data access for registered shipments, their uploads, and collected SKU rows."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from supabase import Client

logger = logging.getLogger(__name__)

_SHIPMENTS = "shipments"
_UPLOADS = "shipment_uploads"
_ROWS = "shipment_sku_rows"
_MIGRATION_HINT = (
    "Run backend/database/migrations/create_shipments.sql in the Supabase SQL Editor."
)
_ROW_CHUNK = 250


def _raise_persist_error(exc: Exception, table: str) -> None:
    message = str(exc).lower()
    missing_table = table in message and (
        "does not exist" in message
        or "relation" in message
        or "schema cache" in message
        or "pgrst205" in message
        or "could not find the table" in message
    )
    if missing_table:
        raise ValueError(f"The {table} table is missing. {_MIGRATION_HINT}") from exc
    if "row-level security" in message or "permission denied" in message:
        raise ValueError(
            f"The request was blocked by database permissions on {table}. "
            f"Confirm the API uses the Supabase service role key. {_MIGRATION_HINT}"
        ) from exc
    raise ValueError(f"Shipment storage error on {table}: {exc}") from exc


class ShipmentRepository:
    def __init__(self, db: Client):
        self.db = db

    # ---- shipments -----------------------------------------------------

    def list_shipments(self) -> List[dict]:
        try:
            response = (
                self.db.table(_SHIPMENTS).select("*").order("created_at", desc=True).execute()
            )
        except Exception as exc:
            logger.error("shipment list failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _SHIPMENTS)
        return response.data or []

    def get_shipment(self, shipment_id: str) -> Optional[dict]:
        try:
            response = (
                self.db.table(_SHIPMENTS).select("*").eq("id", shipment_id).limit(1).execute()
            )
        except Exception as exc:
            logger.error("shipment fetch failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _SHIPMENTS)
        rows = response.data or []
        return rows[0] if rows else None

    def create_shipment(self, row: Dict[str, Any]) -> dict:
        try:
            response = self.db.table(_SHIPMENTS).insert(row).execute()
        except Exception as exc:
            logger.error("shipment create failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _SHIPMENTS)
        data = response.data or []
        if not data:
            raise ValueError(f"The shipment could not be saved. {_MIGRATION_HINT}")
        return data[0]

    def update_shipment(self, shipment_id: str, patch: Dict[str, Any]) -> Optional[dict]:
        patch = dict(patch)
        patch["updated_at"] = datetime.utcnow().isoformat()
        try:
            response = (
                self.db.table(_SHIPMENTS).update(patch).eq("id", shipment_id).execute()
            )
        except Exception as exc:
            logger.error("shipment update failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _SHIPMENTS)
        rows = response.data or []
        return rows[0] if rows else None

    def delete_shipment(self, shipment_id: str) -> None:
        # Uploads and rows cascade from the shipment FK, but delete them first so
        # the shipment never survives with orphans if a cascade is missing.
        for table in (_ROWS, _UPLOADS):
            try:
                self.db.table(table).delete().eq("shipment_id", shipment_id).execute()
            except Exception as exc:
                logger.error("shipment child delete failed: %s", exc, exc_info=True)
                _raise_persist_error(exc, table)
        try:
            self.db.table(_SHIPMENTS).delete().eq("id", shipment_id).execute()
        except Exception as exc:
            logger.error("shipment delete failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _SHIPMENTS)

    # ---- uploads -------------------------------------------------------

    def list_uploads(self, shipment_id: str) -> List[dict]:
        try:
            response = (
                self.db.table(_UPLOADS)
                .select("*")
                .eq("shipment_id", shipment_id)
                .order("created_at")
                .execute()
            )
        except Exception as exc:
            logger.error("shipment uploads list failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _UPLOADS)
        return response.data or []

    def list_uploads_for_shipments(self, shipment_ids: List[str]) -> List[dict]:
        if not shipment_ids:
            return []
        try:
            response = (
                self.db.table(_UPLOADS)
                .select("shipment_id, uploaded_by, row_count")
                .in_("shipment_id", shipment_ids)
                .execute()
            )
        except Exception as exc:
            logger.error("shipment uploads summary failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _UPLOADS)
        return response.data or []

    def get_upload(self, upload_id: str) -> Optional[dict]:
        try:
            response = self.db.table(_UPLOADS).select("*").eq("id", upload_id).limit(1).execute()
        except Exception as exc:
            logger.error("shipment upload fetch failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _UPLOADS)
        rows = response.data or []
        return rows[0] if rows else None

    def create_upload(self, row: Dict[str, Any]) -> dict:
        try:
            response = self.db.table(_UPLOADS).insert(row).execute()
        except Exception as exc:
            logger.error("shipment upload create failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _UPLOADS)
        data = response.data or []
        if not data:
            raise ValueError(f"The upload could not be saved. {_MIGRATION_HINT}")
        return data[0]

    def delete_upload(self, upload_id: str) -> None:
        try:
            self.db.table(_ROWS).delete().eq("upload_id", upload_id).execute()
            self.db.table(_UPLOADS).delete().eq("id", upload_id).execute()
        except Exception as exc:
            logger.error("shipment upload delete failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _UPLOADS)

    # ---- sku rows ------------------------------------------------------

    def insert_rows(self, rows: List[Dict[str, Any]]) -> int:
        if not rows:
            return 0
        inserted = 0
        for start in range(0, len(rows), _ROW_CHUNK):
            chunk = rows[start : start + _ROW_CHUNK]
            try:
                response = self.db.table(_ROWS).insert(chunk).execute()
            except Exception as exc:
                logger.error("shipment rows insert failed: %s", exc, exc_info=True)
                _raise_persist_error(exc, _ROWS)
            if response.data == []:
                raise ValueError(f"Shipment rows were not saved. {_MIGRATION_HINT}")
            inserted += len(chunk)
        return inserted

    def list_rows(self, shipment_id: str) -> List[dict]:
        """All collected rows in upload order, oldest upload first."""
        try:
            response = (
                self.db.table(_ROWS)
                .select("*")
                .eq("shipment_id", shipment_id)
                .order("created_at")
                .order("row_index")
                .execute()
            )
        except Exception as exc:
            logger.error("shipment rows list failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _ROWS)
        return response.data or []

    def upcs_for_shipments(self, shipment_ids: List[str]) -> Dict[str, set[str]]:
        """shipment_id -> set of UPCs, for list-view stats in a single query."""
        if not shipment_ids:
            return {}
        try:
            response = (
                self.db.table(_ROWS)
                .select("shipment_id, upc")
                .in_("shipment_id", shipment_ids)
                .execute()
            )
        except Exception as exc:
            logger.error("shipment upc summary failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _ROWS)
        grouped: Dict[str, set[str]] = {}
        for row in response.data or []:
            upc = (row.get("upc") or "").strip()
            if not upc:
                continue
            grouped.setdefault(str(row.get("shipment_id")), set()).add(upc)
        return grouped

    def existing_upcs(self, shipment_id: str) -> set[str]:
        try:
            response = (
                self.db.table(_ROWS).select("upc").eq("shipment_id", shipment_id).execute()
            )
        except Exception as exc:
            logger.error("shipment upc lookup failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _ROWS)
        return {(row.get("upc") or "").strip() for row in (response.data or []) if row.get("upc")}

    def row_stats(self, shipment_id: str) -> Tuple[int, int]:
        """(total rows stored, unique UPCs) for one shipment."""
        rows = self.list_rows(shipment_id)
        unique = {(row.get("upc") or "").strip() for row in rows if (row.get("upc") or "").strip()}
        return len(rows), len(unique)
