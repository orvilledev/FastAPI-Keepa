"""Tests for Keepa Import off-price report parity with uploaded daily import mode."""
from decimal import Decimal
from unittest.mock import MagicMock, patch

from app.scheduler import find_uploaded_off_price_match
from app.services.keepa_import_export import build_workbook_bytes
from app.services.keepa_import_off_price_report import generate_off_price_report_bytes


def test_find_uploaded_off_price_match_flags_price_below_map():
    entry = {
        "upc": "123456789012",
        "product_title": "Test Shoe",
        "uploaded_price": 29.99,
        "uploaded_seller": "Acme",
        "uploaded_candidates": [{"uploaded_price": 29.99, "uploaded_seller": "Acme"}],
    }
    match = find_uploaded_off_price_match(entry, 35.00)
    assert match is not None
    selected, map_f = match
    assert map_f == 35.0
    assert selected["uploaded_price"] == 29.99


def test_find_uploaded_off_price_match_ignores_price_at_or_above_map():
    entry = {
        "upc": "123456789012",
        "uploaded_price": 40.00,
        "uploaded_seller": "Acme",
        "uploaded_candidates": [{"uploaded_price": 40.00, "uploaded_seller": "Acme"}],
    }
    assert find_uploaded_off_price_match(entry, 35.00) is None


def test_generate_off_price_report_counts_below_map_rows():
    upcs = ["123456789012", "987654321098"]
    fields = {
        "123456789012": {
            "asin": "B001",
            "title": "Below MAP",
            "buy_box_seller_name": "Seller A",
            "buy_box_seller_id": "A1",
            "buy_box_price": 29.99,
        },
        "987654321098": {
            "asin": "B002",
            "title": "Above MAP",
            "buy_box_seller_name": "Seller B",
            "buy_box_seller_id": "A2",
            "buy_box_price": 55.00,
        },
    }
    file_bytes = build_workbook_bytes(upcs, fields, include_header=True)
    db = MagicMock()

    with patch(
        "app.services.keepa_import_off_price_report.UPCRepository"
    ) as upc_repo_cls, patch(
        "app.services.keepa_import_off_price_report.MAPRepository"
    ) as map_repo_cls, patch(
        "app.services.keepa_import_off_price_report.SellerNameRepository"
    ) as seller_repo_cls:
        upc_repo_cls.return_value.get_all_upc_codes.return_value = upcs
        map_repo_cls.return_value.get_map_prices_by_upcs.return_value = {
            "123456789012": Decimal("35.00"),
            "987654321098": Decimal("50.00"),
        }
        seller_repo_cls.return_value.get_seller_name_map.return_value = {}

        _report_bytes, total_upcs, off_price_count = generate_off_price_report_bytes(
            file_bytes,
            category="tev",
            db=db,
        )

    assert total_upcs == 2
    assert off_price_count == 1
