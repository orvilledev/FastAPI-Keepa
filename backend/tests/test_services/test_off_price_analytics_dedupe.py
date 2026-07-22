"""Unit tests for one Daily Run per vendor per calendar day in analytics."""
from app.services.off_price_analytics_service import (
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
