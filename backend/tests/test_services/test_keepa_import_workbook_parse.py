"""Tests for Keepa Import File workbook parsing."""
from app.services.keepa_import_export import build_workbook_bytes, parse_keepa_import_workbook


def test_parse_keepa_import_workbook_round_trip():
    upcs = ["123456789012", "987654321098"]
    fields = {
        "123456789012": {
            "asin": "B001TEST01",
            "title": "Test Shoe",
            "buy_box_seller_name": "Acme",
            "buy_box_seller_id": "A1TEST",
            "buy_box_price": 49.99,
        },
        "987654321098": {
            "asin": "",
            "title": "",
            "buy_box_seller_name": "",
            "buy_box_seller_id": "",
            "buy_box_price": None,
        },
    }
    file_bytes = build_workbook_bytes(upcs, fields, include_header=True)
    rows, total = parse_keepa_import_workbook(file_bytes)

    assert total == 2
    assert len(rows) == 2
    assert rows[0]["upc"] == "123456789012"
    assert rows[0]["title"] == "Test Shoe"
    assert "Acme" in (rows[0]["buy_box_seller"] or "")
    assert rows[0]["buy_box_price"] == "49.99"
    assert rows[0]["asin"] == "B001TEST01"
    assert "amazon.com" in (rows[0]["amazon_url"] or "")


def test_parse_keepa_import_workbook_pagination():
    upcs = [f"{i:012d}" for i in range(5)]
    fields = {upc: {} for upc in upcs}
    file_bytes = build_workbook_bytes(upcs, fields, include_header=True)

    page, total = parse_keepa_import_workbook(file_bytes, offset=2, limit=2)
    assert total == 5
    assert len(page) == 2
    assert page[0]["upc"] == "000000000002"
