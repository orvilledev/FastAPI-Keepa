"""Data access for the FBA Shipment Library."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from postgrest.types import ReturnMethod
from supabase import Client

logger = logging.getLogger(__name__)

_UPLOADS = "fba_shipment_uploads"
_LINES = "fba_shipment_lines"
_COUNTS = "fba_shipment_counts"
_MIGRATION_HINT = (
    "Run backend/database/migrations/create_fba_shipment_library.sql "
    "and create_fba_shipment_counts.sql in the Supabase SQL Editor."
)
_INSERT_CHUNK = 500


def _is_missing_table(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "does not exist" in message
        or "schema cache" in message
        or "pgrst205" in message
        or "could not find the table" in message
    )


def _is_unique_violation(exc: Exception) -> bool:
    message = str(exc).lower()
    return "23505" in message or "duplicate key" in message


def _escape_like(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace('"', '\\"')
    return escaped.replace("%", "\\%").replace("_", "\\_")


def _raise_persist_error(exc: Exception) -> None:
    message = str(exc).lower()
    missing_table = (
        "does not exist" in message
        or "schema cache" in message
        or "pgrst205" in message
        or "could not find the table" in message
    )
    if missing_table and (
        _UPLOADS in message or _LINES in message or _COUNTS in message or "relation" in message
    ):
        raise ValueError(f"The FBA Shipment Library tables are missing. {_MIGRATION_HINT}") from exc
    if "row-level security" in message or "permission denied" in message:
        raise ValueError(
            "Saving was blocked by database permissions. "
            f"Confirm the API uses the Supabase service role key. {_MIGRATION_HINT}"
        ) from exc
    raise ValueError(f"Failed to save the FBA shipment: {exc}") from exc


class FbaShipmentLibraryRepository:
    def __init__(self, db: Client):
        self.db = db

    def list_uploads(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        search: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> Tuple[List[dict], int]:
        limit = max(1, min(limit, 100))
        offset = max(0, offset)
        query = self.db.table(_UPLOADS).select("*", count="exact")
        if created_by:
            query = query.eq("created_by", created_by)
        upload_ids = self._upload_ids_for_line_search(search)
        query = self._apply_upload_search(query, search, upload_ids)
        response = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        return list(response.data or []), int(response.count or 0)

    def get_upload(self, upload_id: str) -> Optional[dict]:
        response = self.db.table(_UPLOADS).select("*").eq("id", upload_id).limit(1).execute()
        rows = response.data or []
        return rows[0] if rows else None

    def list_lines(
        self,
        upload_id: str,
        *,
        limit: int = 100,
        offset: int = 0,
        search: Optional[str] = None,
    ) -> Tuple[List[dict], int]:
        limit = max(1, min(limit, 500))
        offset = max(0, offset)
        query = self.db.table(_LINES).select("*", count="exact").eq("upload_id", upload_id)
        query = self._apply_line_search(query, search)
        response = (
            query.order("line_number")
            .range(offset, offset + limit - 1)
            .execute()
        )
        return list(response.data or []), int(response.count or 0)

    def create_upload(
        self,
        *,
        shipment_id: str,
        source_filename: str,
        line_count: int,
        total_shipped: int,
        created_by: str,
        created_by_email: str,
        created_by_name: str,
        lines: List[Dict[str, Any]],
    ) -> dict:
        payload = {
            "shipment_id": shipment_id,
            "source_filename": source_filename,
            "line_count": line_count,
            "total_shipped": total_shipped,
            "created_by": created_by,
            "created_by_email": created_by_email,
            "created_by_name": created_by_name,
        }
        try:
            response = self.db.table(_UPLOADS).insert(payload).execute()
        except Exception as exc:
            _raise_persist_error(exc)
        rows = response.data or []
        if not rows:
            raise ValueError("The shipment was not saved.")
        upload = rows[0]
        upload_id = str(upload["id"])
        try:
            self._insert_lines(upload_id, lines)
        except Exception:
            try:
                self.db.table(_UPLOADS).delete().eq("id", upload_id).execute()
            except Exception:
                logger.exception("Failed to roll back FBA shipment upload %s", upload_id)
            raise
        return upload

    def counts_for_lines(self, line_ids: List[str], user_id: str) -> Dict[str, int]:
        """This user's counted total for each line. Missing table reads as zero."""
        ids = [line_id for line_id in line_ids if line_id]
        if not ids or not user_id:
            return {}
        found: Dict[str, int] = {}
        for start in range(0, len(ids), 200):
            chunk = ids[start : start + 200]
            try:
                response = (
                    self.db.table(_COUNTS)
                    .select("line_id, counted")
                    .eq("user_id", user_id)
                    .in_("line_id", chunk)
                    .execute()
                )
            except Exception as exc:
                if _is_missing_table(exc):
                    return {}
                _raise_persist_error(exc)
            for row in response.data or []:
                found[str(row.get("line_id") or "")] = int(row.get("counted") or 0)
        return found

    def lines_for_barcode(self, upload_id: str, barcode: str) -> List[dict]:
        code = barcode.strip()
        variants = list(dict.fromkeys([code, f"UPC: {code}", f"UPC:{code}"]))
        try:
            response = (
                self.db.table(_LINES)
                .select("*")
                .eq("upload_id", upload_id)
                .in_("external_id", variants)
                .order("line_number")
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        return list(response.data or [])

    def increment_count(self, upload_id: str, line_id: str, user_id: str) -> int:
        """Add one scan for this user and line. Safe if two scans arrive together."""
        for _ in range(5):
            try:
                existing = (
                    self.db.table(_COUNTS)
                    .select("id, counted")
                    .eq("line_id", line_id)
                    .eq("user_id", user_id)
                    .limit(1)
                    .execute()
                )
            except Exception as exc:
                _raise_persist_error(exc)
            rows = existing.data or []
            if not rows:
                try:
                    self.db.table(_COUNTS).insert(
                        {
                            "upload_id": upload_id,
                            "line_id": line_id,
                            "user_id": user_id,
                            "counted": 1,
                        }
                    ).execute()
                    return 1
                except Exception as exc:
                    if _is_unique_violation(exc):
                        continue
                    _raise_persist_error(exc)
            current = int(rows[0].get("counted") or 0)
            try:
                updated = (
                    self.db.table(_COUNTS)
                    .update(
                        {
                            "counted": current + 1,
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                    .eq("id", rows[0]["id"])
                    .eq("counted", current)
                    .execute()
                )
            except Exception as exc:
                _raise_persist_error(exc)
            if updated.data:
                return current + 1
        raise ValueError("Could not record that scan. Scan it again.")

    def delete_upload(self, upload_id: str) -> None:
        try:
            self.db.table(_UPLOADS).delete().eq("id", upload_id).execute()
        except Exception as exc:
            _raise_persist_error(exc)

    def _insert_lines(self, upload_id: str, lines: List[Dict[str, Any]]) -> None:
        if not lines:
            return
        rows = [
            {
                "upload_id": upload_id,
                "line_number": line["line_number"],
                "merchant_sku": line["merchant_sku"],
                "external_id": line.get("external_id") or "",
                "shipped": line["shipped"],
            }
            for line in lines
        ]
        for start in range(0, len(rows), _INSERT_CHUNK):
            chunk = rows[start : start + _INSERT_CHUNK]
            try:
                self.db.table(_LINES).insert(chunk, returning=ReturnMethod.minimal).execute()
            except Exception as exc:
                _raise_persist_error(exc)

    def _upload_ids_for_line_search(self, search: Optional[str]) -> List[str]:
        term = " ".join((search or "").strip().replace(",", " ").split())
        if not term:
            return []
        pattern = f"%{term}%"
        found: List[str] = []
        for column in ("merchant_sku", "external_id"):
            try:
                response = (
                    self.db.table(_LINES)
                    .select("upload_id")
                    .ilike(column, pattern)
                    .limit(300)
                    .execute()
                )
            except Exception as exc:
                _raise_persist_error(exc)
            for row in response.data or []:
                upload_id = str(row.get("upload_id") or "")
                if upload_id and upload_id not in found:
                    found.append(upload_id)
        return found

    def _apply_upload_search(self, query, search: Optional[str], upload_ids: List[str]):
        term = " ".join((search or "").strip().replace(",", " ").split())
        if not term:
            return query
        escaped = _escape_like(term)
        pattern = f'"%{escaped}%"'
        clauses = [
            f"shipment_id.ilike.{pattern}",
            f"source_filename.ilike.{pattern}",
            f"created_by_name.ilike.{pattern}",
        ]
        if upload_ids:
            clauses.append(f"id.in.({','.join(upload_ids)})")
        query.params = query.params.add("or", f"({','.join(clauses)})")
        return query

    def _apply_line_search(self, query, search: Optional[str]):
        term = " ".join((search or "").strip().replace(",", " ").split())
        if not term:
            return query
        escaped = _escape_like(term)
        pattern = f'"%{escaped}%"'
        query.params = query.params.add(
            "or",
            f"(merchant_sku.ilike.{pattern},external_id.ilike.{pattern})",
        )
        return query
