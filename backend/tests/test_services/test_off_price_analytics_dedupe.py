"""Unit tests for one Daily Run per vendor per calendar day in analytics."""
from unittest.mock import MagicMock, patch

from app.services.off_price_analytics_service import (
    OffPriceAnalyticsService,
    clamp_daily_vendor_run_counts,
    daily_snapshot_has_inflated_run_counts,
    dedupe_one_job_per_vendor_day,
    _analytics_day_for_job,
    _run_date_for_job,
    _vendor_from_job,
)


def test_dedupe_keeps_earliest_completed_per_vendor_day():
    jobs = [
        {
            "id": "a",
            "job_name": "Daily SFF Uploaded Report - 2026-07-22",
            "map_vendor_type": "sff",
            "completed_at": "2026-07-22T13:16:24+00:00",
            "created_at": "2026-07-22T13:15:01+00:00",
        },
        {
            "id": "b",
            "job_name": "Daily SFF Uploaded Report - 2026-07-22",
            "map_vendor_type": "sff",
            "completed_at": "2026-07-22T13:29:06+00:00",
            "created_at": "2026-07-22T13:27:41+00:00",
        },
        {
            "id": "c",
            "job_name": "Daily SFF Uploaded Report - 2026-07-22",
            "map_vendor_type": "sff",
            "completed_at": "2026-07-22T13:47:36+00:00",
            "created_at": "2026-07-22T13:46:13+00:00",
        },
        {
            "id": "d",
            "job_name": "Daily OBZ Uploaded Report - 2026-07-22",
            "map_vendor_type": "obz",
            "completed_at": "2026-07-22T13:03:56+00:00",
            "created_at": "2026-07-22T13:00:01+00:00",
        },
    ]
    kept = dedupe_one_job_per_vendor_day(jobs)
    ids = {j["id"] for j in kept}
    assert ids == {"a", "d"}


def test_run_date_and_vendor_helpers():
    job = {
        "job_name": "Daily CLK Uploaded Report - 2026-07-21",
        "map_vendor_type": "clk",
        "completed_at": "2026-07-21T18:25:00+00:00",
    }
    assert _vendor_from_job(job) == "clk"
    assert _run_date_for_job(job) == "2026-07-21"


def test_todays_listings_empty_when_no_daily_runs():
    db = MagicMock()
    svc = OffPriceAnalyticsService(db)
    svc._fetch_daily_jobs = MagicMock(return_value=[])
    result = svc.get_todays_daily_keepa_listings()
    assert result["has_daily_runs"] is False
    assert result["empty_message"] == "There are no daily runs yet for the day."
    assert result["rows"] == []
    assert result["runs"] == []


def test_todays_listings_includes_price_report_rows():
    db = MagicMock()
    svc = OffPriceAnalyticsService(db)
    svc._fetch_daily_jobs = MagicMock(
        return_value=[
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "job_name": "Daily TEV Off Price Report - 2026-08-14",
                "map_vendor_type": "tev",
                "completed_at": "2026-08-14T12:00:00+00:00",
            },
            {
                "id": "22222222-2222-2222-2222-222222222222",
                "job_name": "Daily CLK Off Price Report - 2026-08-14",
                "map_vendor_type": "clk",
                "completed_at": "2026-08-14T13:00:00+00:00",
            },
        ]
    )
    fake_rows = [
        {
            "UPC": "191142257398",
            "ASIN": "B077MQLJ7F",
            "Product Title": "Teva Women's Midform Universal, Black, 8 M US",
            "Brand": "Teva",
            "Off Price Listing": "Off Price",
            "MSRP": "$75.00",
            "Current Amazon Price": "$47.89",
            "Price Difference": "$27.11",
            "Seller Offer Price": "$47.89",
            "Seller": "Example Seller",
            "Discount %": "36.15%",
            "Amazon URL": "https://www.amazon.com/dp/B077MQLJ7F",
            "_is_off_price": True,
        }
    ]
    with patch("app.services.report_service.ReportService") as report_cls:
        report_cls.return_value.get_comprehensive_report_rows_for_job.return_value = fake_rows
        result = svc.get_todays_daily_keepa_listings(["tev"])

    assert result["has_daily_runs"] is True
    assert result["empty_message"] is None
    assert len(result["runs"]) == 1
    assert result["runs"][0]["vendor_code"] == "tev"
    assert len(result["rows"]) == 1
    assert result["rows"][0]["Vendor"] == "TEV"
    assert result["rows"][0]["UPC"] == "191142257398"
    assert result["rows"][0]["Off Price Listing"] == "Off Price"
    assert "_is_off_price" not in result["rows"][0]


