"""Tests for completed-job retention age filtering."""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from unittest.mock import MagicMock, patch

from app.repositories.job_repository import JobRepository


def test_parse_job_timestamp_handles_z_and_naive():
    aware = JobRepository.parse_job_timestamp("2026-08-20T12:00:00Z")
    assert aware is not None
    assert aware.tzinfo is not None
    assert aware.hour == 12

    naive = JobRepository.parse_job_timestamp("2026-08-20T12:00:00")
    assert naive is not None
    assert naive.tzinfo == timezone.utc


def test_job_completion_time_prefers_completed_at():
    row = {
        "completed_at": "2026-08-01T10:00:00Z",
        "created_at": "2026-07-01T10:00:00Z",
    }
    stamp = JobRepository.job_completion_time(row)
    assert stamp == datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)


def test_list_completed_job_ids_older_than_filters_by_age():
    now = datetime.now(timezone.utc)
    old_id = str(uuid4())
    recent_id = str(uuid4())
    rows = [
        {
            "id": old_id,
            "completed_at": (now - timedelta(days=10)).isoformat(),
            "created_at": (now - timedelta(days=11)).isoformat(),
        },
        {
            "id": recent_id,
            "completed_at": (now - timedelta(days=2)).isoformat(),
            "created_at": (now - timedelta(days=3)).isoformat(),
        },
    ]

    repo = JobRepository(MagicMock())
    with patch(
        "app.repositories.job_repository.read_all_paginated",
        return_value=rows,
    ):
        ids = repo.list_completed_job_ids_older_than(7)

    assert ids == [UUID(old_id)]


def test_list_completed_job_ids_older_than_disabled_when_zero():
    repo = JobRepository(MagicMock())
    assert repo.list_completed_job_ids_older_than(0) == []
