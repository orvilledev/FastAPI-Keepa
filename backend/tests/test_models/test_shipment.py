"""Vendor field validation for registered shipments."""
import pytest
from pydantic import ValidationError

from app.constants.shipment_checklists import (
    completed_checklist_entry,
    known_checklist_ids,
    normalize_checklist,
    parse_checklist_entry,
)
from app.models.shipment import ShipmentChecklistUpdate, ShipmentCreate, ShipmentUpdate


def test_create_normalizes_vendor_to_uppercase():
    payload = ShipmentCreate(name="NFA WHRP 9.8.26", vendor="nfa")
    assert payload.vendor == "NFA"


def test_create_rejects_a_missing_vendor():
    with pytest.raises(ValidationError, match="Vendor is required"):
        ShipmentCreate(name="NFA WHRP 9.8.26", vendor="  ")


def test_create_rejects_an_invalid_vendor():
    with pytest.raises(ValidationError, match="2–8 letters"):
        ShipmentCreate(name="NFA WHRP 9.8.26", vendor="N")


def test_update_can_set_vendor():
    assert ShipmentUpdate(vendor="smw").vendor == "SMW"


def test_create_defaults_status_to_open():
    payload = ShipmentCreate(name="NFA WHRP 9.8.26", vendor="NFA")
    assert payload.status == "open"


def test_update_can_set_status():
    assert ShipmentUpdate(status="Ready").status == "ready"


def test_update_rejects_an_invalid_status():
    with pytest.raises(ValidationError, match="Open, In Progress, Ready, or Closed"):
        ShipmentUpdate(status="shipped")


def test_nfa_has_checklist_steps():
    ids = known_checklist_ids("NFA")
    assert "email_wr_sku_update" in ids
    assert "generate_pallet_labels_bols" in ids
    assert len(ids) == 8


def test_other_vendors_have_no_checklist():
    assert known_checklist_ids("DNK") == set()
    assert known_checklist_ids("SMW") == set()


def test_normalize_checklist_keeps_only_known_nfa_ids():
    result = normalize_checklist(
        "NFA",
        {
            "email_wr_sku_update": True,
            "bogus": True,
            "upload_po_import": {
                "completed": True,
                "completed_by_name": "Stephanie",
            },
        },
    )
    assert result["email_wr_sku_update"]["completed"] is True
    assert result["upload_po_import"]["completed"] is True
    assert result["upload_po_import"]["completed_by_name"] == "Stephanie"
    assert "bogus" not in result
    assert result["send_box_labels"]["completed"] is False


def test_normalize_checklist_empty_for_other_vendors():
    assert normalize_checklist("DNK", {"email_wr_sku_update": True}) == {}


def test_parse_checklist_entry_accepts_legacy_bool():
    entry = parse_checklist_entry(True)
    assert entry["completed"] is True
    assert entry["completed_by_name"] == ""


def test_completed_checklist_entry_stores_actor():
    entry = completed_checklist_entry(user_id="abc", display_name="Stephanie")
    assert entry["completed"] is True
    assert entry["completed_by"] == "abc"
    assert entry["completed_by_name"] == "Stephanie"
    assert entry["completed_at"]


def test_checklist_update_strips_item_id():
    payload = ShipmentChecklistUpdate(item_id="  email_wr_sku_update  ", completed=True)
    assert payload.item_id == "email_wr_sku_update"
    assert payload.completed is True
