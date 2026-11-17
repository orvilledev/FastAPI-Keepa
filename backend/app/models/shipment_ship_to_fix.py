"""Response shapes for the Shipment Manager Ship to correction tool."""
from typing import List, Optional

from pydantic import BaseModel


class ShipToFixFileResult(BaseModel):
    """What happened to one uploaded FBA export."""

    filename: str
    output_filename: str
    # corrected | already_correct | unmatched | error
    status: str
    message: str = ""
    shipment_id: str = ""
    old_ship_to: str = ""
    new_ship_to: str = ""
    # The Seller Central Shipment ID the file was matched to, and how: exact | fuzzy
    matched_shipment_id: str = ""
    match_kind: str = ""
    # True/False once the Ship To Address Catalog was checked; None when it could not be.
    ship_to_in_catalog: Optional[bool] = None
    # The corrected CSV, base64 encoded. Empty unless the file was matched.
    content_base64: str = ""


class ShipToFixResponse(BaseModel):
    results: List[ShipToFixFileResult]
    corrected_count: int = 0
    already_correct_count: int = 0
    unmatched_count: int = 0
    error_count: int = 0