def test_todays_listings_completed_run_with_no_hits():
    db = MagicMock()
    svc = OffPriceAnalyticsService(db)
    svc._fetch_daily_jobs = MagicMock(
        return_value=[
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "job_name": "Daily CLK Off Price Report - 2026-08-14",
                "map_vendor_type": "clk",
                "completed_at": "2026-08-14T12:00:00+00:00",
            }
        ]
    )
    with patch("app.services.report_service.ReportService") as report_cls:
        report_cls.return_value.get_comprehensive_report_rows_for_job.return_value = []
        result = svc.get_todays_daily_keepa_listings()

    assert result["has_daily_runs"] is True
    assert result["empty_message"] == "Daily run(s) completed — no off-price listings found."
    assert result["rows"] == []
    assert result["runs"][0]["row_count"] == 0


def test_analytics_day_uses_utc_completed_at_not_job_name_date():
    job = {
        "id": "obz-late",
        "job_name": "Daily OBZ Uploaded Report - 2026-08-16",
        "map_vendor_type": "obz",
        "completed_at": "2026-08-17T11:05:00+00:00",
        "created_at": "2026-08-17T11:00:00+00:00",
    }
    assert _run_date_for_job(job) == "2026-08-16"
    assert _analytics_day_for_job(job) == "2026-08-17"


def test_dedupe_collapses_same_utc_day_with_different_job_name_dates():
    """Scheduled 6am Chicago + Trigger Import can land on one UTC day with two name dates."""
    jobs = [
        {
            "id": "obz-scheduled",
            "job_name": "Daily OBZ Off Price Report - 2026-08-16",
            "map_vendor_type": "obz",
            "completed_at": "2026-08-17T11:05:00+00:00",
            "created_at": "2026-08-17T11:00:00+00:00",
        },
        {
            "id": "obz-trigger",
            "job_name": "Daily OBZ Uploaded Report - 2026-08-17",
            "map_vendor_type": "obz",
            "completed_at": "2026-08-17T14:30:00+00:00",
            "created_at": "2026-08-17T14:20:00+00:00",
        },
    ]
    kept = dedupe_one_job_per_vendor_day(jobs)
    assert [j["id"] for j in kept] == ["obz-scheduled"]


def test_dedupe_keeps_obz_runs_on_consecutive_utc_days():
    jobs = [
        {
            "id": "obz-mon",
            "job_name": "Daily OBZ Off Price Report - 2026-08-16",
            "map_vendor_type": "obz",
            "completed_at": "2026-08-16T11:05:00+00:00",
            "created_at": "2026-08-16T11:00:00+00:00",
        },
        {
            "id": "obz-tue",
            "job_name": "Daily OBZ Off Price Report - 2026-08-17",
            "map_vendor_type": "obz",
            "completed_at": "2026-08-17T11:05:00+00:00",
            "created_at": "2026-08-17T11:00:00+00:00",
        },
    ]
    kept = dedupe_one_job_per_vendor_day(jobs)
    assert {j["id"] for j in kept} == {"obz-mon", "obz-tue"}


def test_clamp_daily_vendor_run_counts_caps_at_one():
    vendors = [
        {"code": "obz", "run_count": 2, "off_price_count": 400},
        {"code": "clk", "run_count": 0, "off_price_count": 0},
        {"code": "sff", "run_count": 1, "off_price_count": 12},
    ]
    clamped = clamp_daily_vendor_run_counts(vendors)
    assert [v["run_count"] for v in clamped] == [1, 0, 1]
    assert clamped[0]["off_price_count"] == 400


def test_daily_snapshot_has_inflated_run_counts():
    row = {
        "payload": {
            "vendors": [
                {"code": "clk", "run_count": 1},
                {"code": "obz", "run_count": 2},
            ]
        }
    }
    assert daily_snapshot_has_inflated_run_counts(row) is True
    assert daily_snapshot_has_inflated_run_counts({"payload": {"vendors": [{"run_count": 1}]}}) is False
    assert daily_snapshot_has_inflated_run_counts(None) is False
