"""Tests for Keepa seller merge helpers."""
import pytest

from app.services.keepa_sellers import (
    _offer_condition_is_new,
    _offer_has_disqualifying_flag,
    _offer_is_currently_active,
    _offer_is_fresh,
    _offer_stock_is_zero,
    build_unified_seller_list,
    last_list_price_cents_from_offer_csv,
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


@pytest.mark.unit
def test_offer_without_seller_name_uses_empty_string_not_unknown():
    """Offers often omit sellerName; empty string lets reports resolve via seller_name_map."""
    resp = {
        "products": [
            {
                "current_sellers": [],
                "offers": [
                    {"offerCSV": [1, 2500, 0], "sellerId": "MERCHANT123"},
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    rows = build_unified_seller_list(resp)
    assert len(rows) == 1
    assert rows[0]["sellerName"] == ""
    assert rows[0]["sellerId"] == "MERCHANT123"


# ---------------------------------------------------------------------------
# Offer eligibility gate tests (filters added to drop false-positive sellers
# that are not actually listing the UPC right now).
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_offer_filtered_when_condition_used_int_code():
    """Keepa condition != 0 (New) should be filtered out of offers[] merge."""
    resp = {
        "products": [
            {
                "current_sellers": [],
                "offers": [
                    {
                        "offerCSV": [1, 3000, 0],
                        "sellerId": "S1",
                        "sellerName": "Used Shop",
                        "condition": 4,
                    },
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    assert build_unified_seller_list(resp) == []


@pytest.mark.unit
def test_offer_filtered_when_condition_string_used():
    resp = {
        "products": [
            {
                "current_sellers": [],
                "offers": [
                    {"offerCSV": [1, 3000, 0], "sellerId": "S1", "condition": "Used"},
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    assert build_unified_seller_list(resp) == []


@pytest.mark.unit
def test_offer_kept_when_condition_new_string():
    resp = {
        "products": [
            {
                "current_sellers": [],
                "offers": [
                    {"offerCSV": [1, 3000, 0], "sellerId": "S1", "condition": "New"},
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    rows = build_unified_seller_list(resp)
    assert len(rows) == 1
    assert int(rows[0]["price"]) == 3000


@pytest.mark.unit
def test_offer_kept_when_condition_int_zero():
    """Keepa condition 0 = New; offer should pass through."""
    resp = {
        "products": [
            {
                "current_sellers": [],
                "offers": [
                    {"offerCSV": [1, 3000, 0], "sellerId": "S1", "condition": 0},
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    rows = build_unified_seller_list(resp)
    assert len(rows) == 1


@pytest.mark.unit
def test_offer_filtered_when_condition_int_two():
    """Keepa condition 2 = Used-Very Good; offer should be filtered."""
    resp = {
        "products": [
            {
                "current_sellers": [],
                "offers": [
                    {"offerCSV": [1, 3000, 0], "sellerId": "S1", "condition": 2},
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    assert build_unified_seller_list(resp) == []


@pytest.mark.unit
def test_offer_filtered_when_preorder_flag():
    resp = {
        "products": [
            {
                "current_sellers": [],
                "offers": [
                    {"offerCSV": [1, 3000, 0], "sellerId": "S1", "isPreorder": True},
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    assert build_unified_seller_list(resp) == []


@pytest.mark.unit
def test_offer_filtered_when_addon_item_flag():
    resp = {
        "products": [
            {
                "current_sellers": [],
                "offers": [
                    {"offerCSV": [1, 3000, 0], "sellerId": "S1", "isAddonItem": True},
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    assert build_unified_seller_list(resp) == []


@pytest.mark.unit
def test_offer_filtered_when_scam_flag():
    resp = {
        "products": [
            {
                "current_sellers": [],
                "offers": [
                    {"offerCSV": [1, 3000, 0], "sellerId": "S1", "isScam": True},
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    assert build_unified_seller_list(resp) == []


@pytest.mark.unit
def test_offer_filtered_when_stock_zero():
    resp = {
        "products": [
            {
                "current_sellers": [],
                "offers": [
                    {
                        "offerCSV": [1, 3000, 0],
                        "sellerId": "S1",
                        "stockCSV": [123456, 0],
                    },
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    assert build_unified_seller_list(resp) == []


@pytest.mark.unit
def test_offer_kept_when_stock_positive():
    resp = {
        "products": [
            {
                "current_sellers": [],
                "offers": [
                    {
                        "offerCSV": [1, 3000, 0],
                        "sellerId": "S1",
                        "stockCSV": [123456, 5],
                    },
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    rows = build_unified_seller_list(resp)
    assert len(rows) == 1


@pytest.mark.unit
def test_offer_freshness_helper_rejects_stale_last_seen():
    """lastSeen older than max_age_minutes is rejected."""
    offer = {"lastSeen": 100}
    assert not _offer_is_fresh(offer, max_age_minutes=10, now_keepa_minutes=10_000)


@pytest.mark.unit
def test_offer_freshness_helper_accepts_fresh_last_seen():
    offer = {"lastSeen": 9_995}
    assert _offer_is_fresh(offer, max_age_minutes=10, now_keepa_minutes=10_000)


@pytest.mark.unit
def test_offer_freshness_helper_disabled_when_max_age_zero():
    offer = {"lastSeen": 1}
    assert _offer_is_fresh(offer, max_age_minutes=0, now_keepa_minutes=10_000)


@pytest.mark.unit
def test_offer_freshness_helper_keeps_missing_last_seen():
    """Missing lastSeen should not penalize the offer (permissive default)."""
    assert _offer_is_fresh({}, max_age_minutes=10, now_keepa_minutes=10_000)


@pytest.mark.unit
def test_offer_condition_is_new_handles_missing_field():
    """Missing condition should be treated as New (permissive)."""
    assert _offer_condition_is_new({})


@pytest.mark.unit
def test_offer_condition_is_new_accepts_code_zero():
    """Keepa condition 0 = New."""
    assert _offer_condition_is_new({"condition": 0})


@pytest.mark.unit
def test_offer_condition_is_new_rejects_used_codes():
    for code in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11):
        assert not _offer_condition_is_new({"condition": code}), f"code {code} should not be New"


@pytest.mark.unit
def test_offer_has_disqualifying_flag_detects_each_flag():
    assert _offer_has_disqualifying_flag({"isPreorder": True})
    assert _offer_has_disqualifying_flag({"isAddonItem": True})
    assert _offer_has_disqualifying_flag({"isScam": True})
    assert not _offer_has_disqualifying_flag({})
    assert not _offer_has_disqualifying_flag({"isPrime": True})


@pytest.mark.unit
def test_offer_stock_zero_helper():
    assert _offer_stock_is_zero({"stockCSV": [1, 0]})
    assert _offer_stock_is_zero({"stockCSV": [1, 5, 2, 0]})
    assert not _offer_stock_is_zero({"stockCSV": [1, 5]})
    assert not _offer_stock_is_zero({})


@pytest.mark.unit
def test_current_sellers_bypass_offer_gates():
    """current_sellers entries are trusted; offer-level gates don't apply."""
    resp = {
        "products": [
            {
                "current_sellers": [
                    {
                        "sellerId": "S1",
                        "sellerName": "Used Shop",
                        "price": 3000,
                        "condition": "Used",
                    },
                ],
                "offers": [],
            }
        ]
    }
    rows = build_unified_seller_list(resp)
    assert len(rows) == 1
    assert rows[0]["sellerName"] == "Used Shop"


@pytest.mark.unit
def test_all_gates_disabled_keeps_noisy_offer():
    """With every gate disabled, a noisy offer still passes via the helper."""
    offer = {
        "condition": "Used",
        "isPreorder": True,
        "stockCSV": [1, 0],
        "lastSeen": 1,
    }
    assert _offer_is_currently_active(
        offer,
        require_new_condition=False,
        drop_disqualifying_flags=False,
        drop_zero_stock=False,
        max_age_minutes=0,
    )


@pytest.mark.unit
def test_settings_can_disable_individual_gates(monkeypatch):
    """Disabling all gates restores pre-filter behavior on the merged list."""
    from app.services import keepa_sellers as ks

    monkeypatch.setattr(ks.settings, "keepa_offer_require_new_condition", False)
    monkeypatch.setattr(ks.settings, "keepa_offer_drop_disqualifying_flags", False)
    monkeypatch.setattr(ks.settings, "keepa_offer_drop_zero_stock", False)
    monkeypatch.setattr(ks.settings, "keepa_offer_max_age_minutes", 0)

    resp = {
        "products": [
            {
                "current_sellers": [],
                "offers": [
                    {
                        "offerCSV": [1, 3000, 0],
                        "sellerId": "S1",
                        "condition": "Used",
                        "isPreorder": True,
                        "stockCSV": [1, 0],
                        "lastSeen": 1,
                    },
                ],
                "liveOffersOrder": [0],
            }
        ]
    }
    rows = ks.build_unified_seller_list(resp)
    assert len(rows) == 1
