"""Repository for seller name lookup operations."""
from typing import List, Dict, Optional
from supabase import Client
from fastapi import HTTPException
import logging

logger = logging.getLogger(__name__)


class SellerNameRepository:
    """Repository for seller_names table operations."""

    def __init__(self, db: Client):
        self.db = db
        self.table = "seller_names"

    def get_all_seller_names(self) -> List[dict]:
        """Get all seller name mappings."""
        response = (
            self.db.table(self.table)
            .select("*")
            .order("seller_name")
            .execute()
        )
        return response.data

    def get_seller_name_map(self) -> Dict[str, str]:
        """
        Get a dictionary mapping seller_id -> seller_name for fast lookups.
        Used by the CSV generator to resolve seller IDs to display names.
        """
        response = (
            self.db.table(self.table)
            .select("seller_id, seller_name")
            .execute()
        )
        return {row["seller_id"]: row["seller_name"] for row in response.data}

    def get_by_seller_id(self, seller_id: str) -> Optional[dict]:
        """Look up a seller name by seller ID."""
        response = (
            self.db.table(self.table)
            .select("*")
            .eq("seller_id", seller_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def add_seller_name(self, seller_id: str, seller_name: str) -> dict:
        """Add a new seller name mapping."""
        existing = self.get_by_seller_id(seller_id)
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Seller ID {seller_id} already exists with name '{existing['seller_name']}'"
            )

        result = (
            self.db.table(self.table)
            .insert({"seller_id": seller_id, "seller_name": seller_name})
            .execute()
        )
        return result.data[0] if result.data else {}

    def update_seller_name(self, seller_id: str, seller_name: str) -> dict:
        """Update an existing seller name mapping."""
        existing = self.get_by_seller_id(seller_id)
        if not existing:
            raise HTTPException(status_code=404, detail=f"Seller ID {seller_id} not found")

        result = (
            self.db.table(self.table)
            .update({"seller_name": seller_name, "updated_at": "now()"})
            .eq("seller_id", seller_id)
            .execute()
        )
        return result.data[0] if result.data else {}

    def upsert_seller_name(self, seller_id: str, seller_name: str) -> dict:
        """Insert or update a seller name mapping."""
        result = (
            self.db.table(self.table)
            .upsert(
                {"seller_id": seller_id, "seller_name": seller_name},
                on_conflict="seller_id"
            )
            .execute()
        )
        return result.data[0] if result.data else {}

    def bulk_upsert(self, mappings: List[Dict[str, str]]) -> int:
        """
        Bulk upsert seller name mappings.
        Each mapping should have 'seller_id' and 'seller_name' keys.
        Returns count of rows upserted.
        """
        if not mappings:
            return 0

        rows = [
            {"seller_id": m["seller_id"], "seller_name": m["seller_name"]}
            for m in mappings
        ]

        result = (
            self.db.table(self.table)
            .upsert(rows, on_conflict="seller_id")
            .execute()
        )
        return len(result.data) if result.data else 0

    def delete_seller_name(self, seller_id: str) -> bool:
        """Delete a seller name mapping."""
        result = (
            self.db.table(self.table)
            .delete()
            .eq("seller_id", seller_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail=f"Seller ID {seller_id} not found")
        return True

    def get_count(self) -> int:
        """Get total count of seller name mappings."""
        response = (
            self.db.table(self.table)
            .select("id", count="exact")
            .limit(0)
            .execute()
        )
        return response.count if hasattr(response, "count") else 0
