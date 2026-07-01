"""Tests for daily/import run completion email idempotency."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.services.daily_run_completion import (
    claim_completion_email_send,
    scheduled_uploaded_run_completed_today,
    send_daily_run_completion_email_for_job,
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


@patch("app.services.daily_run_completion.EmailService")
@patch("app.services.daily_run_completion.ReportService")
@patch("app.services.daily_run_completion.claim_completion_email_send", return_value=True)
def test_send_daily_run_completion_email_for_job_skips_when_not_completed(
    _claim,
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
