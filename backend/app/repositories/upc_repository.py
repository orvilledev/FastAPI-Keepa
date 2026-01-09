"""Repository for UPC database operations."""
from typing import List, Tuple
from supabase import Client
from fastapi import HTTPException


class UPCRepository:
    """Repository for upcs table operations."""
    
    def __init__(self, db: Client):
        self.db = db
        self.table = "upcs"
    
    def list_upcs(self, limit: int = 100, offset: int = 0) -> List[dict]:
        """List UPCs with pagination."""
        response = self.db.table(self.table).select("*").order(
            "created_at", desc=True
        ).range(offset, offset + limit - 1).execute()
        return response.data
    
    def get_upc_count(self) -> int:
        """Get total count of UPCs."""
        response = self.db.table(self.table).select("id", count="exact").limit(0).execute()
        return response.count if hasattr(response, 'count') else len(response.data)
    
    def upc_exists(self, upc: str) -> bool:
        """Check if a UPC already exists in the database."""
        response = self.db.table(self.table).select("id").eq("upc", upc).limit(1).execute()
        return len(response.data) > 0
    
    def add_upc(self, upc: str) -> bool:
        """
        Add a UPC to the database.
        
        Returns:
            True if added, raises HTTPException if duplicate
        """
        # Check if UPC already exists
        if self.upc_exists(upc):
            raise HTTPException(
                status_code=400,
                detail=f"UPC {upc} already exists in the database"
            )
        
        try:
            result = self.db.table(self.table).insert({"upc": upc}).execute()
            return bool(result.data)
        except Exception as e:
            error_str = str(e)
            if "duplicate" in error_str.lower() or "unique" in error_str.lower():
                raise HTTPException(
                    status_code=400,
                    detail=f"UPC {upc} already exists in the database"
                )
            raise
    
    def delete_upc(self, upc: str) -> bool:
        """Delete a UPC."""
        result = self.db.table(self.table).delete().eq("upc", upc).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="UPC not found")
        return True
    
    def delete_all_upcs(self) -> None:
        """Delete all UPCs."""
        self.db.table(self.table).delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

