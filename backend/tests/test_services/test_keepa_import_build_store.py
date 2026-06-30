"""Tests for Keepa Import File build progress accounting."""
from app.services.keepa_import_build_store import _calc_progress_percent


def test_pass1_progress_scales_to_seventy_percent():
    assert _calc_progress_percent("pass1", 0, 491, 0) == 0
    assert _calc_progress_percent("pass1", 491, 491, 0) == 70


def test_pass2_progress_uses_retry_batch_denominator():
    # 88/160 of retry round -> 70 + (88/160)*25 = 83
    assert _calc_progress_percent("pass2", 88, 491, 160) == 83


def test_excel_phase_is_one_hundred_percent():
    assert _calc_progress_percent("excel", 1, 491, 0) == 100
