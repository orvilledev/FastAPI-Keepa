"""Repository for MAP database operations."""
from typing import List
from decimal import Decimal
from supabase import Client
from fastapi import HTTPException
import logging


class MAPRepository:
    """Repository for map_prices table operations."""
    
    def __init__(self, db: Client):
        self.db = db
        self.table = "map_prices"
        self.logger = logging.getLogger(__name__)
    
    def list_maps(self, limit: int = 100, offset: int = 0, search_upc: str = None) -> List[dict]:
        """List MAP entries with pagination and optional UPC search."""
        query = self.db.table(self.table).select("*")
        
        # If search term provided, filter by UPC (case-insensitive partial match)
        if search_upc and search_upc.strip():
            query = query.ilike("upc", f"%{search_upc.strip()}%")
        
        response = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        return response.data
    
    def search_maps_count(self, search_upc: str = None) -> int:
        """Get count of MAP entries matching search criteria."""
        query = self.db.table(self.table).select("id", count="exact")
        
        if search_upc and search_upc.strip():
            query = query.ilike("upc", f"%{search_upc.strip()}%")
        
        response = query.limit(0).execute()
        return response.count if hasattr(response, 'count') else len(response.data)
    
    def get_map_count(self) -> int:
        """Get total count of MAP entries."""
        response = self.db.table(self.table).select("id", count="exact").limit(0).execute()
        return response.count if hasattr(response, 'count') else len(response.data)
    
    def get_map_by_upc(self, upc: str) -> dict:
        """Get MAP entry by UPC."""
        response = self.db.table(self.table).select("*").eq("upc", upc).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="MAP entry not found")
        return response.data[0]
    
    def map_exists(self, upc: str) -> bool:
        """Check if a MAP entry already exists for the given UPC."""
        response = self.db.table(self.table).select("id").eq("upc", upc).limit(1).execute()
        return len(response.data) > 0
    
    def add_map(self, upc: str, map_price: Decimal) -> bool:
        """
        Add a MAP entry.
        
        Returns:
            True if added, raises HTTPException if duplicate
        """
        # Check if MAP entry already exists
        if self.map_exists(upc):
            raise HTTPException(
                status_code=400,
                detail=f"MAP entry for UPC {upc} already exists in the database"
            )
        
        try:
            # Try to insert
            result = self.db.table(self.table).insert({
                "upc": upc,
                "map_price": float(map_price)
            }).execute()
            return True
        except Exception as e:
            error_str = str(e)
            if "duplicate" in error_str.lower() or "unique" in error_str.lower():
                raise HTTPException(
                    status_code=400,
                    detail=f"MAP entry for UPC {upc} already exists in the database"
                )
            raise
    
    def _fetch_existing_upcs(self, upcs: List[str]) -> set:
        """
        Fetch all UPCs that already exist in the database using batch queries.
        Returns a set of existing UPC strings.
        """
        existing = set()
        batch_size = 1000
        for i in range(0, len(upcs), batch_size):
            chunk = upcs[i:i + batch_size]
            response = (
                self.db.table(self.table)
                .select("upc")
                .in_("upc", chunk)
                .execute()
            )
            for row in response.data:
                existing.add(row["upc"])
        return existing

    def check_duplicates(self, maps: List[dict]) -> List[str]:
        """
        Check which UPCs in the provided list already exist in the database.
        Uses a single batch query instead of per-UPC lookups.
        """
        if not maps:
            return []

        upcs = [m.get("upc", "").strip() for m in maps if m.get("upc", "").strip()]
        if not upcs:
            return []

        existing = self._fetch_existing_upcs(upcs)
        return [upc for upc in upcs if upc in existing]
    
    def add_maps_bulk(self, maps: List[dict], replace_duplicates: bool = False) -> dict:
        """
        Add multiple MAP entries in bulk using batch operations.
        Uses a single query to check all duplicates instead of per-UPC lookups.
        """
        if not maps:
            return {"added": 0, "rejected": 0, "invalid": 0, "errors": None, "duplicate_upcs": None}

        valid_entries = []
        invalid_count = 0

        for map_entry in maps:
            try:
                upc = map_entry.get("upc", "").strip()
                map_price = map_entry.get("map_price")
                if not upc:
                    invalid_count += 1
                    continue
                try:
                    price = Decimal(str(map_price))
                    if price < 0:
                        invalid_count += 1
                        continue
                    valid_entries.append({"upc": upc, "map_price": float(price)})
                except (ValueError, TypeError):
                    invalid_count += 1
            except Exception:
                invalid_count += 1

        if not valid_entries:
            return {"added": 0, "rejected": 0, "invalid": invalid_count, "errors": None, "duplicate_upcs": None}

        all_upcs = [e["upc"] for e in valid_entries]
        existing_upcs = self._fetch_existing_upcs(all_upcs)

        duplicate_upcs = [upc for upc in all_upcs if upc in existing_upcs]
        errors = []

        if replace_duplicates:
            entries_to_write = valid_entries
        else:
            entries_to_write = [e for e in valid_entries if e["upc"] not in existing_upcs]
            if duplicate_upcs:
                errors = [f"UPC {upc}: MAP entry already exists" for upc in duplicate_upcs]

        if not entries_to_write:
            return {
                "added": 0,
                "rejected": len(duplicate_upcs),
                "invalid": invalid_count,
                "errors": errors if errors else None,
                "duplicate_upcs": duplicate_upcs if duplicate_upcs else None,
            }

        total_added = 0
        batch_errors = []
        batch_size = 500

        for i in range(0, len(entries_to_write), batch_size):
            batch = entries_to_write[i:i + batch_size]
            try:
                if replace_duplicates:
                    self.db.table(self.table).upsert(batch).execute()
                else:
                    self.db.table(self.table).insert(batch).execute()
                total_added += len(batch)
                self.logger.info(f"Processed batch of {len(batch)} MAP entries")
            except Exception as e:
                self.logger.warning(f"Bulk insert failed for batch, processing individually: {e}")
                for entry in batch:
                    try:
                        if replace_duplicates:
                            self.db.table(self.table).upsert([entry]).execute()
                        else:
                            self.db.table(self.table).insert([entry]).execute()
                        total_added += 1
                    except Exception as entry_error:
                        error_str = str(entry_error)
                        if "duplicate" in error_str.lower() or "unique" in error_str.lower():
                            duplicate_upcs.append(entry.get("upc", "unknown"))
                            batch_errors.append(f"UPC {entry.get('upc', 'unknown')}: already exists")
                        else:
                            batch_errors.append(f"UPC {entry.get('upc', 'unknown')}: {error_str}")

        all_errors = errors + batch_errors if batch_errors else errors

        self.logger.info(f"Bulk MAP add complete: {total_added} added, {len(duplicate_upcs)} duplicates, {invalid_count} invalid")
        return {
            "added": total_added,
            "rejected": len(duplicate_upcs),
            "invalid": invalid_count,
            "errors": all_errors if all_errors else None,
            "duplicate_upcs": duplicate_upcs if duplicate_upcs else None,
        }
    
    def delete_map(self, upc: str) -> bool:
        """Delete a MAP entry."""
        result = self.db.table(self.table).delete().eq("upc", upc).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="MAP entry not found")
        return True
    
    def delete_all_maps(self) -> None:
        """Delete all MAP entries."""
        self.db.table(self.table).delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

