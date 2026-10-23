"""QBOID M2 dimensioner endpoints: device receiver and signed-in scan list."""
import json
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import dimensioner
from app.config import settings
from app.database import get_supabase
from app.dependencies import get_dimensioner_user, is_dimensioner_allowed_user
from app.middleware.rate_limiter import limiter
from app.repositories.dimensioner_scan_repository import DimensionerStorageError

KEY = "test-dimensioner-key"
RECEIVE = "/api/v1/dimensioner/new-entry"

RECORD = {
    "timestamp": "2026/10/23 14:02:11",
    "l": 1219,
    "w": 1016,
    "h": 1524,
    "weight": 68039,
    "barcode": "PALLET-001",
    "shape": "Cuboidal",
    "device": "FH0402211100001",
    "note": "",
    "attributes": {},
}

# The device sends exactly this header; note the odd "; utf-8" parameter.
DEVICE_HEADERS = {
    "Content-Type": "application/json; utf-8",
    "Accept": "application/json",
    "Authorization": KEY,
}


class FakeStore:
    """In-memory stand-in for the dimensioner_scans table."""

    def __init__(self):
        self.rows: list[dict] = []
        self.fail_with: Exception | None = None

    def repository_class(self):
        store = self

        class FakeRepository:
            def __init__(self, db):
                pass

            def insert(self, row):
                if store.fail_with:
                    raise store.fail_with
                if any(r["dedupe_key"] == row["dedupe_key"] for r in store.rows):
                    return None
                saved = {**row, "id": str(uuid.uuid4()), "received_at": "2026-10-23T14:02:12+00:00"}
                store.rows.append(saved)
                return saved

            def list_recent(self, limit, barcode_search=None):
                if store.fail_with:
                    raise store.fail_with
                rows = list(reversed(store.rows))
                if barcode_search:
                    rows = [r for r in rows if barcode_search.lower() in r["barcode"].lower()]
                return rows[:limit]

            def delete(self, scan_id):
                if store.fail_with:
                    raise store.fail_with
                for index, row in enumerate(store.rows):
                    if row["id"] == scan_id:
                        del store.rows[index]
                        return True
                return False

        return FakeRepository


@pytest.fixture
def store(monkeypatch):
    fake = FakeStore()
    monkeypatch.setattr(dimensioner, "DimensionerScanRepository", fake.repository_class())
    monkeypatch.setattr(settings, "dimensioner_api_key", KEY)
    return fake


def _app(signed_in: bool) -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.include_router(dimensioner.receiver_router, prefix="/api/v1")
    app.include_router(dimensioner.router, prefix="/api/v1")
    app.dependency_overrides[get_supabase] = lambda: object()
    if signed_in:
        app.dependency_overrides[get_dimensioner_user] = lambda: {
            "id": "user-1",
            "email": "staff@example.com",
        }
    return app


@pytest.fixture
def device(store):
    return TestClient(_app(signed_in=True))


@pytest.fixture
def user(store):
    return TestClient(_app(signed_in=True))


def _post(client, record=RECORD, headers=None, raw: bytes | None = None):
    body = raw if raw is not None else json.dumps(record).encode()
    return client.post(RECEIVE, content=body, headers=headers or DEVICE_HEADERS)


# ---------------------------------------------------------------------------
# Receiver (the M2 itself)
# ---------------------------------------------------------------------------


def test_device_upload_is_stored_in_device_units(device, store):
    response = _post(device)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok" and body["stored"] is True and body["duplicate"] is False
    assert len(store.rows) == 1
    row = store.rows[0]
    assert (row["length_mm"], row["width_mm"], row["height_mm"]) == (1219, 1016, 1524)
    assert row["weight_g"] == 68039
    assert row["barcode"] == "PALLET-001"
    assert row["device"] == "FH0402211100001"


def test_bearer_form_of_the_key_is_accepted(device, store):
    response = _post(device, headers={**DEVICE_HEADERS, "Authorization": f"Bearer {KEY}"})

    assert response.status_code == 200 and len(store.rows) == 1


def test_resent_record_is_acknowledged_but_stored_once(device, store):
    first = _post(device)
    second = _post(device)

    assert first.status_code == 200 and second.status_code == 200
    assert second.json()["duplicate"] is True and second.json()["stored"] is False
    assert len(store.rows) == 1


def test_two_different_scans_are_both_stored(device, store):
    _post(device)
    _post(device, {**RECORD, "timestamp": "2026/10/23 14:05:00", "barcode": "PALLET-002"})

    assert [r["barcode"] for r in store.rows] == ["PALLET-001", "PALLET-002"]


