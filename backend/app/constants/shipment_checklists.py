"""Vendor-specific shipment completion checklists.

Only vendors listed here expose a checklist in Shipment Manager. Add a new
vendor entry when that brand's workflow is ready — other vendors stay unchanged.
"""
from __future__ import annotations

from typing import Dict, List, Tuple

# (stable id, label) — ids are stored in shipments.checklist JSON.
ChecklistItemDef = Tuple[str, str]

NFA_CHECKLIST: List[ChecklistItemDef] = [
    ("email_wr_sku_update", "Email WR SKU Update to Warehouse Republic"),
    ("update_label_station", "Update Label Station with SKUs"),
    ("send_box_labels", "Send box labels to Warehouse Republic"),
    ("received_wr_confirmation", "Received Confirmation from Warehouse Republic"),
    ("upload_po_import", "Upload PO Import to Extensiv"),
    ("upload_order_import", "Upload Order Import to Extensiv"),
    ("received_pallet_dimensions", "Received Pallet Dimensions from Warehouse Republic"),
    ("generate_pallet_labels_bols", "Generate Pallet Labels and BOLs"),
]

SHIPMENT_CHECKLISTS: Dict[str, List[ChecklistItemDef]] = {
    "NFA": NFA_CHECKLIST,
}


def checklist_items_for_vendor(vendor: str) -> List[ChecklistItemDef]:
    return list(SHIPMENT_CHECKLISTS.get((vendor or "").strip().upper(), []))


def known_checklist_ids(vendor: str) -> set[str]:
    return {item_id for item_id, _ in checklist_items_for_vendor(vendor)}


def normalize_checklist(vendor: str, stored: object) -> Dict[str, bool]:
    """Keep only known ids for this vendor; unknown keys are dropped."""
    known = known_checklist_ids(vendor)
    if not known:
        return {}
    raw = stored if isinstance(stored, dict) else {}
    return {item_id: bool(raw.get(item_id)) for item_id in known}
