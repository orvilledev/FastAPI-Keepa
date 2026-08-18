"""Hit Alert: 100+ more off-price listings vs the vendor's last completed run."""
from unittest.mock import MagicMock

from app.services.off_price_analytics_service import (
    HIT_ALERT_MIN_DELTA,
    OffPriceAnalyticsService,
    build_hit_alerts,
)
from app.services.off_price_analytics_vendors import VENDOR_DEFS


def test_build_hit_alerts_threshold_is_100():
    assert HIT_ALERT_MIN_DELTA == 100
    current = {code: 0 for code, _ in VENDOR_DEFS}
    previous = {code: 0 for code, _ in VENDOR_DEFS}
    current["clk"] = 149
    previous["clk"] = 50
    current["bor"] = 150
    previous["bor"] = 50
    current["tev"] = 99
    previous["tev"] = 0

    alerts = build_hit_alerts(current, previous, {"bor": "2026-08-14"})
    codes = [a["vendor_code"] for a in alerts]
    assert codes == ["bor"]
    assert alerts[0]["today_hits"] == 150
    assert alerts[0]["last_run_hits"] == 50
    assert alerts[0]["yesterday_hits"] == 50
    assert alerts[0]["delta"] == 100
    assert alerts[0]["last_run_period_key"] == "2026-08-14"
    assert alerts[0]["last_run_label"] == "Aug 14, 2026"


def test_build_hit_alerts_includes_all_vendors_and_sorts_by_delta():
    current = {code: 10 for code, _ in VENDOR_DEFS}
    previous = {code: 10 for code, _ in VENDOR_DEFS}
    current["sff"] = 400
    previous["sff"] = 100
    current["dnk"] = 250
    previous["dnk"] = 20

    alerts = build_hit_alerts(current, previous)
    assert [a["vendor_code"] for a in alerts] == ["sff", "dnk"]
    assert alerts[0]["delta"] == 300
    assert alerts[1]["delta"] == 230


def test_build_hit_alerts_no_spike():
    current = {code: 80 for code, _ in VENDOR_DEFS}
    previous = {code: 70 for code, _ in VENDOR_DEFS}
    assert build_hit_alerts(current, previous) == []


def test_get_daily_hit_alerts_uses_displayed_analytics_day():
    db = MagicMock()
    svc = OffPriceAnalyticsService(db)
    svc._last_run_hits_before = MagicMock(
        return_value=({code: 40 for code, _ in VENDOR_DEFS}, {"clk": "2026-08-14"})
    )
    enabled = {code: True for code, _ in VENDOR_DEFS}
    tracking = {code: True for code, _ in VENDOR_DEFS}
    current_summary = {
        "period_key": "2026-08-17",
        "vendors": [{"code": "clk", "off_price_count": 180}],
    }

    alerts = svc.get_daily_hit_alerts(
        enabled_map=enabled,
        tracking_map=tracking,
        current_summary=current_summary,
        today_period_key="2026-08-18",
    )
    assert len(alerts) == 1
    assert alerts[0]["vendor_code"] == "clk"
    assert alerts[0]["today_hits"] == 180
    assert alerts[0]["delta"] == 140
    svc._last_run_hits_before.assert_called_once()
    assert svc._last_run_hits_before.call_args.kwargs["current_period_key"] == "2026-08-17"


def test_last_run_skips_empty_days_and_uses_friday_for_monday():
    db = MagicMock()
    svc = OffPriceAnalyticsService(db)
    enabled = {code: True for code, _ in VENDOR_DEFS}
    tracking = {code: True for code, _ in VENDOR_DEFS}
    svc.snapshots.list_daily_payloads_before = MagicMock(
        return_value=[
            {
                "period_key": "2026-08-16",
                "source": "live",
                "payload": {
                    "vendors": [
                        {"code": "clk", "off_price_count": 0, "run_count": 0, "sellers": []}
                    ]
                },
            },
            {
                "period_key": "2026-08-14",
                "source": "live",
                "payload": {
                    "vendors": [
                        {"code": "clk", "off_price_count": 50, "run_count": 1, "sellers": []}
                    ]
                },
            },
        ]
    )
    svc._fetch_daily_jobs = MagicMock(return_value=[])

    previous, keys = svc._last_run_hits_before(
        current_period_key="2026-08-17",
        enabled_map=enabled,
        tracking_map=tracking,
    )
    assert previous["clk"] == 50
    assert keys["clk"] == "2026-08-14"


def test_get_daily_hit_alerts_first_run_of_week_vs_last_run():
    db = MagicMock()
    svc = OffPriceAnalyticsService(db)
    previous = {code: 20 for code, _ in VENDOR_DEFS}
    previous["obz"] = 30
    svc._last_run_hits_before = MagicMock(
        return_value=(previous, {"obz": "2026-08-14"})
    )
    enabled = {code: True for code, _ in VENDOR_DEFS}
    tracking = {code: True for code, _ in VENDOR_DEFS}
    current_summary = {
        "period_key": "2026-08-17",
        "vendors": [
            {"code": "obz", "off_price_count": 140},
            {"code": "ref", "off_price_count": 19},
        ],
    }

    alerts = svc.get_daily_hit_alerts(
        enabled_map=enabled,
        tracking_map=tracking,
        current_summary=current_summary,
    )
    assert len(alerts) == 1
    assert alerts[0]["vendor_code"] == "obz"
    assert alerts[0]["delta"] == 110
    assert alerts[0]["last_run_period_key"] == "2026-08-14"
