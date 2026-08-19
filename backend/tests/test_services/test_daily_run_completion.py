"""Tests for daily/import run completion email idempotency."""
import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.services.daily_run_completion import (
    acquire_category_daily_run_lock,
    claim_completion_email_send,
    claim_daily_run_email_for_vendor_day,
    daily_run_kind_from_job_name,
    release_category_daily_run_lock,
    resolve_daily_run_date,
    scheduled_uploaded_run_completed_today,
    send_daily_run_completion_email_for_job,
    try_acquire_category_daily_run_lock,
    uploaded_daily_run_in_progress,
)


def test_claim_completion_email_send_only_once():
    db = MagicMock()
    db.table.return_value.update.return_value.eq.return_value.is_.return_value.execute.side_effect = [
        SimpleNamespace(data=[{"id": "job-1"}]),
        SimpleNamespace(data=[]),
    ]

    assert claim_completion_email_send(db, "job-1") is True
    assert claim_completion_email_send(db, "job-1") is False


def test_claim_daily_run_email_for_vendor_day_only_once():
    db = MagicMock()
    insert_chain = db.table.return_value.insert.return_value
    insert_chain.execute.side_effect = [
        SimpleNamespace(data=[{"vendor_code": "clk"}]),
        Exception("duplicate key value violates unique constraint"),
    ]

    assert (
        claim_daily_run_email_for_vendor_day(
            db, vendor="clk", run_date="2026-07-17", run_kind="uploaded", job_id="job-a"
        )
        is True
    )
    assert (
        claim_daily_run_email_for_vendor_day(
            db, vendor="clk", run_date="2026-07-17", run_kind="uploaded", job_id="job-b"
        )
        is False
    )


def test_resolve_daily_run_date_and_kind():
    assert (
        resolve_daily_run_date({"job_name": "Daily BOR Uploaded Report - 2026-07-17"})
        == "2026-07-17"
    )
    assert daily_run_kind_from_job_name("Daily TEV Uploaded Report - 2026-07-17") == "uploaded"
    assert daily_run_kind_from_job_name("Daily CLK Off Price Report - 2026-07-17") == "api"


def test_scheduled_uploaded_run_completed_today_true():
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.ilike.return_value.limit.return_value.execute.return_value = SimpleNamespace(
        data=[{"id": "job-1"}]
    )
    assert scheduled_uploaded_run_completed_today(db, "sff", "2026-07-02") is True


def test_uploaded_daily_run_in_progress_true():
    db = MagicMock()
    db.table.return_value.select.return_value.in_.return_value.ilike.return_value.limit.return_value.execute.return_value = SimpleNamespace(
        data=[{"id": "job-1"}]
    )
    assert uploaded_daily_run_in_progress(db, "tev") is True


@patch("app.services.daily_run_completion.refresh_live_analytics_snapshots")
@patch("app.services.daily_run_completion.EmailService")
@patch("app.services.daily_run_completion.ReportService")
@patch("app.services.daily_run_completion.claim_completion_email_send", return_value=True)
def test_send_allows_same_day_new_job_email(
    _claim_job,
    report_cls,
    email_cls,
    _refresh,
):
    """A new completed job may email even if another vendor/day claim already exists."""
    job_id = uuid4()
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = SimpleNamespace(
        data=[
            {
                "id": str(job_id),
                "status": "completed",
                "job_name": "Daily CLK Uploaded Report - 2026-07-17",
                "map_vendor_type": "clk",
                "email_recipients": "ops@example.com",
            }
        ]
    )
    report_cls.return_value.generate_csv_for_job.return_value = (b"csv", "report.csv", 3)
    report_cls.return_value.get_total_upcs_for_job.return_value = 10
    email_cls.return_value.send_csv_report.return_value = True

    sent = send_daily_run_completion_email_for_job(db, job_id)

    assert sent is True
    email_cls.return_value.send_csv_report.assert_called_once()


@patch("app.services.daily_run_completion.EmailService")
@patch("app.services.daily_run_completion.ReportService")
@patch("app.services.daily_run_completion.claim_completion_email_send", return_value=False)
def test_send_skips_when_job_already_emailed(
    _claim_job,
    report_cls,
    _email_cls,
):
    """Older jobs that already claimed completion_email_sent_at are never resent."""
    job_id = uuid4()
    db = MagicMock()

    sent = send_daily_run_completion_email_for_job(db, job_id)

    assert sent is False
    report_cls.assert_not_called()


