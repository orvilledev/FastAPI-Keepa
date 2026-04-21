"""Tests for buy-box-only off-price detection."""
from decimal import Decimal

import pytest

from app.services.price_analyzer import PriceAnalyzer


@pytest.mark.unit
def test_detect_off_price_sellers_flags_buy_box_winner_only():
    analyzer = PriceAnalyzer()
    keepa_data = {
        "products": [
            {
                "stats": {
                    "buyBoxSellerId": "WINNER",
                },
                "current_sellers": [
                    {"sellerId": "WINNER", "sellerName": "Winner", "price": 2500, "isFBA": False},
                    {"sellerId": "OTHER", "sellerName": "Other", "price": 1500, "isFBA": False},
                ],
            }
        ]
    }

    parsed = analyzer.parse_keepa_data(keepa_data)
    sellers = analyzer.detect_off_price_sellers(parsed, map_price=Decimal("30.00"))
    assert len(sellers) == 1
    assert sellers[0]["seller_id"] == "WINNER"
    assert float(sellers[0]["current_price"]) == 25.0


@pytest.mark.unit
def test_detect_off_price_sellers_does_not_flag_non_buy_box_offer():
    analyzer = PriceAnalyzer()
    keepa_data = {
        "products": [
            {
                "stats": {
                    "buyBoxSellerId": "WINNER",
                },
                "current_sellers": [
                    {"sellerId": "WINNER", "sellerName": "Winner", "price": 4500, "isFBA": False},
                    {"sellerId": "CHEAP", "sellerName": "Cheapo", "price": 1500, "isFBA": False},
                ],
            }
        ]
    }

    parsed = analyzer.parse_keepa_data(keepa_data)
    sellers = analyzer.detect_off_price_sellers(parsed, map_price=Decimal("30.00"))
    assert sellers == []
