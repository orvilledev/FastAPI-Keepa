"""Hit Alert: 100+ more off-price listings today vs yesterday, all vendors."""
from unittest.mock import MagicMock

from app.services.off_price_analytics_service import (
    HIT_ALERT_MIN_DELTA,
    OffPriceAnalyticsService,
    build_hit_alerts,
)
from app.services.off_price_analytics_vendors import VENDOR_DEFS


def test_build_hit_alerts_threshold_is_100():
    assert HIT_ALERT_MIN_DELTA == 100
    today = {code: 0 for code, _ in VENDOR_DEFS}
    yesterday = {code: 0 for code, _ in VENDOR_DEFS}
    today["clk"] = 149
    yesterday["clk"] = 50
    today["bor"] = 150
    yesterday["bor"] = 50
    today["tev"] = 99
    yesterday["tev"] = 0

    alerts = build_hit_alerts(today, yesterday)
    codes = [a["vendor_code"] for a in alerts]
    assert codes == ["bor"]
    assert alerts[0]["today_hits"] == 150
    assert alerts[0]["yesterday_hits"] == 50
    assert alerts[0]["delta"] == 100


def test_build_hit_alerts_includes_all_vendors_and_sorts_by_delta():
    today = {code: 10 for code, _ in VENDOR_DEFS}
    yesterday = {code: 10 for code, _ in VENDOR_DEFS}
    today["sff"] = 400
    yesterday["sff"] = 100
    today["dnk"] = 250
    yesterday["dnk"] = 20

    alerts = build_hit_alerts(today, yesterday)
    assert [a["vendor_code"] for a in alerts] == ["sff", "dnk"]
    assert alerts[0]["delta"] == 300
    assert alerts[1]["delta"] == 230


def test_build_hit_alerts_no_spike():
    today = {code: 80 for code, _ in VENDOR_DEFS}
    yesterday = {code: 70 for code, _ in VENDOR_DEFS}
    assert build_hit_alerts(today, yesterday) == []


def test_get_daily_hit_alerts_zeros_when_summary_is_prior_day_fallback():
    db = MagicMock()
    svc = OffPriceAnalyticsService(db)
    svc._vendor_off_price_counts_for_daily_offset = MagicMock(
        return_value={code: 40 for code, _ in VENDOR_DEFS}
    )
    enabled = {code: True for code, _ in VENDOR_DEFS}
    tracking = {code: True for code, _ in VENDOR_DEFS}
    today_summary = {
        "period_key": "2020-01-01",
        "vendors": [{"code": "clk", "off_price_count": 500}],
    }

    alerts = svc.get_daily_hit_alerts(
        enabled_map=enabled,
        tracking_map=tracking,
        today_summary=today_summary,
        today_period_key="2026-08-18",
        yesterday_snapshot={"period_key": "2026-08-17"},
    )
    assert alerts == []
    svc._vendor_off_price_counts_for_daily_offset.assert_called_once()
    kwargs = svc._vendor_off_price_counts_for_daily_offset.call_args.kwargs
    assert kwargs["offset"] == 1


def test_get_daily_hit_alerts_uses_today_summary_when_period_matches():
    db = MagicMock()
    svc = OffPriceAnalyticsService(db)
    yesterday_counts = {code: 20 for code, _ in VENDOR_DEFS}
    svc._vendor_off_price_counts_for_daily_offset = MagicMock(return_value=yesterday_counts)
    enabled = {code: True for code, _ in VENDOR_DEFS}
    tracking = {code: True for code, _ in VENDOR_DEFS}
    today_summary = {
        "period_key": "2026-08-18",
        "vendors": [
            {"code": "obz", "off_price_count": 140},
            {"code": "ref", "off_price_count": 19},
        ],
    }

    alerts = svc.get_daily_hit_alerts(
        enabled_map=enabled,
        tracking_map=tracking,
        today_summary=today_summary,
        today_period_key="2026-08-18",
    )
    assert len(alerts) == 1
    assert alerts[0]["vendor_code"] == "obz"
    assert alerts[0]["delta"] == 120
    svc._vendor_off_price_counts_for_daily_offset.assert_called_once()
