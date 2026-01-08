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
    
    def add_map(self, upc: str, map_price: Decimal) -> bool:
        """
        Add or update a MAP entry.
        
        Returns:
            True if added, False if updated
        """
        try:
            # Try to insert first
            result = self.db.table(self.table).insert({
                "upc": upc,
                "map_price": float(map_price)
            }).execute()
            return True
        except Exception as e:
            error_str = str(e)
            if "duplicate" in error_str.lower() or "unique" in error_str.lower():
                # Update existing entry
                self.db.table(self.table).update({
                    "map_price": float(map_price),
                    "updated_at": "now()"
                }).eq("upc", upc).execute()
                return False
            raise
    
    def add_maps_bulk(self, maps: List[dict]) -> dict:
        """
        Add multiple MAP entries in bulk using upsert for performance.
        
        Args:
            maps: List of dicts with 'upc' and 'map_price' keys
            
        Returns:
            Dict with counts of added, updated, and invalid entries
        """
        if not maps:
            return {"added": 0, "updated": 0, "invalid": 0, "errors": None}
        
        # Prepare data for bulk upsert
        valid_entries = []
        invalid_count = 0
        
        for map_entry in maps:
            try:
                upc = map_entry.get('upc', '').strip()
                map_price = map_entry.get('map_price')
                
                if not upc:
                    invalid_count += 1
                    continue
                
                try:
                    price = Decimal(str(map_price))
                    if price < 0:
                        invalid_count += 1
                        continue
                    
                    valid_entries.append({
                        "upc": upc,
                        "map_price": float(price)
                    })
                except (ValueError, TypeError):
                    invalid_count += 1
            except Exception:
                invalid_count += 1
        
        if not valid_entries:
            return {"added": 0, "updated": 0, "invalid": invalid_count, "errors": None}
        
        # Process in batches of 500 for optimal performance
        batch_size = 500
        total_processed = 0
        errors = []
        
        for i in range(0, len(valid_entries), batch_size):
            batch = valid_entries[i:i + batch_size]
            try:
                # Use upsert - Supabase will handle ON CONFLICT automatically
                # The unique constraint on 'upc' will trigger updates for duplicates
                result = self.db.table(self.table).upsert(batch).execute()
                total_processed += len(batch)
                self.logger.info(f"Processed batch of {len(batch)} MAP entries")
            except Exception as e:
                # Fallback: process batch individually if bulk fails
                self.logger.warning(f"Bulk upsert failed for batch, processing individually: {str(e)}")
                for entry in batch:
                    try:
                        self.db.table(self.table).upsert([entry]).execute()
                        total_processed += 1
                    except Exception as entry_error:
                        errors.append(f"UPC {entry.get('upc', 'unknown')}: {str(entry_error)}")
        
        # For upsert, we can't easily distinguish added vs updated without additional queries
        # Return estimated counts (assume 50/50 split for simplicity, or all as added)
        # In practice, upsert processes all entries (inserts new, updates existing)
        return {
            "added": total_processed,  # All processed entries
            "updated": 0,  # Can't distinguish with upsert without additional queries
            "invalid": invalid_count,
            "errors": errors if errors else None
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

