"""Label Format Checker is open to signed-in users except Hello@warehouserepublic."""
from app.dependencies import is_label_format_checker_allowed_user


def test_label_format_checker_blocks_hello_only():
    assert is_label_format_checker_allowed_user({"email": "Warehouse1@MetroShoeWarehouse.com"}) is True
    assert is_label_format_checker_allowed_user({"email": "label1@metroshoewarehouse.com"}) is True
    assert is_label_format_checker_allowed_user({"email": "label8@metroshoewarehouse.com"}) is True
    assert is_label_format_checker_allowed_user({"email": "pack1@metroshoewarehouse.com"}) is True
    assert is_label_format_checker_allowed_user({"email": "pack6@metroshoewarehouse.com"}) is True
    assert is_label_format_checker_allowed_user({"email": "hello@warehouserepublic.com"}) is False
    assert is_label_format_checker_allowed_user({"email": "cameron@pmshoesinc.com"}) is True
    assert is_label_format_checker_allowed_user({"email": "sunshine@metroshoewarehouse.com"}) is True
    assert is_label_format_checker_allowed_user({"email": ""}) is False
