"""Tests for Keepa Import build orphan detection and reconciliation."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.keepa_import_build_runner import (
    _ORPHAN_FAIL_MESSAGE,
    _parse_updated_at,
    is_keepa_import_build_live,
    is_keepa_import_build_task_running,
    reconcile_orphaned_keepa_import_builds,
)


def test_parse_updated_at_handles_z_suffix():
    parsed = _parse_updated_at("2026-07-02T04:25:04.123456+00:00")
    assert parsed is not None
    assert parsed.year == 2026


@pytest.mark.asyncio
async def test_is_build_live_when_task_registered():
    build_id = "live-build"
    with patch(
        "app.services.keepa_import_build_runner._running_build_ids",
        {build_id},
    ):
        assert is_keepa_import_build_task_running(build_id) is True
        assert await is_keepa_import_build_live(build_id) is True


@pytest.mark.asyncio
async def test_reconcile_orphan_fails_dead_building_row():
    db = MagicMock()
    build_id = "dead-build"
    row = {
        "id": build_id,
        "category": "tev",
        "status": "building",
        "updated_at": "2026-07-02T04:25:04+00:00",
    }
    repo = MagicMock()
    repo.list_building.return_value = [row]
    repo.get_by_id.return_value = row
    repo.fail = MagicMock()

    with patch(
        "app.services.keepa_import_build_runner.KeepaImportBuildHistoryRepository",
        return_value=repo,
    ), patch(
        "app.services.keepa_import_build_runner.is_keepa_import_build_live",
        new=AsyncMock(return_value=False),
    ), patch(
        "app.services.keepa_import_build_runner.keepa_import_build_store.fail",
        new=AsyncMock(),
    ) as fail_store, patch(
        "app.services.keepa_import_build_runner.asyncio.to_thread",
        new=AsyncMock(side_effect=lambda fn, *args, **kwargs: fn(*args, **kwargs)),
    ):
        reconciled = await reconcile_orphaned_keepa_import_builds(db, stale_minutes=0)

    assert reconciled == 1
    fail_store.assert_awaited_once_with(build_id, _ORPHAN_FAIL_MESSAGE)
    repo.fail.assert_called_once_with(build_id, _ORPHAN_FAIL_MESSAGE)


@pytest.mark.asyncio
async def test_reconcile_skips_live_build():
    db = MagicMock()
    build_id = "live-build"
    row = {"id": build_id, "category": "tev", "status": "building"}
    repo = MagicMock()
    repo.list_building.return_value = [row]

    with patch(
        "app.services.keepa_import_build_runner.KeepaImportBuildHistoryRepository",
        return_value=repo,
    ), patch(
        "app.services.keepa_import_build_runner.is_keepa_import_build_live",
        new=AsyncMock(return_value=True),
    ):
        reconciled = await reconcile_orphaned_keepa_import_builds(db, stale_minutes=0)

    assert reconciled == 0
    repo.fail.assert_not_called()
