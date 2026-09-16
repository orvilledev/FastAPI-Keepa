"""Vendor field validation and checklist helpers for registered shipments."""
import pytest
from pydantic import ValidationError

from app.constants.shipment_checklists import (
    apply_checklist_actor_names,
    checklist_actor_ids,
    coerce_template_steps,
    completed_checklist_entry,
    known_checklist_ids,
    known_ids_from_steps,
    normalize_checklist,
    parse_checklist_entry,
    resolve_checklist_steps,
    slugify_step_id,
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


def test_other_vendors_have_no_builtin_checklist():
    assert known_checklist_ids("DNK") == set()
    assert known_checklist_ids("SMW") == set()


def test_normalize_checklist_keeps_only_known_nfa_ids():
    result = normalize_checklist(
        {
            "email_wr_sku_update": True,
            "bogus": True,
            "upload_po_import": {
                "completed": True,
                "completed_by_name": "Stephanie",
            },
        },
        vendor="NFA",
    )
    assert result["email_wr_sku_update"]["completed"] is True
    assert result["upload_po_import"]["completed"] is True
    assert result["upload_po_import"]["completed_by_name"] == "Stephanie"
    assert "bogus" not in result
    assert result["send_box_labels"]["completed"] is False


def test_normalize_checklist_empty_for_other_vendors():
    assert normalize_checklist({"email_wr_sku_update": True}, vendor="DNK") == {}


def test_resolve_checklist_steps_uses_db_over_defaults():
    steps = resolve_checklist_steps(
        "NFA",
        [{"id": "custom_step", "label": "Custom Step"}],
    )
    assert steps == [{"id": "custom_step", "label": "Custom Step"}]


def test_resolve_checklist_steps_empty_db_row_means_no_steps():
    assert resolve_checklist_steps("NFA", []) == []


def test_coerce_template_steps_generates_ids():
    steps = coerce_template_steps([{"label": "Send box labels to Warehouse Republic"}])
    assert len(steps) == 1
    assert steps[0]["id"] == "send_box_labels_to_warehouse_republic"
    assert steps[0]["label"].startswith("Send box labels")


def test_slugify_avoids_collisions():
    existing = {"send_box_labels"}
    assert slugify_step_id("Send box labels", existing) == "send_box_labels_2"


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


def test_apply_checklist_actor_names_fills_blank_names():
    checklist = normalize_checklist(
        {
            "email_wr_sku_update": {
                "completed": True,
                "completed_by": "user-1",
                "completed_by_name": "",
            }
        },
        known_ids={"email_wr_sku_update"},
    )
    filled = apply_checklist_actor_names(checklist, {"user-1": "Stephanie"})
    assert filled["email_wr_sku_update"]["completed_by_name"] == "Stephanie"


def test_checklist_actor_ids_lists_completers():
    checklist = normalize_checklist(
        {
            "email_wr_sku_update": {
                "completed": True,
                "completed_by": "user-1",
                "completed_by_name": "Stephanie",
            },
            "send_box_labels": True,
        },
        known_ids={"email_wr_sku_update", "send_box_labels"},
    )
    assert checklist_actor_ids(checklist) == ["user-1"]
    assert known_ids_from_steps([{"id": "a", "label": "A"}]) == {"a"}


def test_checklist_update_strips_item_id():
    payload = ShipmentChecklistUpdate(item_id="  email_wr_sku_update  ", completed=True)
    assert payload.item_id == "email_wr_sku_update"
    assert payload.completed is True