def test_photos_in_the_upload_are_accepted_and_not_stored(device, store):
    with_photos = {
        **RECORD,
        "image": "data:image/jpeg;base64," + "A" * 5000,
        "imagecolor": "data:image/jpeg;base64," + "B" * 5000,
        "imageseg": "data:image/png;base64," + "C" * 5000,
    }

    response = _post(device, with_photos)

    assert response.status_code == 200
    assert not {"image", "imagecolor", "imageseg"} & set(store.rows[0])


@pytest.mark.parametrize("header", [None, "", "wrong-key", "Bearer wrong-key", "Bearer "])
def test_wrong_or_missing_key_is_refused_and_nothing_is_stored(device, store, header):
    headers = {k: v for k, v in DEVICE_HEADERS.items() if k != "Authorization"}
    if header is not None:
        headers["Authorization"] = header

    response = _post(device, headers=headers)

    assert response.status_code == 401
    assert store.rows == []


def test_receiver_is_off_until_a_key_is_configured(device, store, monkeypatch):
    monkeypatch.setattr(settings, "dimensioner_api_key", "")

    # Even an empty / matching-looking header must not get in.
    for header in ("", "Bearer ", KEY):
        response = _post(device, headers={**DEVICE_HEADERS, "Authorization": header})
        assert response.status_code == 503

    assert store.rows == []


def test_invalid_json_is_a_400(device, store):
    assert _post(device, raw=b"not json").status_code == 400
    assert _post(device, raw=b"[1,2,3]").status_code == 400
    assert _post(device, raw=b"").status_code == 400
    assert store.rows == []


def test_record_with_no_measurement_is_acknowledged_not_stored(device, store):
    response = _post(device, {"device": "FH0402211100001", "note": "nothing here"})

    assert response.status_code == 200
    assert response.json()["stored"] is False
    assert store.rows == []


def test_oversized_body_is_refused(device, store, monkeypatch):
    monkeypatch.setattr(dimensioner, "MAX_BODY_BYTES", 100)

    response = _post(device, {**RECORD, "note": "x" * 500})

    assert response.status_code == 413
    assert store.rows == []


def test_storage_failure_is_a_503_so_the_device_retries(device, store):
    store.fail_with = DimensionerStorageError("The dimensioner_scans table is missing.")

    response = _post(device)

    assert response.status_code == 503
    assert "table is missing" in response.json()["detail"]


# ---------------------------------------------------------------------------
# Signed-in scan list
# ---------------------------------------------------------------------------


def test_list_returns_newest_first_with_inches_and_pounds(user, store):
    _post(user, {**RECORD, "barcode": "FIRST"})
    _post(user, {**RECORD, "timestamp": "2026/10/23 14:09:00", "barcode": "SECOND"})

    response = user.get("/api/v1/dimensioner/scans")

    assert response.status_code == 200
    body = response.json()
    assert [s["barcode"] for s in body["scans"]] == ["SECOND", "FIRST"]
    scan = body["scans"][0]
    assert (scan["length_in"], scan["width_in"], scan["height_in"]) == (47.99, 40.0, 60.0)
    assert scan["weight_lb"] == 150.0
    assert scan["length_mm"] == 1219
    assert body["receiver_configured"] is True
    assert body["receive_path"] == "/api/v1/dimensioner/new-entry"


def test_list_reports_when_the_receiver_is_not_configured(user, store, monkeypatch):
    monkeypatch.setattr(settings, "dimensioner_api_key", "  ")

    assert user.get("/api/v1/dimensioner/scans").json()["receiver_configured"] is False


def test_list_never_reveals_the_key(user, store):
    assert KEY not in user.get("/api/v1/dimensioner/scans").text


def test_list_filters_by_barcode_and_limits(user, store):
    for index in range(5):
        _post(user, {**RECORD, "timestamp": f"2026/10/23 14:0{index}:00", "barcode": f"AB-{index}"})
    _post(user, {**RECORD, "timestamp": "2026/10/23 15:00:00", "barcode": "ZZ-9"})

    filtered = user.get("/api/v1/dimensioner/scans", params={"search": "zz"}).json()
    limited = user.get("/api/v1/dimensioner/scans", params={"limit": 2}).json()

    assert [s["barcode"] for s in filtered["scans"]] == ["ZZ-9"]
    assert len(limited["scans"]) == 2


@pytest.mark.parametrize("limit", [0, -1, 201, "abc"])
def test_list_rejects_a_bad_limit(user, store, limit):
    assert user.get("/api/v1/dimensioner/scans", params={"limit": limit}).status_code == 422


