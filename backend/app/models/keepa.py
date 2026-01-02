"""Pydantic models for Keepa data."""
from pydantic import BaseModel
from typing import Optional, Dict, Any


class KeepaProductData(BaseModel):
    """Model for Keepa product data."""
    asin: Optional[str] = None
    title: Optional[str] = None
    brand: Optional[str] = None
    current_sellers: Optional[list] = None
    stats: Optional[Dict[str, Any]] = None
    csv: Optional[list] = None

