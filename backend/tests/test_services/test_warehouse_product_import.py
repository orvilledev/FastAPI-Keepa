"""Tests for warehouse product import parsing."""
from app.services.warehouse_product_import import (
    dedupe_by_upc,
    parse_products_csv,
)


def test_parse_products_csv_valid_rows():
    content = (
        "UPC,SKU,fnsku,STYLE NAME,Condition\n"
        "196010065624,SW001,X00532WIT7,Smartwool Socks,New\n"
        "amzn.gr.9990260,SW002,X0054TXJD3,Another Product,New\n"
    ).encode("utf-8")
    rows, invalid = parse_products_csv(content)
    assert invalid == 0
    assert len(rows) == 2
    assert rows[0]["upc"] == "196010065624"
    assert rows[0]["sku"] == "SW001"
    assert rows[1]["fnsku"] == "X0054TXJD3"


def test_parse_products_csv_without_sku_column():
    content = (
        "UPC,fnsku,STYLE NAME,Condition\n"
        "196010065624,X00532WIT7,Smartwool Socks,New\n"
    ).encode("utf-8")
    rows, invalid = parse_products_csv(content)
    assert invalid == 0
    assert len(rows) == 1
    assert rows[0]["sku"] == ""


def test_parse_products_csv_skips_invalid_rows():
    content = (
        "UPC,fnsku,STYLE NAME,Condition\n"
        "196010065624,X00532WIT7,Valid,New\n"
        ",MISSING,Bad row,New\n"
    ).encode("utf-8")
    rows, invalid = parse_products_csv(content)
    assert len(rows) == 1
    assert invalid == 1


def test_dedupe_by_upc_last_wins():
    rows = [
        {"upc": "111", "sku": "A1", "fnsku": "A", "style_name": "One", "condition": "New"},
        {"upc": "111", "sku": "A2", "fnsku": "B", "style_name": "Two", "condition": "New"},
    ]
    out = dedupe_by_upc(rows)
    assert len(out) == 1
    assert out[0]["fnsku"] == "B"
