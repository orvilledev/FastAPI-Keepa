"""Keepa token load / completion summary helpers."""
from app.services.keepa_token_summary import (
    KeepaUsageStats,
    build_keepa_run_summary,
    classify_token_load,
    estimate_tokens_for_product_request,
    format_keepa_run_completion_message,
    pool_tpm_from_meters,
)


def test_estimate_tokens_offers_100_with_buybox():
    # 1 + 2 buybox + 6 * 10 offer pages = 63 per ASIN
    assert estimate_tokens_for_product_request(
        product_count=1, offers_limit=100, include_buybox=True
    ) == 63
    assert estimate_tokens_for_product_request(
        product_count=2, offers_limit=20, include_buybox=False
    ) == 2 * (1 + 12)


def test_classify_token_load_degrees():
    assert classify_token_load(0.2) == (1, "Easy")
    assert classify_token_load(0.5) == (2, "Comfortable")
    assert classify_token_load(1.0) == (3, "Balanced")
    assert classify_token_load(1.4) == (4, "Strained")
    assert classify_token_load(2.0) == (5, "Overloaded")
    assert classify_token_load(None)[0] == 0


def test_pool_tpm_from_meters():
    tpm, keys = pool_tpm_from_meters(
        [
            {"ok": True, "refill_rate": 5},
            {"ok": True, "refill_rate": 5},
            {"ok": False, "refill_rate": None},
        ]
    )
    assert tpm == 10
    assert keys == 2


def test_build_summary_and_completion_message():
    usage = KeepaUsageStats(processed=100, tokens_consumed=6300, products_returned=100, requests=100)
    summary = build_keepa_run_summary(
        usage=usage,
        upc_count=100,
        duration_seconds=600,
        pool_tpm=25,
        pool_keys=5,
        offers_limit=100,
    )
    assert summary["tokens_used"] == 6300
    assert summary["tokens_per_upc"] == 63.0
    assert summary["spend_tpm"] == 630.0
    assert summary["token_load_percent"] == 2520.0
    assert summary["token_load_degree"] == 5
    message = format_keepa_run_completion_message(summary)
    assert "6,300" in message
    assert "63.00 tokens/UPC" in message
    assert "Degree 5 Overloaded" in message
    assert "API run completed" in message
