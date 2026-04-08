"""Tests for Keepa seller merge helpers."""
import pytest

from app.services.keepa_sellers import (
    last_list_price_cents_from_offer_csv,
    build_unified_seller_list,
)


@pytest.mark.unit
def test_last_list_price_from_offer_csv():
    # One triplet: time, price 1000 cents, shipping 50 cents
    assert last_list_price_cents_from_offer_csv([100, 1000, 50]) == 1050
    # Two triplets — use last
    csv = [1, 100, 0, 2, 2000, 99]
    assert last_list_price_cents_from_offer_csv(csv) == 2099


@pytest.mark.unit
def test_last_list_price_invalid():
    assert last_list_price_cents_from_offer_csv([]) is None
    assert last_list_price_cents_from_offer_csv([1, 2]) is None
    assert last_list_price_cents_from_offer_csv(None) is None


@pytest.mark.unit
def test_build_unified_merges_current_and_offers():
    resp = {
        "products": [
            {
                "current_sellers": [
                    {
                        "sellerId": "A",
                        "sellerName": "Shop A",
                        "price": 5000,
                        "isFBA": True,
                        "condition": "New",
                    }
                ],
                "offers": [
                    {"offerCSV": [1, 3000, 0], "sellerId": "B", "sellerName": "Shop B", "isFBA": False},
                    {"offerCSV": [1, 4000, 0], "sellerId": "A", "sellerName": "Shop A", "isFBA": True},
                ],
                "liveOffersOrder": [0, 1],
            }
        ]
    }
    rows = build_unified_seller_list(resp)
    # A @ $50 from current_sellers; B @ $30 from offers; A @ $40 from offers is duplicate seller? same seller A different price - should appear twice... 
    # Wait: dedupe is (sellerId, price). A 5000 and A 4000 are different keys - both kept.
    # A 5000 from current, A 4000 from offers - two rows
    # B 3000 - one row
    assert len(rows) == 3
    prices = sorted(int(r["price"]) for r in rows)
    assert prices == [3000, 4000, 5000]


@pytest.mark.unit
def test_build_unified_dedupes_same_seller_same_price():
    resp = {
        "products": [
            {
                "current_sellers": [
                    {"sellerId": "A", "sellerName": "S", "price": 1000, "isFBA": False, "condition": "New"}
                ],
                "offers": [
                    {"offerCSV": [1, 1000, 0], "sellerId": "A", "sellerName": "S", "isFBA": False},
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    rows = build_unified_seller_list(resp)
    assert len(rows) == 1
