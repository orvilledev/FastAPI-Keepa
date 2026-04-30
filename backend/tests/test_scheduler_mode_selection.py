"""Regression tests for scheduler input-mode selection."""
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import MagicMock, patch

import pytest

from app.scheduler import run_daily_job_for_category


class _FakeQuery:
    def __init__(self, db, table_name: str):
        self.db = db
        self.table_name = table_name
        self._select = None

    def select(self, value):
        self._select = value
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def insert(self, payload):
        self.db.inserts.append((self.table_name, payload))
        return self

    def update(self, payload):
        self.db.updates.append((self.table_name, payload))
        return self

    def in_(self, *_args, **_kwargs):
        return self

    def execute(self):
        self.db.tables_hit.append(self.table_name)
        if self.table_name == "scheduler_settings":
            return SimpleNamespace(
                data=[{
                    "input_mode": self.db.input_mode,
                    "email_recipients": None,
                    "uploaded_wait_timeout_seconds": 90,
                }]
            )
        if self.table_name == "profiles":
            return SimpleNamespace(data=[{"id": str(uuid4())}])
        if self.table_name == "scheduler_uploaded_reports":
            # Simulate missing report so uploaded-mode exits early without
            # entering downstream processing.
            return SimpleNamespace(data=[])
        return SimpleNamespace(data=[])


class _FakeDB:
    def __init__(self, input_mode: str):
        self.input_mode = input_mode
        self.tables_hit = []
        self.inserts = []
        self.updates = []

    def table(self, table_name: str):
        return _FakeQuery(self, table_name)


@pytest.mark.asyncio
async def test_scheduler_uses_latest_mode_on_back_to_back_runs():
    """Back-to-back mode changes should be honored at run time."""
    api_db = _FakeDB(input_mode="api")
    uploaded_db = _FakeDB(input_mode="uploaded")

    upc_repo_api = MagicMock()
    upc_repo_api.get_all_upc_codes.return_value = []

    upc_repo_uploaded = MagicMock()
    upc_repo_uploaded.get_all_upc_codes.return_value = []

    with patch("app.scheduler.create_notification", return_value=None), patch(
        "app.scheduler.BatchProcessor", return_value=SimpleNamespace()
    ), patch(
        "app.scheduler.get_supabase", side_effect=[api_db, uploaded_db]
    ), patch(
        "app.scheduler.UPCRepository", side_effect=[upc_repo_api, upc_repo_uploaded]
    ):
        # First run should take API path.
        await run_daily_job_for_category("dnk")
        # Second run should take uploaded path after mode switch.
        await run_daily_job_for_category("dnk")

    assert "scheduler_uploaded_reports" not in api_db.tables_hit
    assert "scheduler_uploaded_reports" in uploaded_db.tables_hit

    upc_repo_api.get_all_upc_codes.assert_called_once_with("dnk")
    upc_repo_uploaded.get_all_upc_codes.assert_not_called()

    uploaded_batch_inserts = [
        payload for table, payload in uploaded_db.inserts if table == "batch_jobs"
    ]
    assert uploaded_batch_inserts, "Uploaded mode should create failed run entry when file is missing"
    assert "Uploaded Report" in uploaded_batch_inserts[0]["job_name"]


@pytest.mark.asyncio
async def test_scheduler_honors_latest_mode_after_multiple_switches():
    """Rapid mode switches should always honor the latest stored input_mode."""
    uploaded_db_first = _FakeDB(input_mode="uploaded")
    api_db = _FakeDB(input_mode="api")
    uploaded_db_final = _FakeDB(input_mode="uploaded")

    upc_repo_instances = []

    def _make_upc_repo(*_args, **_kwargs):
        repo = MagicMock()
        repo.get_all_upc_codes.return_value = []
        upc_repo_instances.append(repo)
        return repo

    with patch("app.scheduler.create_notification", return_value=None), patch(
        "app.scheduler.BatchProcessor", return_value=SimpleNamespace()
    ), patch(
        "app.scheduler.get_supabase",
        side_effect=[uploaded_db_first, api_db, uploaded_db_final],
    ), patch(
        "app.scheduler.UPCRepository",
        side_effect=_make_upc_repo,
    ):
        # Simulate "uploaded -> api -> uploaded" before each scheduled execution.
        await run_daily_job_for_category("dnk")
        await run_daily_job_for_category("dnk")
        await run_daily_job_for_category("dnk")

    assert "scheduler_uploaded_reports" in uploaded_db_first.tables_hit
    assert "scheduler_uploaded_reports" not in api_db.tables_hit
    assert "scheduler_uploaded_reports" in uploaded_db_final.tables_hit

    # Only API mode should resolve UPC scope through UPCRepository in this test.
    total_upc_scope_calls = sum(repo.get_all_upc_codes.call_count for repo in upc_repo_instances)
    assert total_upc_scope_calls == 1
    assert any(
        call_args.args == ("dnk",)
        for repo in upc_repo_instances
        for call_args in repo.get_all_upc_codes.call_args_list
    )

    final_uploaded_inserts = [
        payload for table, payload in uploaded_db_final.inserts if table == "batch_jobs"
    ]
    assert final_uploaded_inserts, "Final uploaded mode should still execute uploaded-path behavior"
    assert "Uploaded Report" in final_uploaded_inserts[0]["job_name"]


@pytest.mark.asyncio
async def test_forced_uploaded_mode_overrides_api_setting():
    """Express rerun should force uploaded-mode behavior even if settings say API."""
    api_db = _FakeDB(input_mode="api")
    upc_repo = MagicMock()
    upc_repo.get_all_upc_codes.return_value = []

    with patch("app.scheduler.create_notification", return_value=None), patch(
        "app.scheduler.BatchProcessor", return_value=SimpleNamespace()
    ), patch(
        "app.scheduler.get_supabase", return_value=api_db
    ), patch(
        "app.scheduler.UPCRepository", return_value=upc_repo
    ):
        await run_daily_job_for_category("dnk", forced_input_mode="uploaded")

    assert "scheduler_uploaded_reports" in api_db.tables_hit
    upc_repo.get_all_upc_codes.assert_not_called()
    uploaded_batch_inserts = [
        payload for table, payload in api_db.inserts if table == "batch_jobs"
    ]
    assert uploaded_batch_inserts
    assert "Uploaded Report" in uploaded_batch_inserts[0]["job_name"]
