"""Vendor field validation for registered shipments."""
import pytest
from pydantic import ValidationError

from app.models.shipment import ShipmentCreate, ShipmentUpdate


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
