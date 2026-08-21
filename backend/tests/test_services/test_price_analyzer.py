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


@pytest.mark.unit
def test_detect_off_price_sellers_excludes_metroshoe_buy_box_winner():
    analyzer = PriceAnalyzer()
    keepa_data = {
        "products": [
            {
                "stats": {
                    "buyBoxSellerId": "METRO_WINNER",
                },
                "current_sellers": [
                    {
                        "sellerId": "METRO_WINNER",
                        "sellerName": "MetroShoe Warehouse",
                        "price": 2500,
                        "isFBA": False,
                    },
                    {
                        "sellerId": "OTHER",
                        "sellerName": "Other Seller",
                        "price": 2600,
                        "isFBA": False,
                    },
                ],
            }
        ]
    }

    parsed = analyzer.parse_keepa_data(keepa_data)
    sellers = analyzer.detect_off_price_sellers(parsed, map_price=Decimal("30.00"))
    assert sellers == []


def _keepa_offers_payload():
    return {
        "products": [
            {
                "stats": {"buyBoxSellerId": "WINNER"},
                "current_sellers": [],
                "offers": [
                    {
                        "offerCSV": [1, 2500, 0],
                        "sellerId": "WINNER",
                        "sellerName": "Winner",
                        "condition": 1,
                    },
                    {
                        "offerCSV": [1, 1500, 0],
                        "sellerId": "CHEAP",
                        "sellerName": "Cheapo",
                        "condition": 1,
                    },
                    {
                        "offerCSV": [1, 1000, 0],
                        "sellerId": "USED",
                        "sellerName": "Used Shop",
                        "condition": 2,
                    },
                ],
                "liveOffersOrder": [0, 1, 2],
            }
        ]
    }


@pytest.mark.unit
def test_dual_scope_flags_keepa_new_offers_including_non_buy_box():
    """API/Express dual-scope: Keepa condition 1 offers below MAP are hits."""
    analyzer = PriceAnalyzer()
    parsed = analyzer.parse_keepa_data(_keepa_offers_payload())
    sellers = analyzer.detect_off_price_sellers(
        parsed,
        map_price=Decimal("30.00"),
        off_price_scope="buybox_and_non_buybox_below_map",
    )
    ids = {s["seller_id"] for s in sellers}
    assert ids == {"WINNER", "CHEAP"}
    assert all(s["seller_id"] != "USED" for s in sellers)


@pytest.mark.unit
def test_buybox_only_does_not_use_keepa_condition_one_offers():
    """Buy-box-only stays on the legacy merge; condition 1 offers are not hits."""
    analyzer = PriceAnalyzer()
    parsed = analyzer.parse_keepa_data(_keepa_offers_payload())
    sellers = analyzer.detect_off_price_sellers(
        parsed,
        map_price=Decimal("30.00"),
        off_price_scope="buybox_only",
    )
    assert sellers == []
