"""Vendor-specific shipment completion checklists.

Default templates ship in code (NFA). Superadmins can override/extend any vendor
via the shipment_vendor_checklists table. Progress is stored on shipments.checklist.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

# (stable id, label) — ids are stored in shipments.checklist JSON.
ChecklistItemDef = Tuple[str, str]

NFA_CHECKLIST: List[ChecklistItemDef] = [
    ("email_wr_sku_update", "Email WR SKU Update to Warehouse Republic"),
    ("update_label_station", "Update Label Station with SKUs"),
    ("send_box_labels", "Send box labels to NFA and MetroShoe Team."),
    ("received_wr_confirmation", "Received Confirmation from Warehouse Republic"),
    ("upload_po_import", "Upload PO Import to Extensiv"),
    ("upload_order_import", "Upload Order Import to Extensiv"),
    ("received_pallet_dimensions", "Received Pallet Dimensions from Warehouse Republic"),
    ("generate_pallet_labels_bols", "Generate Pallet Labels and BOLs"),
    ("upload_pallet_labels_and_bols_to_extensiv", "Upload Pallet Labels and BOLs to Extensiv."),
]

# Built-in defaults used when the DB has no row for that vendor yet.
# SMW shares the same workflow as NFA / The North Face.
DEFAULT_SHIPMENT_CHECKLISTS: Dict[str, List[ChecklistItemDef]] = {
    "NFA": NFA_CHECKLIST,
    "SMW": list(NFA_CHECKLIST),
}

_STEP_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_]{0,63}$")


def default_checklist_items_for_vendor(vendor: str) -> List[ChecklistItemDef]:
    return list(DEFAULT_SHIPMENT_CHECKLISTS.get((vendor or "").strip().upper(), []))


def checklist_items_for_vendor(vendor: str) -> List[ChecklistItemDef]:
    """Legacy helper: built-in defaults only (no DB). Prefer resolve_checklist_steps."""
    return default_checklist_items_for_vendor(vendor)


def known_checklist_ids(vendor: str) -> set[str]:
    return {item_id for item_id, _ in checklist_items_for_vendor(vendor)}


def steps_from_defs(defs: Sequence[ChecklistItemDef]) -> List[Dict[str, str]]:
    return [{"id": item_id, "label": label} for item_id, label in defs]


def parse_checklist_steps(raw: object) -> List[Dict[str, str]]:
    """Normalize a steps list from DB or API into [{id, label}, …]."""
    if not isinstance(raw, list):
        return []
    cleaned: List[Dict[str, str]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or "").strip().lower()
        label = str(item.get("label") or "").strip()
        if not item_id or not label:
            continue
        if not _STEP_ID_RE.match(item_id):
            continue
        if item_id in seen:
            continue
        seen.add(item_id)
        cleaned.append({"id": item_id, "label": label})
    return cleaned


def slugify_step_id(label: str, existing: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", (label or "").strip().lower()).strip("_")
    base = (base[:48] or "step").rstrip("_")
    if not base[0].isalnum():
        base = f"step_{base}"
    candidate = base
    index = 2
    while candidate in existing:
        candidate = f"{base}_{index}"
        index += 1
    return candidate


def coerce_template_steps(raw_steps: Sequence[dict]) -> List[Dict[str, str]]:
    """Build a validated steps list for saving; generate ids when missing."""
    result: List[Dict[str, str]] = []
    seen: set[str] = set()
    for item in raw_steps:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        if not label:
            continue
        item_id = str(item.get("id") or "").strip().lower()
        if not item_id or not _STEP_ID_RE.match(item_id) or item_id in seen:
            item_id = slugify_step_id(label, seen)
        seen.add(item_id)
        result.append({"id": item_id, "label": label[:300]})
    return result


def resolve_checklist_steps(vendor: str, stored_steps: Optional[object]) -> List[Dict[str, str]]:
    """DB steps win when a row exists (even if empty); otherwise use code defaults."""
    if stored_steps is not None:
        return parse_checklist_steps(stored_steps)
    return steps_from_defs(default_checklist_items_for_vendor(vendor))


def known_ids_from_steps(steps: Sequence[Dict[str, str]]) -> set[str]:
    return {str(item.get("id") or "") for item in steps if item.get("id")}


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
    if "completed" not in raw and raw:
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


def normalize_checklist(
    stored: object,
    *,
    known_ids: Optional[set[str]] = None,
    vendor: str = "",
) -> Dict[str, Dict[str, Any]]:
    """Keep only known step ids; unknown keys are dropped.

    Prefer passing known_ids from the resolved template. vendor is only used as a
    fallback to built-in defaults when known_ids is omitted.
    """
    ids = known_ids if known_ids is not None else known_checklist_ids(vendor)
    if not ids:
        return {}
    raw = stored if isinstance(stored, dict) else {}
    return {item_id: parse_checklist_entry(raw.get(item_id)) for item_id in ids}


def checklist_actor_ids(checklist: Dict[str, Dict[str, Any]]) -> List[str]:
    """User ids recorded on completed checklist steps (for profile name lookup)."""
    ids: List[str] = []
    seen: set[str] = set()
    for entry in checklist.values():
        if not entry.get("completed"):
            continue
        uid = str(entry.get("completed_by") or "").strip()
        if uid and uid not in seen:
            seen.add(uid)
            ids.append(uid)
    return ids


def apply_checklist_actor_names(
    checklist: Dict[str, Dict[str, Any]],
    names: Dict[str, str],
) -> Dict[str, Dict[str, Any]]:
    """Fill blank completed_by_name from a user-id -> display-name map."""
    if not checklist or not names:
        return checklist
    updated: Dict[str, Dict[str, Any]] = {}
    for item_id, entry in checklist.items():
        row = dict(entry)
        if row.get("completed") and not str(row.get("completed_by_name") or "").strip():
            uid = str(row.get("completed_by") or "").strip()
            if uid and names.get(uid):
                row["completed_by_name"] = names[uid]
        updated[item_id] = row
    return updated