@patch("app.services.daily_run_completion.EmailService")
@patch("app.services.daily_run_completion.ReportService")
@patch("app.services.daily_run_completion.release_completion_email_claim")
@patch("app.services.daily_run_completion.claim_completion_email_send", return_value=True)
def test_send_daily_run_completion_email_for_job_skips_when_not_completed(
    _claim,
    release_claim,
    report_cls,
    _email_cls,
):
    job_id = uuid4()
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = SimpleNamespace(
        data=[{"id": str(job_id), "status": "processing", "job_name": "Daily SFF Uploaded Report - 2026-07-02"}]
    )

    sent = send_daily_run_completion_email_for_job(db, job_id)

    assert sent is False
    report_cls.assert_not_called()
    release_claim.assert_called_once_with(db, str(job_id))


@patch("app.services.daily_run_completion.refresh_live_analytics_snapshots")
@patch("app.services.daily_run_completion.EmailService")
@patch("app.services.daily_run_completion.ReportService")
@patch("app.services.daily_run_completion.release_completion_email_claim")
@patch("app.services.daily_run_completion.claim_completion_email_send", return_value=True)
def test_failed_send_releases_claim_so_job_can_retry(
    _claim,
    release_claim,
    report_cls,
    email_cls,
    _refresh,
):
    job_id = uuid4()
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = SimpleNamespace(
        data=[
            {
                "id": str(job_id),
                "status": "completed",
                "job_name": "Daily OBZ Uploaded Report - 2026-08-17",
                "map_vendor_type": "obz",
                "email_recipients": "ops@example.com",
            }
        ]
    )
    report_cls.return_value.generate_csv_for_job.return_value = (b"csv", "report.csv", 3)
    report_cls.return_value.get_total_upcs_for_job.return_value = 10
    email_cls.return_value.send_csv_report.return_value = False

    sent = send_daily_run_completion_email_for_job(db, job_id)

    assert sent is False
    assert email_cls.return_value.send_csv_report.call_count == 2
    release_claim.assert_called_once_with(db, str(job_id))


@patch("app.services.daily_run_completion.refresh_live_analytics_snapshots")
@patch("app.services.daily_run_completion.EmailService")
@patch("app.services.daily_run_completion.ReportService")
@patch("app.services.daily_run_completion.release_completion_email_claim")
@patch("app.services.daily_run_completion.claim_completion_email_send", return_value=True)
def test_retry_send_success_keeps_claim(
    _claim,
    release_claim,
    report_cls,
    email_cls,
    _refresh,
):
    job_id = uuid4()
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = SimpleNamespace(
        data=[
            {
                "id": str(job_id),
                "status": "completed",
                "job_name": "Daily OBZ Uploaded Report - 2026-08-17",
                "map_vendor_type": "obz",
                "email_recipients": "ops@example.com",
            }
        ]
    )
    report_cls.return_value.generate_csv_for_job.return_value = (b"csv", "report.csv", 3)
    report_cls.return_value.get_total_upcs_for_job.return_value = 10
    email_cls.return_value.send_csv_report.side_effect = [False, True]

    sent = send_daily_run_completion_email_for_job(db, job_id)

    assert sent is True
    assert email_cls.return_value.send_csv_report.call_count == 2
    release_claim.assert_not_called()


@pytest.mark.asyncio
async def test_try_acquire_skips_when_vendor_lock_held():
    category = "obz-lock-skip"
    try:
        assert await try_acquire_category_daily_run_lock(category) is True
        assert await try_acquire_category_daily_run_lock(category) is False
    finally:
        release_category_daily_run_lock(category)


@pytest.mark.asyncio
async def test_forced_acquire_waits_until_vendor_lock_released():
    category = "obz-lock-wait"
    await try_acquire_category_daily_run_lock(category)
    started = asyncio.Event()
    got_lock = asyncio.Event()

    async def waiter():
        started.set()
        await acquire_category_daily_run_lock(category)
        got_lock.set()
        release_category_daily_run_lock(category)

    task = asyncio.create_task(waiter())
    await started.wait()
    await asyncio.sleep(0.05)
    assert not got_lock.is_set()
    release_category_daily_run_lock(category)
    await asyncio.wait_for(task, timeout=1)
    assert got_lock.is_set()
