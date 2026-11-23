"""Import Mode upload parse must reject files with almost no usable prices."""
from __future__ import annotations

import pytest

from app.services.uploaded_report_price_validation import (
    UPLOADED_PRICE_SCHEMA_HINT,
    count_priced_uploaded_upcs,
    validate_uploaded_price_coverage,
)


def _compact(upc: str, price, candidates=None) -> dict:
    row = {
        "upc": upc,
        "product_title": f"Title {upc}",
        "asin": "B0TEST",
        "amazon_link": "https://www.amazon.com/dp/B0TEST",
        "uploaded_price": price,
        "uploaded_seller": "Zappos",
        "uploaded_candidates": candidates
        if candidates is not None
        else [
            {
                "uploaded_price": price,
                "uploaded_seller": "Zappos",
                "product_title": f"Title {upc}",
                "asin": "B0TEST",
                "amazon_link": "https://www.amazon.com/dp/B0TEST",
            }
        ],
    }
    return row


def test_count_priced_uploaded_upcs_uses_candidates():
    rows = [
        _compact("111111111111", None, candidates=[{"uploaded_price": None}, {"uploaded_price": 12.5}]),
        _compact("222222222222", None),
    ]
    assert count_priced_uploaded_upcs(rows) == 1


def test_validate_accepts_mostly_priced_rows():
    rows = [_compact(f"{i:012d}", 10.0 + i) for i in range(1, 21)]
    rows.append(_compact("999999999999", None))
    validate_uploaded_price_coverage(rows)  # does not raise


def test_validate_rejects_zero_prices():
    rows = [_compact(f"{i:012d}", None) for i in range(1, 11)]
    with pytest.raises(ValueError) as exc:
        validate_uploaded_price_coverage(rows)
    message = str(exc.value)
    assert "0 of 10 UPCs" in message
    assert UPLOADED_PRICE_SCHEMA_HINT in message


def test_validate_rejects_sparse_prices():
    # 1 priced of 40 = 2.5% < 5% threshold
    rows = [_compact("000000000001", 19.95)] + [
        _compact(f"{i:012d}", None) for i in range(2, 41)
    ]
    with pytest.raises(ValueError) as exc:
        validate_uploaded_price_coverage(rows)
    assert "1 of 40 UPCs" in str(exc.value)


def test_keepa_export_style_asin_prices_fail():
    """Parent ASIN strings in the price field must not count as usable prices."""
    rows = [
        _compact("673088469191", None, candidates=[{"uploaded_price": None, "uploaded_seller": "yes"}]),
        _compact("673088449865", None, candidates=[{"uploaded_price": None, "uploaded_seller": "yes"}]),
        _compact("673088471491", None, candidates=[{"uploaded_price": None, "uploaded_seller": "no"}]),
    ]
    # Simulate bad mapping leftover: ASIN accidentally stored as price string
    for row, asin in zip(rows, ("B0DQS6PLBQ", "B01NCXFANI", "B0DQS8CLCH")):
        row["uploaded_price"] = asin
        row["uploaded_candidates"][0]["uploaded_price"] = asin

    assert count_priced_uploaded_upcs(rows) == 0
    with pytest.raises(ValueError) as exc:
        validate_uploaded_price_coverage(rows)
    assert "0 of 3 UPCs" in str(exc.value)
