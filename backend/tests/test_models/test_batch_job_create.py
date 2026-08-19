from pydantic import ValidationError
import pytest

from app.models.batch import BatchJobCreate


def _base(**overrides):
    payload = {
        "job_name": "Test",
        "keepa_offers_limit": 50,
        "map_vendor_type": "tev",
    }
    payload.update(overrides)
    return BatchJobCreate(**payload)


def test_requires_pasted_upcs_unless_managed_flag():
    with pytest.raises(ValidationError):
        _base(upcs=[])


def test_accepts_managed_upcs_without_paste():
    job = _base(use_managed_upcs=True, upcs=[])
    assert job.use_managed_upcs is True
    assert job.upcs == []


def test_strips_pasted_upcs():
    job = _base(upcs=[" 123 ", "", "456"])
    assert job.upcs == ["123", "456"]
