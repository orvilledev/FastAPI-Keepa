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
_FOLDERS = "shipment_folders"
_STARS = "shipment_stars"
_MIGRATION_HINT = (
    "Run backend/database/migrations/create_shipments.sql in the Supabase SQL Editor."
)
_VENDOR_MIGRATION_HINT = (
    "Run backend/database/migrations/add_shipments_vendor.sql in the Supabase SQL Editor."
)
_STATUS_MIGRATION_HINT = (
    "Run backend/database/migrations/add_shipments_status.sql in the Supabase SQL Editor."
)
_CHECKLIST_MIGRATION_HINT = (
    "Run backend/database/migrations/add_shipments_checklist.sql in the Supabase SQL Editor."
)
_FOLDER_MIGRATION_HINT = (
    "Run backend/database/migrations/create_shipment_folders.sql in the Supabase SQL Editor."
)
_LEDGER_URL_MIGRATION_HINT = (
    "Run backend/database/migrations/add_shipment_folder_ledger_url.sql in the Supabase SQL Editor."
)
_SORT_ORDER_MIGRATION_HINT = (
    "Run backend/database/migrations/add_shipment_sort_order.sql in the Supabase SQL Editor."
)
_STARS_MIGRATION_HINT = (
    "Run backend/database/migrations/create_shipment_stars.sql in the Supabase SQL Editor."
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
        if table == _FOLDERS:
            hint = _FOLDER_MIGRATION_HINT
        elif table == _STARS:
            hint = _STARS_MIGRATION_HINT
        else:
            hint = _MIGRATION_HINT
        raise ValueError(f"The {table} table is missing. {hint}") from exc
    missing_vendor = table == _SHIPMENTS and "vendor" in message and (
        "column" in message
        or "schema cache" in message
        or "pgrst204" in message
        or "could not find" in message
    )
    if missing_vendor:
        raise ValueError(
            f"The shipments.vendor column is missing. {_VENDOR_MIGRATION_HINT}"
        ) from exc
    missing_status = table == _SHIPMENTS and "status" in message and (
        "column" in message
        or "schema cache" in message
        or "pgrst204" in message
        or "could not find" in message
    )
    if missing_status:
        raise ValueError(
            f"The shipments.status column is missing. {_STATUS_MIGRATION_HINT}"
        ) from exc
    missing_checklist = table == _SHIPMENTS and "checklist" in message and (
        "column" in message
        or "schema cache" in message
        or "pgrst204" in message
        or "could not find" in message
    )
    if missing_checklist:
        raise ValueError(
            f"The shipments.checklist column is missing. {_CHECKLIST_MIGRATION_HINT}"
        ) from exc
    missing_sort = "sort_order" in message and (
        "column" in message
        or "schema cache" in message
        or "pgrst204" in message
        or "could not find" in message
    )
    if missing_sort:
        raise ValueError(
            f"Shipment sort order is not set up yet. {_SORT_ORDER_MIGRATION_HINT}"
        ) from exc
    missing_ledger = table == _FOLDERS and "ledger_url" in message and (
        "column" in message
        or "schema cache" in message
        or "pgrst204" in message
        or "could not find" in message
    )
    if missing_ledger:
        raise ValueError(
            f"Shipment cluster ledgers are not set up yet. {_LEDGER_URL_MIGRATION_HINT}"
        ) from exc
    missing_folder = (
        (table == _SHIPMENTS and "folder_id" in message)
        or (table == _FOLDERS)
    ) and (
        "column" in message
        or "schema cache" in message
        or "pgrst204" in message
        or "pgrst205" in message
        or "could not find" in message
        or "does not exist" in message
        or "relation" in message
    )
    if missing_folder:
        raise ValueError(
            f"Shipment folders are not set up yet. {_FOLDER_MIGRATION_HINT}"
        ) from exc
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
                self.db.table(_SHIPMENTS)
                .select("*")
                .order("sort_order")
                .order("created_at", desc=True)
                .execute()
            )
        except Exception as exc:
            # Older DBs without sort_order still list by created_at.
            message = str(exc).lower()
            if "sort_order" in message:
                try:
                    response = (
                        self.db.table(_SHIPMENTS)
                        .select("*")
                        .order("created_at", desc=True)
                        .execute()
                    )
                except Exception as inner:
                    logger.error("shipment list failed: %s", inner, exc_info=True)
                    _raise_persist_error(inner, _SHIPMENTS)
            else:
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

    # ---- folders -------------------------------------------------------

    def list_folders(self) -> List[dict]:
        try:
            response = (
                self.db.table(_FOLDERS)
                .select("*")
                .order("sort_order")
                .order("name")
                .execute()
            )
        except Exception as exc:
            message = str(exc).lower()
            if "sort_order" in message:
                try:
                    response = (
                        self.db.table(_FOLDERS).select("*").order("name", desc=False).execute()
                    )
                except Exception as inner:
                    logger.error("shipment folder list failed: %s", inner, exc_info=True)
                    _raise_persist_error(inner, _FOLDERS)
            else:
                logger.error("shipment folder list failed: %s", exc, exc_info=True)
                _raise_persist_error(exc, _FOLDERS)
        return response.data or []

    def next_folder_sort_order(self) -> int:
        folders = self.list_folders()
        if not folders:
            return 0
        return max(int(item.get("sort_order") or 0) for item in folders) + 1

    def next_shipment_sort_order(self, folder_id: Optional[str] = None) -> int:
        shipments = self.list_shipments()
        siblings = [
            item
            for item in shipments
            if (str(item.get("folder_id") or "") or None) == (folder_id or None)
        ]
        if not siblings:
            return 0
        return max(int(item.get("sort_order") or 0) for item in siblings) + 1

    def move_folder(self, folder_id: str, direction: str) -> List[dict]:
        folders = sorted(
            self.list_folders(),
            key=lambda item: (int(item.get("sort_order") or 0), str(item.get("name") or "")),
        )
        index = next(
            (i for i, item in enumerate(folders) if str(item.get("id")) == str(folder_id)),
            None,
        )
        if index is None:
            raise ValueError("Folder not found.")
        swap_index = index - 1 if direction == "up" else index + 1
        if swap_index < 0 or swap_index >= len(folders):
            return folders
        left, right = folders[index], folders[swap_index]
        left_order = int(left.get("sort_order") or index)
        right_order = int(right.get("sort_order") or swap_index)
        self.update_folder(str(left["id"]), {"sort_order": right_order})
        self.update_folder(str(right["id"]), {"sort_order": left_order})
        return self.list_folders()

    def move_shipment(self, shipment_id: str, direction: str) -> List[dict]:
        shipment = self.get_shipment(shipment_id)
        if not shipment:
            raise ValueError("Shipment not found.")
        folder_key = str(shipment.get("folder_id") or "") or None
        siblings = [
            item
            for item in self.list_shipments()
            if (str(item.get("folder_id") or "") or None) == folder_key
        ]
        siblings.sort(
            key=lambda item: (
                int(item.get("sort_order") or 0),
                str(item.get("created_at") or ""),
            )
        )
        index = next(
            (i for i, item in enumerate(siblings) if str(item.get("id")) == str(shipment_id)),
            None,
        )
        if index is None:
            raise ValueError("Shipment not found.")
        swap_index = index - 1 if direction == "up" else index + 1
        if swap_index < 0 or swap_index >= len(siblings):
            return siblings
        left, right = siblings[index], siblings[swap_index]
        left_order = int(left.get("sort_order") or index)
        right_order = int(right.get("sort_order") or swap_index)
        self.update_shipment(str(left["id"]), {"sort_order": right_order})
        self.update_shipment(str(right["id"]), {"sort_order": left_order})
        return [
            item
            for item in self.list_shipments()
            if (str(item.get("folder_id") or "") or None) == folder_key
        ]

    def get_folder(self, folder_id: str) -> Optional[dict]:
        try:
            response = (
                self.db.table(_FOLDERS).select("*").eq("id", folder_id).limit(1).execute()
            )
        except Exception as exc:
            logger.error("shipment folder fetch failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _FOLDERS)
        rows = response.data or []
        return rows[0] if rows else None

    def create_folder(self, row: Dict[str, Any]) -> dict:
        try:
            response = self.db.table(_FOLDERS).insert(row).execute()
        except Exception as exc:
            logger.error("shipment folder create failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _FOLDERS)
        data = response.data or []
        if not data:
            raise ValueError(f"The folder could not be saved. {_FOLDER_MIGRATION_HINT}")
        return data[0]

    def update_folder(self, folder_id: str, patch: Dict[str, Any]) -> Optional[dict]:
        patch = dict(patch)
        patch["updated_at"] = datetime.utcnow().isoformat()
        try:
            response = (
                self.db.table(_FOLDERS).update(patch).eq("id", folder_id).execute()
            )
        except Exception as exc:
            logger.error("shipment folder update failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _FOLDERS)
        rows = response.data or []
        return rows[0] if rows else None

    def delete_folder(self, folder_id: str) -> None:
        # Clear memberships first so the folder never leaves orphaned folder_ids
        # if ON DELETE SET NULL is missing on an older database.
        try:
            self.db.table(_SHIPMENTS).update({"folder_id": None}).eq(
                "folder_id", folder_id
            ).execute()
        except Exception as exc:
            logger.error("shipment folder clear failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _SHIPMENTS)
        try:
            self.db.table(_FOLDERS).delete().eq("id", folder_id).execute()
        except Exception as exc:
            logger.error("shipment folder delete failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _FOLDERS)

    def set_shipments_folder(self, shipment_ids: List[str], folder_id: Optional[str]) -> None:
        if not shipment_ids:
            return
        try:
            self.db.table(_SHIPMENTS).update(
                {"folder_id": folder_id, "updated_at": datetime.utcnow().isoformat()}
            ).in_("id", shipment_ids).execute()
        except Exception as exc:
            logger.error("shipment folder assign failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _SHIPMENTS)

    # ---- stars (per-user follows) --------------------------------------

    def list_stars_for_user(self, user_id: str) -> List[dict]:
        try:
            response = (
                self.db.table(_STARS)
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .execute()
            )
        except Exception as exc:
            logger.error("shipment stars list failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _STARS)
        return response.data or []

    def star_sets_for_user(self, user_id: str) -> Tuple[set[str], set[str]]:
        """Return (starred_shipment_ids, starred_folder_ids) for this user."""
        try:
            rows = self.list_stars_for_user(user_id)
        except ValueError as exc:
            # Stars table optional until migration runs.
            if "shipment_stars" in str(exc).lower() or "not set up" in str(exc).lower() or "missing" in str(exc).lower():
                return set(), set()
            raise
        shipment_ids: set[str] = set()
        folder_ids: set[str] = set()
        for row in rows:
            if row.get("shipment_id"):
                shipment_ids.add(str(row["shipment_id"]))
            if row.get("folder_id"):
                folder_ids.add(str(row["folder_id"]))
        return shipment_ids, folder_ids

    def add_shipment_star(self, user_id: str, shipment_id: str) -> dict:
        try:
            existing = (
                self.db.table(_STARS)
                .select("*")
                .eq("user_id", user_id)
                .eq("shipment_id", shipment_id)
                .limit(1)
                .execute()
            )
            if existing.data:
                return existing.data[0]
            response = (
                self.db.table(_STARS)
                .insert({"user_id": user_id, "shipment_id": shipment_id})
                .execute()
            )
        except Exception as exc:
            logger.error("shipment star insert failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _STARS)
        data = response.data or []
        if not data:
            raise ValueError(f"Could not star this shipment. {_STARS_MIGRATION_HINT}")
        return data[0]

    def add_folder_star(self, user_id: str, folder_id: str) -> dict:
        try:
            existing = (
                self.db.table(_STARS)
                .select("*")
                .eq("user_id", user_id)
                .eq("folder_id", folder_id)
                .limit(1)
                .execute()
            )
            if existing.data:
                return existing.data[0]
            response = (
                self.db.table(_STARS)
                .insert({"user_id": user_id, "folder_id": folder_id})
                .execute()
            )
        except Exception as exc:
            logger.error("folder star insert failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _STARS)
        data = response.data or []
        if not data:
            raise ValueError(f"Could not star this folder. {_STARS_MIGRATION_HINT}")
        return data[0]

    def remove_shipment_star(self, user_id: str, shipment_id: str) -> None:
        try:
            self.db.table(_STARS).delete().eq("user_id", user_id).eq(
                "shipment_id", shipment_id
            ).execute()
        except Exception as exc:
            logger.error("shipment star delete failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _STARS)

    def remove_folder_star(self, user_id: str, folder_id: str) -> None:
        try:
            self.db.table(_STARS).delete().eq("user_id", user_id).eq(
                "folder_id", folder_id
            ).execute()
        except Exception as exc:
            logger.error("folder star delete failed: %s", exc, exc_info=True)
            _raise_persist_error(exc, _STARS)

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
                .select("shipment_id, uploaded_by, row_count, total_units")
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
        """All collected rows, upload by upload (oldest first), then original file order."""
        return self.list_rows_merged(shipment_id)

    def list_rows_for_upload(self, upload_id: str) -> List[dict]:
        rows: List[dict] = []
        offset = 0
        page = 1000
        while True:
            try:
                response = (
                    self.db.table(_ROWS)
                    .select("*")
                    .eq("upload_id", upload_id)
                    .order("row_index")
                    .range(offset, offset + page - 1)
                    .execute()
                )
            except Exception as exc:
                logger.error("shipment rows by upload failed: %s", exc, exc_info=True)
                _raise_persist_error(exc, _ROWS)
            chunk = response.data or []
            rows.extend(chunk)
            if len(chunk) < page:
                break
            offset += page
        return rows

    def list_rows_merged(self, shipment_id: str) -> List[dict]:
        """Concatenate every upload's rows in the order the files were added."""
        uploads = self.list_uploads(shipment_id)
        merged: List[dict] = []
        for upload in uploads:
            merged.extend(self.list_rows_for_upload(str(upload["id"])))
        return merged

    def list_rows_merged_for_shipments(self, shipment_ids: List[str]) -> List[dict]:
        """Concatenate rows across shipments (caller order), each upload oldest-first."""
        merged: List[dict] = []
        for shipment_id in shipment_ids:
            merged.extend(self.list_rows_merged(shipment_id))
        return merged

    def upcs_for_shipments(self, shipment_ids: List[str]) -> Dict[str, set[str]]:
        """shipment_id -> set of UPCs, for list-view stats (paginated).

        PostgREST caps a single response; large shipments must be walked in pages
        or Unique UPCs undercounts (often to zero for big groups).
        """
        if not shipment_ids:
            return {}
        grouped: Dict[str, set[str]] = {}
        offset = 0
        page = 1000
        while True:
            try:
                response = (
                    self.db.table(_ROWS)
                    .select("shipment_id, upc")
                    .in_("shipment_id", shipment_ids)
                    .limit(page)
                    .offset(offset)
                    .execute()
                )
            except Exception as exc:
                logger.error("shipment upc summary failed: %s", exc, exc_info=True)
                _raise_persist_error(exc, _ROWS)
            chunk = response.data or []
            for row in chunk:
                upc = (row.get("upc") or "").strip()
                if not upc:
                    continue
                grouped.setdefault(str(row.get("shipment_id")), set()).add(upc)
            if len(chunk) < page:
                break
            offset += page
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
