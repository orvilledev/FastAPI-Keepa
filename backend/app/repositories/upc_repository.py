"""Repository for UPC database operations."""
from typing import List, Tuple, Optional, Dict
from supabase import Client
from fastapi import HTTPException
import logging

logger = logging.getLogger(__name__)


class UPCRepository:
    """Repository for upcs table operations."""
    
    def __init__(self, db: Client):
        self.db = db
        self.table = "upcs"
    
    def list_upcs(self, limit: int = 100, offset: int = 0, category: Optional[str] = None) -> List[dict]:
        """List UPCs with pagination, optionally filtered by category."""
        query = self.db.table(self.table).select("*")
        
        if category:
            # Explicitly filter by category to ensure separation
            query = query.eq("category", category)
        
        response = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        
        # Double-check that all returned UPCs have the correct category (safety check)
        if category and response.data:
            filtered_data = [upc for upc in response.data if upc.get("category") == category]
            if len(filtered_data) != len(response.data):
                # Log warning if there's a mismatch
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f"Category filter mismatch: expected {category}, found {[upc.get('category') for upc in response.data]}")
            return filtered_data
        
        return response.data
    
    def get_upc_count(self, category: Optional[str] = None) -> int:
        """Get total count of UPCs, optionally filtered by category."""
        query = self.db.table(self.table).select("id", count="exact")
        
        if category:
            query = query.eq("category", category)
        
        response = query.limit(0).execute()
        return response.count if hasattr(response, 'count') else len(response.data)

    def get_all_upc_codes(self, category: str) -> List[str]:
        """
        Fetch every UPC for a category. Keyset pagination on id avoids PostgREST's
        ~1000 row cap per request and large OFFSET behavior.
        """
        page_size = 1000
        codes: List[str] = []
        last_id: Optional[str] = None
        while True:
            q = (
                self.db.table(self.table)
                .select("id, upc")
                .eq("category", category)
                .order("id")
                .limit(page_size)
            )
            if last_id is not None:
                q = q.gt("id", str(last_id))
            response = q.execute()
            rows = response.data or []
            if not rows:
                break
            for row in rows:
                if row.get("upc"):
                    codes.append(row["upc"])
            if len(rows) < page_size:
                break
            last_id = rows[-1]["id"]
        logger.info(f"Loaded {len(codes)} UPCs for category {category} (paginated)")
        return codes

    def upc_exists(self, upc: str, category: str) -> bool:
        """Check if a UPC already exists in the database for the given category."""
        response = self.db.table(self.table).select("id").eq("upc", upc).eq("category", category).limit(1).execute()
        return len(response.data) > 0
    
    def add_upc(self, upc: str, category: str = "dnk") -> bool:
        """
        Add a UPC to the database.
        
        Args:
            upc: The UPC code
            category: The category ('dnk' or 'clk')
        
        Returns:
            True if added, raises HTTPException if duplicate
        """
        # Check if UPC already exists for this category
        if self.upc_exists(upc, category):
            raise HTTPException(
                status_code=400,
                detail=f"UPC {upc} already exists in the database for category {category}"
            )
        
        try:
            insert_data = {"upc": upc, "category": category}
            result = self.db.table(self.table).insert(insert_data).execute()
            if result.data:
                # Verify the inserted data has the correct category
                inserted_category = result.data[0].get("category")
                if inserted_category != category:
                    raise ValueError(f"Category mismatch: expected {category}, got {inserted_category}")
            return bool(result.data)
        except Exception as e:
            error_str = str(e)
            if "duplicate" in error_str.lower() or "unique" in error_str.lower():
                raise HTTPException(
                    status_code=400,
                    detail=f"UPC {upc} already exists in the database for category {category}"
                )
            raise
    
    def bulk_add_upcs(self, upcs: List[str], category: str = "dnk") -> Dict:
        """
        Add multiple UPCs in bulk using batch operations.
        
        Returns dict with 'added', 'duplicates', and 'errors' counts.
        """
        if not upcs:
            return {"added": 0, "duplicates": [], "errors": []}

        # Fetch all existing UPCs for this category in one query
        # Supabase has a row limit per request, so paginate if needed
        existing_upcs = set()
        batch_size = 1000
        for i in range(0, len(upcs), batch_size):
            chunk = upcs[i:i + batch_size]
            response = (
                self.db.table(self.table)
                .select("upc")
                .eq("category", category)
                .in_("upc", chunk)
                .execute()
            )
            for row in response.data:
                existing_upcs.add(row["upc"])

        duplicate_upcs = [upc for upc in upcs if upc in existing_upcs]
        new_upcs = [upc for upc in upcs if upc not in existing_upcs]

        if not new_upcs:
            return {"added": 0, "duplicates": duplicate_upcs, "errors": []}

        # Bulk insert in chunks (Supabase recommends <=1000 rows per insert)
        added = 0
        errors = []
        insert_batch_size = 500
        for i in range(0, len(new_upcs), insert_batch_size):
            chunk = new_upcs[i:i + insert_batch_size]
            rows = [{"upc": upc, "category": category} for upc in chunk]
            try:
                result = self.db.table(self.table).insert(rows).execute()
                added += len(result.data) if result.data else 0
            except Exception as e:
                logger.error(f"Bulk insert error for chunk starting at index {i}: {e}")
                errors.append(str(e))

        logger.info(f"Bulk add complete: {added} added, {len(duplicate_upcs)} duplicates, {len(errors)} errors")
        return {"added": added, "duplicates": duplicate_upcs, "errors": errors}

    def delete_upc(self, upc: str, category: Optional[str] = None) -> bool:
        """Delete a UPC, optionally filtered by category."""
        query = self.db.table(self.table).delete().eq("upc", upc)
        
        if category:
            query = query.eq("category", category)
        
        result = query.execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="UPC not found")
        return True
    
    def delete_all_upcs(self, category: Optional[str] = None) -> None:
        """Delete all UPCs, optionally filtered by category."""
        if category:
            # Delete all UPCs for the specific category
            self.db.table(self.table).delete().eq("category", category).execute()
        else:
            # Delete all UPCs (using neq workaround to delete all rows)
            self.db.table(self.table).delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

