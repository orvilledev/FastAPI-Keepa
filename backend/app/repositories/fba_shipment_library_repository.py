"""Data access for FBA Order Checker."""
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
_UNKNOWNS = "fba_shipment_unknown_scans"
_BOX_SCANS = "fba_shipment_box_scans"
_MIGRATION_HINT = (
    "Run backend/database/migrations/create_fba_shipment_library.sql, "
    "create_fba_shipment_counts.sql, create_fba_shipment_unknown_scans.sql, "
    "create_fba_shipment_box_scans.sql, "
    "add_fba_shipment_library_access.sql, and add_fba_shipment_library_trash.sql "
    "in the Supabase SQL Editor."
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
        _UPLOADS in message
        or _LINES in message
        or _COUNTS in message
        or _UNKNOWNS in message
        or _BOX_SCANS in message
        or "relation" in message
    ):
        raise ValueError(f"The FBA Order Checker tables are missing. {_MIGRATION_HINT}") from exc
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
        archived: bool = False,
        trashed: bool = False,
        viewer_id: Optional[str] = None,
        see_locked: bool = False,
    ) -> Tuple[List[dict], int]:
        limit = max(1, min(limit, 100))
        offset = max(0, offset)
        query = self.db.table(_UPLOADS).select("*", count="exact")
        if created_by:
            query = query.eq("created_by", created_by)
        if trashed:
            query = query.not_.is_("trashed_at", "null")
        elif archived:
            query = query.is_("trashed_at", "null").not_.is_("archived_at", "null")
        else:
            query = query.is_("trashed_at", "null").is_("archived_at", "null")
        upload_ids = self._upload_ids_for_line_search(search)
        search_or = self._upload_search_or(search, upload_ids)
        visibility = None
        if viewer_id and not see_locked:
            visibility = f"is_locked.eq.false,created_by.eq.{viewer_id}"
        if visibility and search_or:
            query.params = query.params.add("and", f"(or({visibility}),or({search_or}))")
        elif visibility:
            query.params = query.params.add("or", f"({visibility})")
        elif search_or:
            query.params = query.params.add("or", f"({search_or})")
        order_column = "trashed_at" if trashed else "created_at"
        response = query.order(order_column, desc=True).range(offset, offset + limit - 1).execute()
        return list(response.data or []), int(response.count or 0)

    def get_upload(self, upload_id: str) -> Optional[dict]:
        response = self.db.table(_UPLOADS).select("*").eq("id", upload_id).limit(1).execute()
        rows = response.data or []
        return rows[0] if rows else None

    def list_line_quantities(self, upload_id: str) -> List[dict]:
        rows: List[dict] = []
        offset = 0
        while True:
            response = (
                self.db.table(_LINES)
                .select("id,line_number,merchant_sku,external_id,shipped")
                .eq("upload_id", upload_id)
                .order("line_number")
                .range(offset, offset + 499)
                .execute()
            )
            chunk = list(response.data or [])
            rows.extend(chunk)
            if len(chunk) < 500:
                return rows
            offset += 500

    def set_locked(self, upload_id: str, locked: bool) -> dict:
        try:
            response = (
                self.db.table(_UPLOADS)
                .update({"is_locked": locked})
                .eq("id", upload_id)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        rows = response.data or []
        if not rows:
            raise ValueError("The shipment lock was not saved.")
        return rows[0]

    def archive_upload(self, upload_id: str, user_id: str) -> dict:
        try:
            response = (
                self.db.table(_UPLOADS)
                .update(
                    {
                        "archived_at": datetime.now(timezone.utc).isoformat(),
                        "archived_by": user_id,
                    }
                )
                .eq("id", upload_id)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        rows = response.data or []
        if not rows:
            raise ValueError("The shipment was not archived.")
        return rows[0]

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

    def list_unknown_scans(self, upload_id: str, user_id: str) -> List[dict]:
        if not upload_id or not user_id:
            return []
        try:
            response = (
                self.db.table(_UNKNOWNS)
                .select("*")
                .eq("upload_id", upload_id)
                .eq("user_id", user_id)
                .order("updated_at", desc=True)
                .execute()
            )
        except Exception as exc:
            if _is_missing_table(exc):
                return []
            _raise_persist_error(exc)
        return list(response.data or [])

    def increment_unknown_scan(self, upload_id: str, user_id: str, external_id: str) -> dict:
        """Record a barcode that is not on this shipment. Each scan adds 1."""
        for _ in range(5):
            try:
                existing = (
                    self.db.table(_UNKNOWNS)
                    .select("id, counted, external_id")
                    .eq("upload_id", upload_id)
                    .eq("user_id", user_id)
                    .eq("external_id", external_id)
                    .limit(1)
                    .execute()
                )
            except Exception as exc:
                _raise_persist_error(exc)
            rows = existing.data or []
            if not rows:
                try:
                    created = (
                        self.db.table(_UNKNOWNS)
                        .insert(
                            {
                                "upload_id": upload_id,
                                "user_id": user_id,
                                "external_id": external_id,
                                "counted": 1,
                            }
                        )
                        .execute()
                    )
                    saved = (created.data or [None])[0]
                    if saved:
                        return saved
                    return {
                        "id": "",
                        "external_id": external_id,
                        "counted": 1,
                    }
                except Exception as exc:
                    if _is_unique_violation(exc):
                        continue
                    _raise_persist_error(exc)
            current = int(rows[0].get("counted") or 0)
            try:
                updated = (
                    self.db.table(_UNKNOWNS)
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
                return updated.data[0]
        raise ValueError("Could not record that scan. Scan it again.")

    def record_box_scan(
        self,
        upload_id: str,
        user_id: str,
        external_id: str,
        box_number: int,
        line_id: Optional[str] = None,
    ) -> str:
        """Remember which box one scanned unit went into. Returns the new row id."""
        payload: Dict[str, Any] = {
            "upload_id": upload_id,
            "user_id": user_id,
            "external_id": external_id,
            "box_number": int(box_number),
        }
        if line_id:
            payload["line_id"] = line_id
        try:
            response = self.db.table(_BOX_SCANS).insert(payload).execute()
        except Exception as exc:
            _raise_persist_error(exc)
        rows = response.data or []
        if not rows or not rows[0].get("id"):
            raise ValueError("The box number for that scan was not saved. Scan it again.")
        return str(rows[0]["id"])

    def delete_box_scan(self, box_scan_id: str) -> None:
        """Undo a box record when the matching count could not be saved."""
        if not box_scan_id:
            return
        try:
            self.db.table(_BOX_SCANS).delete().eq("id", box_scan_id).execute()
        except Exception:
            logger.exception("Failed to roll back FBA box scan %s", box_scan_id)

    def list_box_scans(self, upload_id: str, user_id: str) -> List[dict]:
        """This user's box scans for the shipment, oldest first. Missing table reads as empty."""
        if not upload_id or not user_id:
            return []
        rows: List[dict] = []
        offset = 0
        while True:
            try:
                response = (
                    self.db.table(_BOX_SCANS)
                    .select("external_id, box_number, created_at")
                    .eq("upload_id", upload_id)
                    .eq("user_id", user_id)
                    .order("created_at")
                    .order("id")
                    .range(offset, offset + 999)
                    .execute()
                )
            except Exception as exc:
                if _is_missing_table(exc):
                    return []
                _raise_persist_error(exc)
            chunk = list(response.data or [])
            rows.extend(chunk)
            if len(chunk) < 1000:
                return rows
            offset += 1000

    def trash_upload(self, upload_id: str, user_id: str) -> dict:
        try:
            response = (
                self.db.table(_UPLOADS)
                .update(
                    {
                        "trashed_at": datetime.now(timezone.utc).isoformat(),
                        "trashed_by": user_id,
                    }
                )
                .eq("id", upload_id)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        rows = response.data or []
        if not rows:
            raise ValueError("The shipment was not moved to Trash.")
        return rows[0]

    def restore_upload(self, upload_id: str) -> dict:
        try:
            response = (
                self.db.table(_UPLOADS)
                .update({"trashed_at": None, "trashed_by": None})
                .eq("id", upload_id)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        rows = response.data or []
        if not rows:
            raise ValueError("The shipment was not restored.")
        return rows[0]

    def empty_trash(self, *, created_by: Optional[str] = None) -> int:
        query = self.db.table(_UPLOADS).select("id").not_.is_("trashed_at", "null")
        if created_by:
            query = query.eq("created_by", created_by)
        try:
            response = query.execute()
        except Exception as exc:
            _raise_persist_error(exc)
        ids = [str(row.get("id") or "") for row in (response.data or []) if row.get("id")]
        for upload_id in ids:
            self.delete_upload(upload_id)
        return len(ids)

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

    def _upload_search_or(self, search: Optional[str], upload_ids: List[str]) -> Optional[str]:
        term = " ".join((search or "").strip().replace(",", " ").split())
        if not term:
            return None
        escaped = _escape_like(term)
        pattern = f'"%{escaped}%"'
        clauses = [
            f"shipment_id.ilike.{pattern}",
            f"source_filename.ilike.{pattern}",
            f"created_by_name.ilike.{pattern}",
        ]
        if upload_ids:
            clauses.append(f"id.in.({','.join(upload_ids)})")
        return ",".join(clauses)

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
