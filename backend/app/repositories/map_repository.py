"""Repository for MAP database operations."""
from typing import Dict, List, Optional
from decimal import Decimal
from supabase import Client
from fastapi import HTTPException
import logging

from app.models.map import DEFAULT_MAP_VENDOR_TYPE, MAP_VENDOR_TYPES

logger = logging.getLogger(__name__)


def _normalize_vendor_type(raw: Optional[str]) -> str:
    if raw is None or not str(raw).strip():
        return DEFAULT_MAP_VENDOR_TYPE
    return str(raw).strip().lower()


def _validate_vendor_type(vendor_type: str) -> str:
    v = _normalize_vendor_type(vendor_type)
    if v not in MAP_VENDOR_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid vendor_type '{vendor_type}'. Allowed: {', '.join(MAP_VENDOR_TYPES)}",
        )
    return v


class MAPRepository:
    """Repository for map_prices table operations."""

    def __init__(self, db: Client):
        self.db = db
        self.table = "map_prices"
        self.logger = logging.getLogger(__name__)

    def list_maps(
        self,
        limit: int = 100,
        offset: int = 0,
        search_upc: str = None,
        vendor_type: Optional[str] = None,
    ) -> List[dict]:
        """List MAP entries with pagination and optional UPC search and vendor filter."""
        query = self.db.table(self.table).select("*")

        if vendor_type and vendor_type.strip():
            query = query.eq("vendor_type", _validate_vendor_type(vendor_type))

        if search_upc and search_upc.strip():
            query = query.ilike("upc", f"%{search_upc.strip()}%")

        response = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        return response.data

    def search_maps_count(self, search_upc: str = None, vendor_type: Optional[str] = None) -> int:
        """Get count of MAP entries matching search criteria."""
        query = self.db.table(self.table).select("id", count="exact")

        if vendor_type and vendor_type.strip():
            query = query.eq("vendor_type", _validate_vendor_type(vendor_type))

        if search_upc and search_upc.strip():
            query = query.ilike("upc", f"%{search_upc.strip()}%")

        response = query.limit(0).execute()
        return response.count if hasattr(response, "count") else len(response.data)

    def get_map_count(self, vendor_type: Optional[str] = None) -> int:
        """Get total count of MAP entries, optionally filtered by vendor."""
        query = self.db.table(self.table).select("id", count="exact")
        if vendor_type and vendor_type.strip():
            query = query.eq("vendor_type", _validate_vendor_type(vendor_type))
        response = query.limit(0).execute()
        return response.count if hasattr(response, "count") else len(response.data)

    def get_map_by_upc(self, upc: str, vendor_type: str = DEFAULT_MAP_VENDOR_TYPE) -> dict:
        """Get MAP entry by UPC and vendor type."""
        v = _validate_vendor_type(vendor_type)
        response = self.db.table(self.table).select("*").eq("upc", upc).eq("vendor_type", v).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="MAP entry not found")
        return response.data[0]

    def get_map_prices_by_upcs(
        self, upcs: List[str], vendor_type: str = DEFAULT_MAP_VENDOR_TYPE
    ) -> Dict[str, Decimal]:
        """
        Batch-fetch MAP prices for the given UPCs for a single vendor type.
        UPCs with no row or non-positive map_price are omitted.
        """
        if not upcs:
            return {}
        v = _validate_vendor_type(vendor_type)
        result: Dict[str, Decimal] = {}
        batch_size = 1000
        for i in range(0, len(upcs), batch_size):
            chunk = upcs[i : i + batch_size]
            response = (
                self.db.table(self.table)
                .select("upc, map_price")
                .eq("vendor_type", v)
                .in_("upc", chunk)
                .execute()
            )
            for row in response.data or []:
                upc = row.get("upc")
                if not upc:
                    continue
                try:
                    mp = Decimal(str(row.get("map_price", 0)))
                    if mp > 0:
                        result[upc] = mp
                except Exception:
                    continue
        return result

    def map_exists(self, upc: str, vendor_type: str = DEFAULT_MAP_VENDOR_TYPE) -> bool:
        """Check if a MAP entry already exists for the given UPC and vendor."""
        v = _validate_vendor_type(vendor_type)
        response = (
            self.db.table(self.table).select("id").eq("upc", upc).eq("vendor_type", v).limit(1).execute()
        )
        return len(response.data) > 0

    def add_map(self, upc: str, map_price: Decimal, vendor_type: str = DEFAULT_MAP_VENDOR_TYPE) -> bool:
        """
        Add a MAP entry.

        Returns:
            True if added, raises HTTPException if duplicate
        """
        v = _validate_vendor_type(vendor_type)
        if self.map_exists(upc, v):
            raise HTTPException(
                status_code=400,
                detail=f"MAP entry for UPC {upc} ({v}) already exists in the database",
            )

        try:
            self.db.table(self.table).insert(
                {"upc": upc, "map_price": float(map_price), "vendor_type": v}
            ).execute()
            return True
        except Exception as e:
            error_str = str(e)
            if "duplicate" in error_str.lower() or "unique" in error_str.lower():
                raise HTTPException(
                    status_code=400,
                    detail=f"MAP entry for UPC {upc} ({v}) already exists in the database",
                )
            raise

    def _fetch_existing_keys(self, pairs: List[dict]) -> set:
        """
        pairs: list of {"upc": str, "vendor_type": str}
        Returns set of (upc, vendor_type) tuples that exist.
        """
        existing = set()
        # Group by vendor for efficient .in_ queries
        by_vendor: Dict[str, List[str]] = {}
        for p in pairs:
            u = p.get("upc", "").strip()
            v = p.get("vendor_type", DEFAULT_MAP_VENDOR_TYPE)
            if not u:
                continue
            by_vendor.setdefault(v, []).append(u)

        for v, upcs in by_vendor.items():
            batch_size = 1000
            for i in range(0, len(upcs), batch_size):
                chunk = upcs[i : i + batch_size]
                response = (
                    self.db.table(self.table)
                    .select("upc, vendor_type")
                    .eq("vendor_type", v)
                    .in_("upc", chunk)
                    .execute()
                )
                for row in response.data or []:
                    existing.add((row["upc"], row["vendor_type"]))
        return existing

    def check_duplicates(self, maps: List[dict]) -> List[str]:
        """
        Check which (upc, vendor) pairs in the provided list already exist.
        Returns human-readable duplicate descriptors: "UPC (vendor)".
        Pre-validated entries only (upc + allowed vendor_type).
        """
        if not maps:
            return []

        pairs = []
        for m in maps:
            upc = m.get("upc", "").strip()
            v = _normalize_vendor_type(m.get("vendor_type"))
            if not upc or v not in MAP_VENDOR_TYPES:
                continue
            pairs.append({"upc": upc, "vendor_type": v})

        if not pairs:
            return []

        existing = self._fetch_existing_keys(pairs)
        dups = []
        for p in pairs:
            key = (p["upc"], p["vendor_type"])
            if key in existing:
                dups.append(f'{p["upc"]} ({p["vendor_type"]})')
        return dups

    def add_maps_bulk(self, maps: List[dict], replace_duplicates: bool = False) -> dict:
        """Add multiple MAP entries in bulk."""
        if not maps:
            return {"added": 0, "rejected": 0, "invalid": 0, "errors": None, "duplicate_upcs": None}

        valid_entries = []
        invalid_count = 0

        for map_entry in maps:
            try:
                upc = map_entry.get("upc", "").strip()
                map_price = map_entry.get("map_price")
                vendor_raw = map_entry.get("vendor_type", DEFAULT_MAP_VENDOR_TYPE)
                if not upc:
                    invalid_count += 1
                    continue
                try:
                    v = _validate_vendor_type(vendor_raw)
                except HTTPException:
                    invalid_count += 1
                    continue
                try:
                    price = Decimal(str(map_price))
                    if price < 0:
                        invalid_count += 1
                        continue
                    valid_entries.append({"upc": upc, "map_price": float(price), "vendor_type": v})
                except (ValueError, TypeError):
                    invalid_count += 1
            except Exception:
                invalid_count += 1

        if not valid_entries:
            return {"added": 0, "rejected": 0, "invalid": invalid_count, "errors": None, "duplicate_upcs": None}

        existing = self._fetch_existing_keys(valid_entries)

        duplicate_keys = [
            (e["upc"], e["vendor_type"])
            for e in valid_entries
            if (e["upc"], e["vendor_type"]) in existing
        ]
        errors = []

        if replace_duplicates:
            entries_to_write = valid_entries
        else:
            entries_to_write = [e for e in valid_entries if (e["upc"], e["vendor_type"]) not in existing]
            if duplicate_keys:
                errors = [f"UPC {u} ({v}): MAP entry already exists" for u, v in duplicate_keys]

        if not entries_to_write:
            return {
                "added": 0,
                "rejected": len(duplicate_keys),
                "invalid": invalid_count,
                "errors": errors if errors else None,
                "duplicate_upcs": [f"{u} ({v})" for u, v in duplicate_keys] if duplicate_keys else None,
            }

        total_added = 0
        batch_errors = []
        batch_size = 500

        for i in range(0, len(entries_to_write), batch_size):
            batch = entries_to_write[i : i + batch_size]
            try:
                if replace_duplicates:
                    self.db.table(self.table).upsert(batch, on_conflict="upc,vendor_type").execute()
                else:
                    self.db.table(self.table).insert(batch).execute()
                total_added += len(batch)
                self.logger.info(f"Processed batch of {len(batch)} MAP entries")
            except Exception as e:
                self.logger.warning(f"Bulk insert failed for batch, processing individually: {e}")
                for entry in batch:
                    try:
                        if replace_duplicates:
                            self.db.table(self.table).upsert([entry], on_conflict="upc,vendor_type").execute()
                        else:
                            self.db.table(self.table).insert([entry]).execute()
                        total_added += 1
                    except Exception as entry_error:
                        error_str = str(entry_error)
                        u = entry.get("upc", "unknown")
                        v = entry.get("vendor_type", "?")
                        if "duplicate" in error_str.lower() or "unique" in error_str.lower():
                            duplicate_keys.append((u, v))
                            batch_errors.append(f"UPC {u} ({v}): already exists")
                        else:
                            batch_errors.append(f"UPC {u} ({v}): {error_str}")

        all_errors = errors + batch_errors if batch_errors else errors

        self.logger.info(
            f"Bulk MAP add complete: {total_added} added, {len(duplicate_keys)} duplicates, {invalid_count} invalid"
        )
        return {
            "added": total_added,
            "rejected": len(duplicate_keys),
            "invalid": invalid_count,
            "errors": all_errors if all_errors else None,
            "duplicate_upcs": [f"{u} ({v})" for u, v in duplicate_keys] if duplicate_keys else None,
        }

    def delete_map(self, upc: str, vendor_type: str = DEFAULT_MAP_VENDOR_TYPE) -> bool:
        """Delete a MAP entry."""
        v = _validate_vendor_type(vendor_type)
        result = self.db.table(self.table).delete().eq("upc", upc).eq("vendor_type", v).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="MAP entry not found")
        return True

    def delete_all_maps(self, vendor_type: Optional[str] = None) -> None:
        """Delete all MAP entries, or only those for a vendor when vendor_type is set."""
        q = self.db.table(self.table).delete()
        if vendor_type and str(vendor_type).strip():
            q = q.eq("vendor_type", _validate_vendor_type(vendor_type))
        q.neq("id", "00000000-0000-0000-0000-000000000000").execute()
