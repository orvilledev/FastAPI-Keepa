from pydantic import ValidationError
import pytest

from app.models.project import DONE_STATUSES, ProjectCreate, ProjectUpdate
from app.api.projects import _completed_at_for_status, _normalize_row


def test_create_strips_name_and_blank_notes():
    project = ProjectCreate(name="  Freight class UI  ", notes="   ", status="in_progress")
    assert project.name == "Freight class UI"
    assert project.notes is None
    assert project.status == "in_progress"


def test_create_rejects_blank_name():
    with pytest.raises(ValidationError):
        ProjectCreate(name="   ")


def test_create_rejects_invalid_status():
    with pytest.raises(ValidationError):
        ProjectCreate(name="Demo", status="done")  # type: ignore[arg-type]


def test_update_status_only():
    payload = ProjectUpdate(status="deployed")
    dumped = payload.model_dump(exclude_unset=True)
    assert dumped == {"status": "deployed"}
    assert "deployed" in DONE_STATUSES


def test_update_rejects_blank_name():
    with pytest.raises(ValidationError):
        ProjectUpdate(name=" ")


def test_completed_at_for_status():
    assert _completed_at_for_status("deployed") == "now()"
    assert _completed_at_for_status("complete") == "now()"
    assert _completed_at_for_status("cancelled") == "now()"
    assert _completed_at_for_status("in_progress") is None
    assert _completed_at_for_status("planning") is None


def test_normalize_row_stringifies_ids():
    row = _normalize_row({"id": 1, "user_id": 2, "name": "Demo"})
    assert row["id"] == "1"
    assert row["user_id"] == "2"
    assert row["name"] == "Demo"
