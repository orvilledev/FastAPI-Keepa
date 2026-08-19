"""Dedicated Keepa key-pool selection for Import File vs API Mode Daily Run."""
from unittest.mock import patch

from app.services.keepa_client import MultiKeyKeepaClient


def test_load_daily_api_keys_prefers_dedicated_pool():
    with patch.object(MultiKeyKeepaClient, "_load_named_csv_keys") as load:
        def _side(env_name, _settings_keys):
            if env_name == "KEEPA_DAILY_API_KEYS":
                return ["daily-a", "daily-b"]
            if env_name == "KEEPA_IMPORT_API_KEYS":
                return ["import-a"]
            return []

        load.side_effect = _side
        keys = MultiKeyKeepaClient.load_daily_api_keys()

    assert keys == ["daily-a", "daily-b"]


def test_load_daily_api_keys_falls_back_to_import_pool():
    with patch.object(MultiKeyKeepaClient, "_load_named_csv_keys") as load:
        def _side(env_name, _settings_keys):
            if env_name == "KEEPA_DAILY_API_KEYS":
                return []
            if env_name == "KEEPA_IMPORT_API_KEYS":
                return ["import-a", "import-b"]
            return []

        load.side_effect = _side
        keys = MultiKeyKeepaClient.load_daily_api_keys()

    assert keys == ["import-a", "import-b"]


def test_load_daily_api_keys_empty_when_no_dedicated_pools():
    with patch.object(MultiKeyKeepaClient, "_load_named_csv_keys", return_value=[]):
        keys = MultiKeyKeepaClient.load_daily_api_keys()

    assert keys == []


def test_product_request_api_keys_returns_none_when_empty():
    with patch.object(MultiKeyKeepaClient, "load_daily_api_keys", return_value=[]):
        assert MultiKeyKeepaClient.product_request_api_keys() is None


def test_product_request_api_keys_returns_restricted_pool():
    with patch.object(
        MultiKeyKeepaClient,
        "load_daily_api_keys",
        return_value=["k1", "k2", "k3", "k4", "k5"],
    ):
        assert MultiKeyKeepaClient.product_request_api_keys() == [
            "k1",
            "k2",
            "k3",
            "k4",
            "k5",
        ]


def test_parse_token_status_payload_uses_hourly_bucket():
    parsed = MultiKeyKeepaClient.parse_token_status_payload(
        {"tokensLeft": 180, "refillRate": 5, "refillIn": 12000}
    )
    assert parsed["tokens_left"] == 180
    assert parsed["refill_rate"] == 5
    assert parsed["refill_in_ms"] == 12000
    assert parsed["bucket_max"] == 300


def test_product_pool_keys_quiet_does_not_fall_back_to_full_pool():
    with patch.object(MultiKeyKeepaClient, "_load_named_csv_keys", return_value=[]):
        assert MultiKeyKeepaClient._product_pool_keys_quiet() == []
