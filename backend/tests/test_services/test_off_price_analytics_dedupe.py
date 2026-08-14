"""Unit tests for one Daily Run per vendor per calendar day in analytics."""
from unittest.mock import MagicMock, patch

from app.services.off_price_analytics_service import (
    OffPriceAnalyticsService,
    dedupe_one_job_per_vendor_day,
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
