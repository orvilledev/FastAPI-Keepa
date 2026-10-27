"""Anyone a shipment is shared with can archive it into a chosen folder."""
import pytest
from fastapi import HTTPException

from app.api import fba_shipment_library as api
from app.models.fba_shipment_library import FbaShipmentArchiveRequest

UPLOAD = "11111111-1111-1111-1111-111111111111"
FOLDER = "22222222-2222-2222-2222-222222222222"
OWNER = "33333333-3333-3333-3333-333333333333"
SHARED = "44444444-4444-4444-4444-444444444444"
OTHER = "55555555-5555-5555-5555-555555555555"
LINE = "66666666-6666-6666-6666-666666666666"


class ArchiveRepo:
    def __init__(self, upload, *, counted=1, folder=True):
        self.upload = dict(upload)
        self.counted = counted
        self.folder = folder
        self.archived = None

    def get_upload(self, upload_id):
        return dict(self.upload) if upload_id == UPLOAD else None

    def list_line_quantities(self, upload_id):
        return [{"id": LINE, "shipped": 1}]

    def counts_for_lines(self, line_ids, user_id=None):
        return {LINE: self.counted}

    def get_folder(self, folder_id):
        if not self.folder or folder_id != FOLDER:
            return None
        return {"id": FOLDER, "name": "Pallet 1"}

    def archive_upload(self, upload_id, user_id, folder_id):
        self.archived = (upload_id, user_id, folder_id)
        saved = dict(self.upload)
        saved.update(
            {
                "id": upload_id,
                "shipment_id": saved.get("shipment_id") or "FBA1",
                "created_at": saved.get("created_at") or "2026-01-01T00:00:00+00:00",
                "archived_at": "2026-01-02T00:00:00+00:00",
                "archived_by": user_id,
                "folder_id": folder_id,
            }
        )
        return saved


def _install(monkeypatch, repo):
    monkeypatch.setattr(api, "FbaShipmentLibraryRepository", lambda db: repo)
    monkeypatch.setattr(api, "is_superadmin_user", lambda user, db: False)


def _archive(user_id):
    return api.archive_fba_shipment.__wrapped__(
        UPLOAD,
        FbaShipmentArchiveRequest(folder_id=FOLDER),
        {"id": user_id, "email": "worker@example.com"},
        None,
    )


def _open_upload(**extra):
    row = {
        "id": UPLOAD,
        "shipment_id": "FBA1",
        "created_by": OWNER,
        "created_at": "2026-01-01T00:00:00+00:00",
        "is_locked": False,
        "shared_with": None,
        "trashed_at": None,
        "archived_at": None,
        "line_count": 1,
        "total_shipped": 1,
    }
    row.update(extra)
    return row


def test_a_shared_person_archives_into_the_chosen_folder(monkeypatch):
    repo = ArchiveRepo(_open_upload(shared_with=[SHARED]))
    _install(monkeypatch, repo)
    saved = _archive(SHARED)
    assert repo.archived == (UPLOAD, SHARED, FOLDER)
    assert str(saved.folder_id) == FOLDER
    assert saved.archived_at is not None


def test_the_owner_can_still_archive_into_a_folder(monkeypatch):
    repo = ArchiveRepo(_open_upload())
    _install(monkeypatch, repo)
    saved = _archive(OWNER)
    assert repo.archived[1] == OWNER
    assert str(saved.folder_id) == FOLDER


def test_someone_the_shipment_is_not_shared_with_cannot_archive(monkeypatch):
    repo = ArchiveRepo(_open_upload(shared_with=[SHARED]))
    _install(monkeypatch, repo)
    with pytest.raises(HTTPException) as caught:
        _archive(OTHER)
    assert caught.value.status_code == 403
    assert repo.archived is None


def test_archive_requires_a_real_folder_and_a_finished_count(monkeypatch):
    unfinished = ArchiveRepo(_open_upload(), counted=0)
    _install(monkeypatch, unfinished)
    with pytest.raises(HTTPException) as not_ready:
        _archive(OWNER)
    assert not_ready.value.status_code == 400
    assert unfinished.archived is None

    missing_folder = ArchiveRepo(_open_upload(), folder=False)
    _install(monkeypatch, missing_folder)
    with pytest.raises(HTTPException) as missing:
        _archive(OWNER)
    assert missing.value.status_code == 404
    assert missing_folder.archived is None