def test_list_requires_a_signed_in_user(store):
    anonymous = TestClient(_app(signed_in=False))

    assert anonymous.get("/api/v1/dimensioner/scans").status_code in (401, 403)
    assert anonymous.delete(f"/api/v1/dimensioner/scans/{uuid.uuid4()}").status_code in (401, 403)


def test_list_storage_failure_is_a_503(user, store):
    store.fail_with = DimensionerStorageError("down")

    assert user.get("/api/v1/dimensioner/scans").status_code == 503


def test_delete_removes_one_scan(user, store):
    _post(user, {**RECORD, "barcode": "KEEP"})
    _post(user, {**RECORD, "timestamp": "2026/10/23 14:09:00", "barcode": "DROP"})
    drop_id = next(r["id"] for r in store.rows if r["barcode"] == "DROP")

    response = user.delete(f"/api/v1/dimensioner/scans/{drop_id}")

    assert response.status_code == 200 and response.json() == {"deleted": True}
    assert [r["barcode"] for r in store.rows] == ["KEEP"]


def test_delete_unknown_scan_is_a_404(user, store):
    assert user.delete(f"/api/v1/dimensioner/scans/{uuid.uuid4()}").status_code == 404


def test_delete_with_a_malformed_id_is_a_422(user, store):
    assert user.delete("/api/v1/dimensioner/scans/not-a-uuid").status_code == 422


# ---------------------------------------------------------------------------
# Camera test (signed-in page, not the M2)
# ---------------------------------------------------------------------------


def test_camera_test_is_stored_without_the_device_key(user, store, monkeypatch):
    monkeypatch.setattr(settings, "dimensioner_api_key", "")

    response = user.post(
        "/api/v1/dimensioner/scans/test",
        json={"barcode": "845973030506", "length_in": 10, "width_in": 8, "height_in": 6, "weight_lb": 2},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["device"] == "camera-test"
    assert body["barcode"] == "845973030506"
    assert body["length_in"] == 10.0
    assert body["weight_lb"] == 2.0
    assert body["note"] == "Camera test"
    assert store.rows[0]["length_mm"] == 254
    assert store.rows[0]["dedupe_key"].startswith("nots:")


def test_camera_test_blank_sizes_are_stored_as_missing(user, store):
    response = user.post("/api/v1/dimensioner/scans/test", json={"barcode": "NO-SIZE"})

    assert response.status_code == 200
    body = response.json()
    assert body["length_in"] is None and body["weight_lb"] is None


def test_camera_test_without_a_barcode_is_refused(user, store):
    response = user.post("/api/v1/dimensioner/scans/test", json={"barcode": "  "})

    assert response.status_code == 400
    assert store.rows == []


def test_camera_test_requires_a_signed_in_user(store):
    anonymous = TestClient(_app(signed_in=False))

    response = anonymous.post("/api/v1/dimensioner/scans/test", json={"barcode": "X"})

    assert response.status_code in (401, 403)
    assert store.rows == []


def test_dimensioner_allowlist_is_the_named_accounts(monkeypatch):
    monkeypatch.setattr("app.dependencies.is_superadmin_user", lambda user, db: False)

    assert is_dimensioner_allowed_user({"email": "orvillebarba@gmail.com"}, object())
    assert is_dimensioner_allowed_user({"email": " Stephanie@MetroShoeWarehouse.com "}, object())
    assert is_dimensioner_allowed_user({"email": "sunshine@metroshoewarehouse.com"}, object())
    assert is_dimensioner_allowed_user({"email": "paolo@metroshoewarehouse.com"}, object())
    assert is_dimensioner_allowed_user({"email": "paulo@metroshoewarehouse.com"}, object())
    assert is_dimensioner_allowed_user({"email": "johnbernard@metroshoewarehouse.com"}, object())
    assert not is_dimensioner_allowed_user({"email": "warehouse1@metroshoewarehouse.com"}, object())
    assert not is_dimensioner_allowed_user({"email": ""}, object())


def test_dimensioner_allowlist_includes_superadmin(monkeypatch):
    monkeypatch.setattr("app.dependencies.is_superadmin_user", lambda user, db: True)

    assert is_dimensioner_allowed_user({"email": "someone-else@example.com"}, object())


def test_camera_test_storage_failure_is_a_503(user, store):
    store.fail_with = DimensionerStorageError("down")

    response = user.post("/api/v1/dimensioner/scans/test", json={"barcode": "X"})

    assert response.status_code == 503
