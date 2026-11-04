"""Anyone a shipment is shared with can move it back from Completed shipments."""
import pytest
from fastapi import HTTPException

from app.api import fba_shipment_library as api

UPLOAD = "11111111-1111-1111-1111-111111111111"
FOLDER = "22222222-2222-2222-2222-222222222222"
OWNER = "33333333-3333-3333-3333-333333333333"
SHARED = "44444444-4444-4444-4444-444444444444"
OTHER = "55555555-5555-5555-5555-555555555555"
LINE = "66666666-6666-6666-6666-666666666666"


class UnarchiveRepo:
    def __init__(self, upload):
        self.upload = dict(upload)
        self.unarchived = False

    def get_upload(self, upload_id):
        return dict(self.upload) if upload_id == UPLOAD else None

    def list_line_quantities(self, upload_id):
        return [{"id": LINE, "shipped": 1}]

    def counts_for_lines(self, line_ids, user_id=None):
        return {LINE: 1}

    def unarchive_upload(self, upload_id):
        self.unarchived = True
        saved = dict(self.upload)
        saved.update(
            {
                "id": upload_id,
                "shipment_id": saved.get("shipment_id") or "FBA1",
                "created_at": saved.get("created_at") or "2026-01-01T00:00:00+00:00",
                "archived_at": None,
                "archived_by": None,
                "folder_id": saved.get("folder_id") or FOLDER,
            }
        )
        return saved


def _install(monkeypatch, repo):
    monkeypatch.setattr(api, "FbaShipmentLibraryRepository", lambda db: repo)
    monkeypatch.setattr(api, "is_superadmin_user", lambda user, db: False)


def _unarchive(user_id):
    return api.unarchive_fba_shipment.__wrapped__(
        UPLOAD,
        {"id": user_id, "email": "worker@example.com"},
        None,
    )


def _archived_upload(**extra):
    row = {
        "id": UPLOAD,
        "shipment_id": "FBA1",
        "created_by": OWNER,
        "created_at": "2026-01-01T00:00:00+00:00",
        "is_locked": False,
        "shared_with": None,
        "trashed_at": None,
        "archived_at": "2026-01-02T00:00:00+00:00",
        "archived_by": OWNER,
        "folder_id": FOLDER,
        "line_count": 1,
        "total_shipped": 1,
    }
    row.update(extra)
    return row


def test_a_shared_person_can_unarchive(monkeypatch):
    repo = UnarchiveRepo(_archived_upload(shared_with=[SHARED]))
    _install(monkeypatch, repo)
    saved = _unarchive(SHARED)
    assert repo.unarchived is True
    assert saved.archived_at is None
    assert str(saved.folder_id) == FOLDER


def test_the_owner_can_unarchive(monkeypatch):
    repo = UnarchiveRepo(_archived_upload())
    _install(monkeypatch, repo)
    saved = _unarchive(OWNER)
    assert repo.unarchived is True
    assert saved.archived_at is None


def test_someone_the_shipment_is_not_shared_with_cannot_unarchive(monkeypatch):
    repo = UnarchiveRepo(_archived_upload(shared_with=[SHARED]))
    _install(monkeypatch, repo)
    with pytest.raises(HTTPException) as caught:
        _unarchive(OTHER)
    assert caught.value.status_code == 403
    assert repo.unarchived is False


def test_unarchive_requires_an_archived_shipment(monkeypatch):
    repo = UnarchiveRepo(_archived_upload(archived_at=None, archived_by=None))
    _install(monkeypatch, repo)
    with pytest.raises(HTTPException) as caught:
        _unarchive(OWNER)
    assert caught.value.status_code == 400
    assert "not archived" in caught.value.detail
    assert repo.unarchived is False


def test_trashed_shipments_must_be_restored_before_unarchive(monkeypatch):
    repo = UnarchiveRepo(_archived_upload(trashed_at="2026-01-03T00:00:00+00:00"))
    _install(monkeypatch, repo)
    with pytest.raises(HTTPException) as caught:
        _unarchive(OWNER)
    assert caught.value.status_code == 400
    assert "Trash" in caught.value.detail
    assert repo.unarchived is False
