"""Tests for Keepa Import File build progress accounting."""
import pytest

from app.services.keepa_import_build_runner import (
    _record_persisted_progress,
    _should_force_progress_persist,
)
from app.services.keepa_import_build_store import (
    KeepaImportBuildStore,
    _calc_progress_percent,
)


def test_pass1_progress_scales_to_seventy_percent():
    assert _calc_progress_percent("pass1", 0, 491, 0) == 0
    assert _calc_progress_percent("pass1", 491, 491, 0) == 70


def test_pass2_progress_uses_retry_batch_denominator():
    # 88/160 of retry round -> 70 + (88/160)*25 = 83
    assert _calc_progress_percent("pass2", 88, 491, 160) == 83


def test_pass2_caps_at_ninety_five_percent():
    assert _calc_progress_percent("pass2", 160, 491, 160) == 95


def test_excel_phase_is_one_hundred_percent():
    assert _calc_progress_percent("excel", 1, 491, 0) == 100


def test_force_persist_on_phase_change_and_excel():
    build_id = "test-build"
    assert _should_force_progress_persist(build_id, "pass1", 10) is True
    _record_persisted_progress(build_id, "pass1", 10)
    assert _should_force_progress_persist(build_id, "pass1", 10) is False
    assert _should_force_progress_persist(build_id, "pass1", 50) is True
    _record_persisted_progress(build_id, "pass1", 50)
    assert _should_force_progress_persist(build_id, "pass2", 70) is True
    _record_persisted_progress(build_id, "pass2", 95)
    assert _should_force_progress_persist(build_id, "excel", 100) is True


@pytest.mark.asyncio
async def test_in_memory_progress_never_regresses_on_pass2_retry_reset():
    store = KeepaImportBuildStore()
    build_id = await store.create("user", "sff", 100)
    # Finish a retry round at 95%.
    await store.update_progress(
        build_id,
        phase="pass2",
        phase_completed=20,
        total=100,
        enrich_total=20,
    )
    build = await store.get_by_id(build_id)
    assert build is not None
    peak = build.progress_percent
    assert peak == 95
    # New retry round resets phase_completed but progress must not drop.
    await store.update_progress(
        build_id,
        phase="pass2",
        phase_completed=0,
        total=100,
        enrich_total=10,
        message="Retry round 2",
    )
    build_after = await store.get_by_id(build_id)
    assert build_after is not None
    assert build_after.progress_percent >= peak
    # Excel phase advances to 100%.
    await store.update_progress(
        build_id,
        phase="excel",
        phase_completed=1,
        total=100,
        message="Building Excel file…",
    )
    build_excel = await store.get_by_id(build_id)
    assert build_excel is not None
    assert build_excel.progress_percent == 100
