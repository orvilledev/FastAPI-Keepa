"""Tests for seller exclusion patterns in report generation."""
import pytest
from decimal import Decimal

from app.services.csv_generator import CSVGenerator


@pytest.mark.unit
def test_seller_display_excluded_metroshoe_variants():
    patterns = ["metroshoe"]
    assert CSVGenerator.seller_display_excluded("MetroShoe", patterns)
    assert CSVGenerator.seller_display_excluded("metroshoe", patterns)
    assert CSVGenerator.seller_display_excluded("Metroshoe Warehouse", patterns)
    assert CSVGenerator.seller_display_excluded("metroshoe warehouse", patterns)
    assert CSVGenerator.seller_display_excluded("Metro Shoe Warehouse", patterns)
    assert not CSVGenerator.seller_display_excluded("Other Vendor Inc", patterns)
    assert not CSVGenerator.seller_display_excluded("N/A", patterns)


@pytest.mark.unit
def test_seller_display_excluded_empty_patterns():
    assert not CSVGenerator.seller_display_excluded("MetroShoe", None)
    assert not CSVGenerator.seller_display_excluded("MetroShoe", [])


@pytest.mark.unit
def test_comprehensive_report_skips_excluded_seller_row():
    # Minimal keepa: one offer below MAP from "MetroShoe"
    keepa = {
        "products": [
            {
                "asin": "B00TEST",
                "title": "T",
                "brand": "B",
                "current_sellers": [
                    {
                        "sellerId": "M1",
                        "sellerName": "MetroShoe Warehouse",
                        "price": 1000,
                        "isFBA": False,
                        "condition": "New",
                    }
                ],
                "offers": [],
            }
        ]
    }
    items = [{"upc": "123", "keepa_data": keepa, "status": "completed"}]
    excel_bytes, count = CSVGenerator.generate_comprehensive_report_csv(
        items,
        {"123": Decimal("50.00")},
        seller_name_map={},
        excluded_seller_substrings=["metroshoe"],
    )
    assert count == 0
    assert len(excel_bytes) > 0


@pytest.mark.unit
def test_comprehensive_report_keeps_non_excluded_seller():
    keepa = {
        "products": [
            {
                "asin": "B00TEST",
                "title": "T",
                "brand": "B",
                "current_sellers": [
                    {
                        "sellerId": "X1",
                        "sellerName": "Acme Retail",
                        "price": 1000,
                        "isFBA": False,
                        "condition": "New",
                    }
                ],
                "offers": [],
            }
        ]
    }
    items = [{"upc": "123", "keepa_data": keepa, "status": "completed"}]
    _, count = CSVGenerator.generate_comprehensive_report_csv(
        items,
        {"123": Decimal("50.00")},
        seller_name_map={},
        excluded_seller_substrings=["metroshoe"],
    )
    assert count == 1
