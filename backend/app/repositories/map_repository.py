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
    
    def check_duplicates(self, maps: List[dict]) -> List[str]:
        """
        Check which UPCs in the provided list already exist in the database.
        
        Args:
            maps: List of dicts with 'upc' and 'map_price' keys
            
        Returns:
            List of UPCs that already exist
        """
        if not maps:
            return []
        
        duplicate_upcs = []
        for map_entry in maps:
            upc = map_entry.get('upc', '').strip()
            if upc and self.map_exists(upc):
                duplicate_upcs.append(upc)
        
        return duplicate_upcs
    
    def add_maps_bulk(self, maps: List[dict], replace_duplicates: bool = False) -> dict:
        """
        Add multiple MAP entries in bulk, rejecting duplicates.
        
        Args:
            maps: List of dicts with 'upc' and 'map_price' keys
            
        Returns:
            Dict with counts of added, rejected (duplicates), and invalid entries
        """
        if not maps:
            return {"added": 0, "rejected": 0, "invalid": 0, "errors": None, "duplicate_upcs": None}
        
        # Prepare data and check for duplicates
        valid_entries = []
        invalid_count = 0
        duplicate_upcs = []
        errors = []
        
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
                    
                    # Check if UPC already exists
                    if self.map_exists(upc):
                        if replace_duplicates:
                            # Allow replacement - add to valid entries and track as duplicate
                            duplicate_upcs.append(upc)
                        else:
                            # Reject duplicate
                            duplicate_upcs.append(upc)
                            errors.append(f"UPC {upc}: MAP entry already exists in the database")
                            continue
                    
                    valid_entries.append({
                        "upc": upc,
                        "map_price": float(price)
                    })
                except (ValueError, TypeError):
                    invalid_count += 1
            except Exception as e:
                invalid_count += 1
        
        if not valid_entries:
            return {
                "added": 0,
                "rejected": len(duplicate_upcs),
                "invalid": invalid_count,
                "errors": errors if errors else None,
                "duplicate_upcs": duplicate_upcs if duplicate_upcs else None
            }
        
        # Process in batches of 500 for optimal performance
        batch_size = 500
        total_added = 0
        batch_errors = []
        
        for i in range(0, len(valid_entries), batch_size):
            batch = valid_entries[i:i + batch_size]
            try:
                if replace_duplicates:
                    # Use upsert to replace duplicates
                    result = self.db.table(self.table).upsert(batch).execute()
                    total_added += len(batch)
                    self.logger.info(f"Processed batch of {len(batch)} MAP entries (with replacement)")
                else:
                    # Insert batch (not upsert, to reject duplicates)
                    result = self.db.table(self.table).insert(batch).execute()
                    total_added += len(batch)
                    self.logger.info(f"Processed batch of {len(batch)} MAP entries")
            except Exception as e:
                # Fallback: process batch individually if bulk fails
                self.logger.warning(f"Bulk insert failed for batch, processing individually: {str(e)}")
                for entry in batch:
                    try:
                        if replace_duplicates:
                            # Use upsert to replace
                            self.db.table(self.table).upsert([entry]).execute()
                            total_added += 1
                        else:
                            # Double-check existence before inserting (race condition protection)
                            if self.map_exists(entry['upc']):
                                duplicate_upcs.append(entry['upc'])
                                batch_errors.append(f"UPC {entry['upc']}: MAP entry already exists in the database")
                                continue
                            
                            self.db.table(self.table).insert([entry]).execute()
                            total_added += 1
                    except Exception as entry_error:
                        error_str = str(entry_error)
                        if "duplicate" in error_str.lower() or "unique" in error_str.lower():
                            if not replace_duplicates:
                                duplicate_upcs.append(entry.get('upc', 'unknown'))
                                batch_errors.append(f"UPC {entry.get('upc', 'unknown')}: MAP entry already exists in the database")
                            else:
                                # Try upsert if replace is enabled
                                try:
                                    self.db.table(self.table).upsert([entry]).execute()
                                    total_added += 1
                                except:
                                    batch_errors.append(f"UPC {entry.get('upc', 'unknown')}: {str(entry_error)}")
                        else:
                            batch_errors.append(f"UPC {entry.get('upc', 'unknown')}: {str(entry_error)}")
        
        # Combine all errors
        all_errors = errors + batch_errors if batch_errors else errors
        
        return {
            "added": total_added,
            "rejected": len(duplicate_upcs),
            "invalid": invalid_count,
            "errors": all_errors if all_errors else None,
            "duplicate_upcs": duplicate_upcs if duplicate_upcs else None
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

