"""Repository for UPC database operations."""
from typing import List, Tuple, Optional
from supabase import Client
from fastapi import HTTPException


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

