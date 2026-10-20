"""Shipment Manager is open to signed-in users except two station accounts."""
from app.dependencies import is_shipment_manager_allowed_user


def test_shipment_manager_blocks_only_hello_and_warehouse1():
    assert is_shipment_manager_allowed_user({"email": "Warehouse1@MetroShoeWarehouse.com"}) is False
    assert is_shipment_manager_allowed_user({"email": "hello@warehouserepublic.com"}) is False
    assert is_shipment_manager_allowed_user({"email": "cameron@pmshoesinc.com"}) is True
    assert is_shipment_manager_allowed_user({"email": "sunshine@metroshoewarehouse.com"}) is True
    assert is_shipment_manager_allowed_user({"email": ""}) is False
