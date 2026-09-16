"""Vendor-specific shipment completion checklists.

Only vendors listed here expose a checklist in Shipment Manager. Add a new
vendor entry when that brand's workflow is ready — other vendors stay unchanged.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

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


def empty_checklist_entry() -> Dict[str, Any]:
    return {
        "completed": False,
        "completed_by": "",
        "completed_by_name": "",
        "completed_at": None,
    }


def completed_checklist_entry(
    *,
    user_id: str,
    display_name: str,
    completed_at: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "completed": True,
        "completed_by": str(user_id or ""),
        "completed_by_name": (display_name or "").strip(),
        "completed_at": completed_at or datetime.now(timezone.utc).isoformat(),
    }


def parse_checklist_entry(raw: object) -> Dict[str, Any]:
    """Accept both legacy bool values and the richer entry objects."""
    if isinstance(raw, bool):
        entry = empty_checklist_entry()
        entry["completed"] = raw
        return entry
    if not isinstance(raw, dict):
        return empty_checklist_entry()

    completed = bool(raw.get("completed"))
    # Legacy accidental shapes: {"email_wr_sku_update": true} already handled above.
    if "completed" not in raw and raw:
        # Treat a non-empty dict without completed as incomplete unless truthy flags exist.
        completed = bool(raw.get("done") or raw.get("checked"))

    completed_at = raw.get("completed_at")
    if completed_at is not None:
        completed_at = str(completed_at).strip() or None

    return {
        "completed": completed,
        "completed_by": str(raw.get("completed_by") or "").strip(),
        "completed_by_name": str(raw.get("completed_by_name") or "").strip(),
        "completed_at": completed_at,
    }


def normalize_checklist(vendor: str, stored: object) -> Dict[str, Dict[str, Any]]:
    """Keep only known ids for this vendor; unknown keys are dropped."""
    known = known_checklist_ids(vendor)
    if not known:
        return {}
    raw = stored if isinstance(stored, dict) else {}
    return {item_id: parse_checklist_entry(raw.get(item_id)) for item_id in known}
