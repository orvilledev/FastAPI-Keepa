"""Data access for FBA Order Checker."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from postgrest.types import ReturnMethod
from supabase import Client

from app.services.fba_shipment_library import counts_kept_in_box, strip_upc_label, upload_visibility_filter

logger = logging.getLogger(__name__)

_UPLOADS = "fba_shipment_uploads"
_LINES = "fba_shipment_lines"
_COUNTS = "fba_shipment_counts"
_UNKNOWNS = "fba_shipment_unknown_scans"
_BOX_SCANS = "fba_shipment_box_scans"
_FOLDERS = "fba_shipment_folders"
_MIGRATION_HINT = (
    "Run backend/database/migrations/create_fba_shipment_library.sql, "
    "create_fba_shipment_counts.sql, create_fba_shipment_unknown_scans.sql, "
    "create_fba_shipment_box_scans.sql, "
    "add_fba_shipment_library_access.sql, add_fba_shipment_library_trash.sql, "
    "add_fba_shipment_name.sql, add_fba_shipment_custom_share.sql, "
    "and add_fba_shipment_folders.sql "
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
    if "shared_with" in message and (
        "schema cache" in message
        or "does not exist" in message
        or "column" in message
        or "pgrst204" in message
    ):
        raise ValueError(
            "The FBA Order Checker needs a database update before a shipment can be shared "
            "with chosen people. Run backend/database/migrations/add_fba_shipment_custom_share.sql "
            "in the Supabase SQL Editor."
        ) from exc
    if "shipment_name" in message and (
        "schema cache" in message
        or "does not exist" in message
        or "column" in message
        or "pgrst204" in message
    ):
        raise ValueError(
            "The FBA Order Checker needs a database update before it can store the shipment name. "
            "Run backend/database/migrations/add_fba_shipment_name.sql in the Supabase SQL Editor."
        ) from exc
    if ("folder_id" in message or _FOLDERS in message) and (
        "schema cache" in message
        or "does not exist" in message
        or "column" in message
        or "pgrst204" in message
        or "pgrst205" in message
    ):
        raise ValueError(
            "The FBA Order Checker needs a database update before shipments can be grouped into folders. "
            "Run backend/database/migrations/add_fba_shipment_folders.sql in the Supabase SQL Editor."
        ) from exc
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
        or _FOLDERS in message
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
        folder_id: Optional[str] = None,
        ungrouped: bool = False,
    ) -> Tuple[List[dict], int]:
        limit = max(1, min(limit, 100))
        offset = max(0, offset)
        upload_ids = self._upload_ids_for_line_search(search)
        search_or = self._upload_search_or(search, upload_ids)
        visibility = upload_visibility_filter(viewer_id) if viewer_id and not see_locked else None
        order_column = "trashed_at" if trashed else "created_at"
        page_kwargs = dict(
            created_by=created_by,
            archived=archived,
            trashed=trashed,
            search_or=search_or,
            order_column=order_column,
            limit=limit,
            offset=offset,
            folder_id=None if ungrouped else folder_id,
            ungrouped=ungrouped,
        )
        try:
            response = self._upload_page(visibility=visibility, **page_kwargs)
        except Exception as exc:
            legacy = f"is_locked.eq.false,created_by.eq.{viewer_id}" if viewer_id else None
            if visibility and legacy and "shared_with" in str(exc).lower():
                try:
                    response = self._upload_page(visibility=legacy, **page_kwargs)
                except Exception as retry_exc:
                    _raise_persist_error(retry_exc)
            elif folder_id or ungrouped:
                _raise_persist_error(exc)
            else:
                raise
        return list(response.data or []), int(response.count or 0)

    def _upload_page(
        self,
        *,
        created_by: Optional[str],
        archived: bool,
        trashed: bool,
        search_or: Optional[str],
        visibility: Optional[str],
        order_column: str,
        limit: int,
        offset: int,
        folder_id: Optional[str] = None,
        ungrouped: bool = False,
    ):
        query = self.db.table(_UPLOADS).select("*", count="exact")
        if created_by:
            query = query.eq("created_by", created_by)
        if trashed:
            query = query.not_.is_("trashed_at", "null")
        elif archived:
            query = query.is_("trashed_at", "null").not_.is_("archived_at", "null")
        else:
            query = query.is_("trashed_at", "null").is_("archived_at", "null")
        if ungrouped:
            query = query.is_("folder_id", "null")
        elif folder_id:
            query = query.eq("folder_id", folder_id)
        if visibility and search_or:
            query.params = query.params.add("and", f"(or({visibility}),or({search_or}))")
        elif visibility:
            query.params = query.params.add("or", f"({visibility})")
        elif search_or:
            query.params = query.params.add("or", f"({search_or})")
        return query.order(order_column, desc=True).range(offset, offset + limit).execute()

    def list_folders(self) -> List[dict]:
        try:
            response = (
                self.db.table(_FOLDERS)
                .select("id,name,created_by,created_by_email,created_at")
                .order("name")
                .limit(200)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        return list(response.data or [])

    def get_folder(self, folder_id: str) -> Optional[dict]:
        try:
            response = self.db.table(_FOLDERS).select("*").eq("id", folder_id).limit(1).execute()
        except Exception as exc:
            _raise_persist_error(exc)
        rows = response.data or []
        return rows[0] if rows else None

    def _require_unique_folder_name(self, name: str, except_id: Optional[str] = None) -> None:
        try:
            response = self.db.table(_FOLDERS).select("id,name").limit(500).execute()
        except Exception as exc:
            _raise_persist_error(exc)
        target = name.casefold()
        for row in response.data or []:
            if except_id and str(row.get("id") or "") == except_id:
                continue
            if str(row.get("name") or "").casefold() == target:
                raise ValueError("A folder with that name already exists.")

    def create_folder(self, name: str, user_id: str, email: str) -> dict:
        self._require_unique_folder_name(name)
        try:
            response = (
                self.db.table(_FOLDERS)
                .insert(
                    {
                        "name": name,
                        "created_by": user_id or None,
                        "created_by_email": email or "",
                    }
                )
                .execute()
            )
        except Exception as exc:
            if _is_unique_violation(exc):
                raise ValueError("A folder with that name already exists.") from exc
            _raise_persist_error(exc)
        rows = response.data or []
        if not rows:
            raise ValueError("The folder was not saved.")
        return rows[0]

    def rename_folder(self, folder_id: str, name: str) -> dict:
        self._require_unique_folder_name(name, except_id=folder_id)
        try:
            response = (
                self.db.table(_FOLDERS)
                .update(
                    {
                        "name": name,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
                .eq("id", folder_id)
                .execute()
            )
        except Exception as exc:
            if _is_unique_violation(exc):
                raise ValueError("A folder with that name already exists.") from exc
            _raise_persist_error(exc)
        rows = response.data or []
        if not rows:
            raise ValueError("The folder name was not saved.")
        return rows[0]

    def delete_folder(self, folder_id: str) -> None:
        """Remove the folder and leave its shipments in the list."""
        try:
            self.db.table(_UPLOADS).update({"folder_id": None}).eq("folder_id", folder_id).execute()
            self.db.table(_FOLDERS).delete().eq("id", folder_id).execute()
        except Exception as exc:
            _raise_persist_error(exc)

    def set_uploads_folder(self, upload_ids: List[str], folder_id: Optional[str]) -> None:
        if not upload_ids:
            return
        try:
            response = (
                self.db.table(_UPLOADS)
                .update({"folder_id": folder_id})
                .in_("id", upload_ids)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        if not response.data:
            raise ValueError("Those shipments could not be moved.")

    def folder_placement_counts(
        self,
        *,
        created_by: Optional[str] = None,
        archived: bool = False,
        trashed: bool = False,
        viewer_id: Optional[str] = None,
        see_locked: bool = False,
    ) -> Tuple[Dict[str, int], int]:
        visibility = upload_visibility_filter(viewer_id) if viewer_id and not see_locked else None
        try:
            return self._count_folder_placements(
                created_by=created_by,
                archived=archived,
                trashed=trashed,
                visibility=visibility,
            )
        except Exception as exc:
            legacy = f"is_locked.eq.false,created_by.eq.{viewer_id}" if viewer_id else None
            if visibility and legacy and "shared_with" in str(exc).lower():
                try:
                    return self._count_folder_placements(
                        created_by=created_by,
                        archived=archived,
                        trashed=trashed,
                        visibility=legacy,
                    )
                except Exception as retry_exc:
                    _raise_persist_error(retry_exc)
            _raise_persist_error(exc)

    def _count_folder_placements(
        self,
        *,
        created_by: Optional[str],
        archived: bool,
        trashed: bool,
        visibility: Optional[str],
    ) -> Tuple[Dict[str, int], int]:
        counts: Dict[str, int] = {}
        ungrouped = 0
        offset = 0
        page = 1000
        while True:
            query = self.db.table(_UPLOADS).select("folder_id")
            if created_by:
                query = query.eq("created_by", created_by)
            if trashed:
                query = query.not_.is_("trashed_at", "null")
            elif archived:
                query = query.is_("trashed_at", "null").not_.is_("archived_at", "null")
            else:
                query = query.is_("trashed_at", "null").is_("archived_at", "null")
            if visibility:
                query.params = query.params.add("or", f"({visibility})")
            response = query.range(offset, offset + page - 1).execute()
            rows = list(response.data or [])
            for row in rows:
                placed = row.get("folder_id")
                if placed:
                    key = str(placed)
                    counts[key] = counts.get(key, 0) + 1
                else:
                    ungrouped += 1
            if len(rows) < page:
                return counts, ungrouped
            offset += page

    def get_upload(self, upload_id: str) -> Optional[dict]:
        response = self.db.table(_UPLOADS).select("*").eq("id", upload_id).limit(1).execute()
        rows = response.data or []
        return rows[0] if rows else None

    def find_shipment_copies(self, shipment_id: str) -> List[dict]:
        """Uploads of this Shipment ID, including archived and trashed copies."""
        cleaned = (shipment_id or "").strip()
        if not cleaned:
            return []
        pattern = cleaned.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        try:
            response = (
                self.db.table(_UPLOADS)
                .select("id,shipment_id,trashed_at,archived_at,created_at")
                .ilike("shipment_id", pattern)
                .order("created_at")
                .limit(50)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        return list(response.data or [])

    def list_line_quantities(self, upload_id: str) -> List[dict]:
        rows: List[dict] = []
        offset = 0
        while True:
            response = (
                self.db.table(_LINES)
                .select("id,line_number,merchant_sku,external_id,shipped")
                .eq("upload_id", upload_id)
                .order("line_number")
                .range(offset, offset + 500)
                .execute()
            )
            chunk = list(response.data or [])
            rows.extend(chunk)
            if len(chunk) < 500:
                return rows
            offset += 500

    def set_shipment_name(self, upload_id: str, shipment_name: str) -> dict:
        try:
            response = (
                self.db.table(_UPLOADS)
                .update({"shipment_name": shipment_name})
                .eq("id", upload_id)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        rows = response.data or []
        if not rows:
            raise ValueError("The shipment name was not saved.")
        return rows[0]

    def set_locked(self, upload_id: str, locked: bool) -> dict:
        return self.set_access(upload_id, locked=locked)

    def set_access(
        self,
        upload_id: str,
        *,
        locked: bool,
        shared_with: Optional[List[str]] = None,
        replace_share: bool = False,
    ) -> dict:
        """Lock a shipment, share it with everyone, or share it with chosen people.

        Locking leaves an existing custom list in place so the owner can reopen it.
        ``replace_share`` writes ``shared_with``: None means everyone.
        """
        payload: Dict[str, Any] = {"is_locked": locked}
        if replace_share:
            payload["shared_with"] = shared_with
        try:
            response = (
                self.db.table(_UPLOADS)
                .update(payload)
                .eq("id", upload_id)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        rows = response.data or []
        if not rows:
            raise ValueError("The shipment lock was not saved.")
        return rows[0]

    def archive_upload(self, upload_id: str, user_id: str, folder_id: str) -> dict:
        try:
            response = (
                self.db.table(_UPLOADS)
                .update(
                    {
                        "archived_at": datetime.now(timezone.utc).isoformat(),
                        "archived_by": user_id,
                        "folder_id": folder_id,
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
        line_ids: Optional[List[str]] = None,
    ) -> Tuple[List[dict], int]:
        limit = max(1, min(limit, 500))
        offset = max(0, offset)
        if line_ids is not None:
            return self._list_lines_by_id(upload_id, line_ids, limit=limit, offset=offset, search=search)
        query = self.db.table(_LINES).select("*", count="exact").eq("upload_id", upload_id)
        query = self._apply_line_search(query, search)
        response = (
            query.order("line_number")
            .range(offset, offset + limit)
            .execute()
        )
        return list(response.data or []), int(response.count or 0)

    def box_scan_keys(self, upload_id: str, box_number: int) -> Tuple[List[str], set]:
        """Line ids and unknown barcodes that have at least one scan in this box."""
        line_ids: List[str] = []
        seen: set[str] = set()
        unknown: set[str] = set()
        offset = 0
        while True:
            try:
                response = (
                    self.db.table(_BOX_SCANS)
                    .select("line_id, external_id")
                    .eq("upload_id", upload_id)
                    .eq("box_number", int(box_number))
                    .order("id")
                    .range(offset, offset + 1000)
                    .execute()
                )
            except Exception as exc:
                if _is_missing_table(exc):
                    return [], set()
                _raise_persist_error(exc)
            chunk = list(response.data or [])
            for row in chunk:
                line_id = str(row.get("line_id") or "")
                if line_id:
                    if line_id not in seen:
                        seen.add(line_id)
                        line_ids.append(line_id)
                    continue
                code = strip_upc_label(str(row.get("external_id") or ""))
                if code:
                    unknown.add(code)
            if len(chunk) < 1000:
                return line_ids, unknown
            offset += 1000

    def counted_in_box(
        self,
        upload_id: str,
        box_number: int,
        line_counts: Dict[str, int],
        unknown_counts: Dict[str, int],
    ) -> Tuple[Dict[str, int], Dict[str, int]]:
        """Counted units that belong to this box, per line and per unknown barcode."""
        line_ids = [line_id for line_id, counted in line_counts.items() if line_id and counted > 0]
        unknown_ids = [code for code, counted in unknown_counts.items() if code and counted > 0]
        return (
            counts_kept_in_box(
                self._scan_rows(upload_id, column="line_id", values=line_ids),
                box_number,
                line_counts,
                "line_id",
            ),
            counts_kept_in_box(
                self._scan_rows(upload_id, column="external_id", values=unknown_ids),
                box_number,
                unknown_counts,
                "external_id",
            ),
        )

    def _scan_rows(self, upload_id: str, *, column: str, values: List[str]) -> List[dict]:
        if not upload_id or not values:
            return []
        rows: List[dict] = []
        for start in range(0, len(values), 100):
            chunk = values[start : start + 100]
            offset = 0
            while True:
                try:
                    response = (
                        self.db.table(_BOX_SCANS)
                        .select("id, line_id, external_id, box_number, created_at")
                        .eq("upload_id", upload_id)
                        .in_(column, chunk)
                        .order("created_at")
                        .order("id")
                        .range(offset, offset + 1000)
                        .execute()
                    )
                except Exception as exc:
                    if _is_missing_table(exc):
                        return rows
                    _raise_persist_error(exc)
                page = list(response.data or [])
                rows.extend(page)
                if len(page) < 1000:
                    break
                offset += 1000
        return rows

    def _list_lines_by_id(
        self,
        upload_id: str,
        line_ids: List[str],
        *,
        limit: int,
        offset: int,
        search: Optional[str],
    ) -> Tuple[List[dict], int]:
        ids = [line_id for line_id in line_ids if line_id]
        if not ids:
            return [], 0
        rows: List[dict] = []
        for start in range(0, len(ids), 100):
            chunk = ids[start : start + 100]
            query = self.db.table(_LINES).select("*").eq("upload_id", upload_id).in_("id", chunk)
            query = self._apply_line_search(query, search)
            response = query.execute()
            rows.extend(response.data or [])
        rows.sort(key=lambda row: (int(row.get("line_number") or 0), str(row.get("id") or "")))
        return rows[offset : offset + limit], len(rows)

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
        shipment_name: str = "",
    ) -> dict:
        payload = {
            "shipment_id": shipment_id,
            "shipment_name": shipment_name,
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

    def counts_for_lines(self, line_ids: List[str], user_id: Optional[str] = None) -> Dict[str, int]:
        """Counted total for each line. Missing table reads as zero.

        Counts belong to the shipment, so by default every person's scans are added up and
        everyone who can open the shipment sees the same numbers. Pass ``user_id`` to limit
        the total to one person's scans.
        """
        ids = [line_id for line_id in line_ids if line_id]
        if not ids:
            return {}
        found: Dict[str, int] = {}
        for start in range(0, len(ids), 200):
            chunk = ids[start : start + 200]
            offset = 0
            while True:
                try:
                    query = self.db.table(_COUNTS).select("line_id, counted").in_("line_id", chunk)
                    if user_id:
                        query = query.eq("user_id", user_id)
                    response = query.order("id").range(offset, offset + 1000).execute()
                except Exception as exc:
                    if _is_missing_table(exc):
                        return {}
                    _raise_persist_error(exc)
                rows = list(response.data or [])
                for row in rows:
                    key = str(row.get("line_id") or "")
                    found[key] = found.get(key, 0) + int(row.get("counted") or 0)
                if len(rows) < 1000:
                    break
                offset += 1000
        return found

    def counter_user_ids(self, upload_id: str) -> List[str]:
        """Everyone who has scanned on this shipment, in first-scan order."""
        if not upload_id:
            return []
        ids: List[str] = []
        for table in (_COUNTS, _UNKNOWNS, _BOX_SCANS):
            offset = 0
            while True:
                try:
                    response = (
                        self.db.table(table)
                        .select("user_id")
                        .eq("upload_id", upload_id)
                        .order("id")
                        .range(offset, offset + 1000)
                        .execute()
                    )
                except Exception as exc:
                    if _is_missing_table(exc):
                        break
                    _raise_persist_error(exc)
                rows = list(response.data or [])
                for row in rows:
                    user = str(row.get("user_id") or "")
                    if user and user not in ids:
                        ids.append(user)
                if len(rows) < 1000:
                    break
                offset += 1000
        return ids

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

    def decrement_count(self, line_id: str, user_id: Optional[str] = None) -> None:
        """Remove one counted unit from a shipment line. Prefer the scanner who saved it."""
        self._decrement_rows(_COUNTS, "line_id", line_id, user_id=user_id)

    def get_box_scan(self, upload_id: str, scan_id: str) -> Optional[dict]:
        try:
            response = (
                self.db.table(_BOX_SCANS)
                .select("id, user_id, line_id, external_id, box_number")
                .eq("upload_id", upload_id)
                .eq("id", scan_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        rows = response.data or []
        return rows[0] if rows else None

    def remove_box_scan(self, upload_id: str, scan_id: str) -> None:
        try:
            self.db.table(_BOX_SCANS).delete().eq("upload_id", upload_id).eq("id", scan_id).execute()
        except Exception as exc:
            _raise_persist_error(exc)

    def list_unknown_scans(self, upload_id: str, user_id: Optional[str] = None) -> List[dict]:
        """Barcodes scanned that are not on the shipment, newest first.

        Everyone's scans of the same barcode are added into one row. Pass ``user_id`` to
        limit the list to one person's scans.
        """
        if not upload_id:
            return []
        rows: List[dict] = []
        offset = 0
        while True:
            try:
                query = self.db.table(_UNKNOWNS).select("*").eq("upload_id", upload_id)
                if user_id:
                    query = query.eq("user_id", user_id)
                response = (
                    query.order("updated_at", desc=True)
                    .order("id")
                    .range(offset, offset + 1000)
                    .execute()
                )
            except Exception as exc:
                if _is_missing_table(exc):
                    return []
                _raise_persist_error(exc)
            chunk = list(response.data or [])
            rows.extend(chunk)
            if len(chunk) < 1000:
                break
            offset += 1000
        merged: Dict[str, dict] = {}
        for row in rows:
            key = str(row.get("external_id") or "")
            if key in merged:
                merged[key]["counted"] = int(merged[key].get("counted") or 0) + int(row.get("counted") or 0)
            else:
                merged[key] = {**row, "counted": int(row.get("counted") or 0)}
        return list(merged.values())

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

    def decrement_unknown_scan(self, upload_id: str, external_id: str, user_id: Optional[str] = None) -> None:
        """Remove one counted unit of a barcode that is not on the shipment."""
        self._decrement_rows(
            _UNKNOWNS,
            "external_id",
            external_id,
            upload_id=upload_id,
            user_id=user_id,
        )

    def _decrement_rows(
        self,
        table: str,
        key_column: str,
        key_value: str,
        *,
        upload_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> None:
        for _ in range(5):
            try:
                query = self.db.table(table).select("id, user_id, counted").eq(key_column, key_value)
                if upload_id:
                    query = query.eq("upload_id", upload_id)
                response = query.execute()
            except Exception as exc:
                _raise_persist_error(exc)
            rows = [row for row in (response.data or []) if int(row.get("counted") or 0) > 0]
            if not rows:
                raise ValueError("That unit was not found.")
            preferred = [row for row in rows if user_id and str(row.get("user_id") or "") == str(user_id)]
            target = (preferred or rows)[0]
            current = int(target.get("counted") or 0)
            try:
                if current <= 1:
                    self.db.table(table).delete().eq("id", target["id"]).execute()
                    return
                updated = (
                    self.db.table(table)
                    .update(
                        {
                            "counted": current - 1,
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                    .eq("id", target["id"])
                    .eq("counted", current)
                    .execute()
                )
            except Exception as exc:
                _raise_persist_error(exc)
            if updated.data:
                return
        raise ValueError("Could not remove that unit. Try again.")

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

    def get_line(self, upload_id: str, line_id: str) -> Optional[dict]:
        response = (
            self.db.table(_LINES)
            .select("id, external_id, shipped")
            .eq("upload_id", upload_id)
            .eq("id", line_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return rows[0] if rows else None

    def list_line_box_scans(self, upload_id: str, line_id: str) -> List[dict]:
        """Box rows saved for one shipment line, oldest first."""
        return self._list_box_scan_rows(upload_id, line_id=line_id)

    def unknown_scan_total(self, upload_id: str, row_id: str) -> Optional[tuple[str, int]]:
        """External-id and combined count for one not-in-list row, without reading every unknown scan."""
        try:
            found = (
                self.db.table(_UNKNOWNS)
                .select("external_id")
                .eq("upload_id", upload_id)
                .eq("id", row_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        rows = found.data or []
        if not rows:
            return None
        external_id = str(rows[0].get("external_id") or "")
        try:
            counted_rows = (
                self.db.table(_UNKNOWNS)
                .select("counted")
                .eq("upload_id", upload_id)
                .eq("external_id", external_id)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        total = sum(int(row.get("counted") or 0) for row in (counted_rows.data or []))
        return external_id, total

    def list_unknown_box_scans(self, upload_id: str, external_id: str) -> List[dict]:
        """Box rows for a barcode that is not on the shipment, oldest first."""
        return self._list_box_scan_rows(upload_id, external_id=external_id, line_id=None)

    def update_box_number(self, upload_id: str, scan_id: str, box_number: int) -> dict:
        try:
            response = (
                self.db.table(_BOX_SCANS)
                .update({"box_number": int(box_number)})
                .eq("upload_id", upload_id)
                .eq("id", scan_id)
                .execute()
            )
        except Exception as exc:
            _raise_persist_error(exc)
        rows = response.data or []
        if not rows:
            raise ValueError("That unit was not found.")
        return rows[0]

    def _list_box_scan_rows(
        self,
        upload_id: str,
        *,
        line_id: Optional[str] = None,
        external_id: Optional[str] = None,
    ) -> List[dict]:
        rows: List[dict] = []
        offset = 0
        while True:
            try:
                query = (
                    self.db.table(_BOX_SCANS)
                    .select("id, external_id, line_id, box_number, created_at")
                    .eq("upload_id", upload_id)
                )
                if external_id is not None:
                    query = query.eq("external_id", external_id)
                if line_id is None and external_id is not None:
                    query = query.is_("line_id", "null")
                elif line_id is not None:
                    query = query.eq("line_id", line_id)
                response = query.order("created_at").order("id").range(offset, offset + 1000).execute()
            except Exception as exc:
                if _is_missing_table(exc):
                    return []
                _raise_persist_error(exc)
            chunk = list(response.data or [])
            rows.extend(chunk)
            if len(chunk) < 1000:
                return rows
            offset += 1000

    def delete_box_scan(self, box_scan_id: str) -> None:
        """Undo a box record when the matching count could not be saved."""
        if not box_scan_id:
            return
        try:
            self.db.table(_BOX_SCANS).delete().eq("id", box_scan_id).execute()
        except Exception:
            logger.exception("Failed to roll back FBA box scan %s", box_scan_id)

    def list_box_scans(self, upload_id: str, user_id: Optional[str] = None) -> List[dict]:
        """Box scans for the shipment, oldest first. Missing table reads as empty.

        Includes every person's scans unless ``user_id`` limits it to one person.
        """
        if not upload_id:
            return []
        rows: List[dict] = []
        offset = 0
        while True:
            try:
                query = (
                    self.db.table(_BOX_SCANS)
                    .select("external_id, box_number, created_at")
                    .eq("upload_id", upload_id)
                )
                if user_id:
                    query = query.eq("user_id", user_id)
                response = (
                    query.order("created_at")
                    .order("id")
                    .range(offset, offset + 1000)
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

    def box_number_counts(self, upload_id: str) -> dict[int, int]:
        """How many saved units sit in each box number."""
        counts: dict[int, int] = {}
        for scan in self.list_box_scans(upload_id):
            raw = scan.get("box_number")
            if raw is None:
                continue
            number = int(raw)
            counts[number] = counts.get(number, 0) + 1
        return counts

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
