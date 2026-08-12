"""Audit middleware: records actions without altering request/response behaviour."""
import base64
import json
from io import BytesIO

import pytest
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.middleware import audit_logger
from app.middleware.audit_logger import AuditLogMiddleware
from app.services.audit_actions import describe, should_audit

USER_ID = "11111111-2222-3333-4444-555555555555"


def _bearer(sub: str = USER_ID, email: str = "user@example.com") -> str:
    def seg(data: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")

    return f"{seg({'alg': 'HS256'})}.{seg({'sub': sub, 'email': email})}.signature"


@pytest.fixture
def rows(monkeypatch):
    captured = []
    monkeypatch.setattr(audit_logger, "_write_audit_row", lambda **kw: captured.append(kw))
    return captured


@pytest.fixture
def client():
    app = FastAPI()
    app.add_middleware(AuditLogMiddleware)

    @app.post("/api/v1/upcs")
    async def add_upcs(payload: dict):
        return {"added": len(payload.get("upcs", []))}

    @app.post("/api/v1/warehouse-products/import")
    async def import_products(file: UploadFile = File(...)):
        raw = await file.read()
        return {"filename": file.filename, "bytes": len(raw)}

    @app.get("/api/v1/reports/{job_id}/csv")
    async def download_csv(job_id: str):
        return StreamingResponse(
            BytesIO(b"a,b,c\n1,2,3\n" * 500),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="r.csv"'},
        )

    @app.get("/api/v1/jobs")
    async def list_jobs():
        return {"jobs": []}

    return TestClient(app)


def _web_headers() -> dict:
    return {"Authorization": f"Bearer {_bearer()}", "X-Client-Type": "web"}


def test_mutating_request_is_recorded(client, rows):
    response = client.post("/api/v1/upcs", json={"upcs": ["1", "2"]}, headers=_web_headers())

    assert response.status_code == 200
    assert response.json() == {"added": 2}
    assert len(rows) == 1
    assert rows[0]["method"] == "POST"
    assert rows[0]["path"] == "/api/v1/upcs"
    assert rows[0]["status_code"] == 200
    assert rows[0]["email"] == "user@example.com"


def test_upload_body_reaches_handler_intact(client, rows):
    payload = b"spreadsheet-bytes" * 64
    response = client.post(
        "/api/v1/warehouse-products/import",
        files={"file": ("products.xlsx", payload, "application/vnd.ms-excel")},
        headers=_web_headers(),
    )

    assert response.json() == {"filename": "products.xlsx", "bytes": len(payload)}
    assert len(rows) == 1


def test_streamed_download_is_recorded_and_unmodified(client, rows):
    response = client.get("/api/v1/reports/job-1/csv", headers=_web_headers())

    assert response.status_code == 200
    assert len(response.content) == len(b"a,b,c\n1,2,3\n" * 500)
    assert response.headers["content-disposition"] == 'attachment; filename="r.csv"'
    assert len(rows) == 1
    assert rows[0]["path"] == "/api/v1/reports/job-1/csv"


def test_read_only_get_is_not_recorded(client, rows):
    assert client.get("/api/v1/jobs", headers=_web_headers()).status_code == 200
    assert rows == []


def test_unauthenticated_request_is_not_recorded(client, rows):
    assert client.post("/api/v1/upcs", json={"upcs": []}).status_code == 200
    assert rows == []


def test_electron_client_is_not_recorded(client, rows):
    client.post(
        "/api/v1/upcs",
        json={"upcs": []},
        headers={"Authorization": f"Bearer {_bearer()}", "X-Client-Type": "electron"},
    )
    assert rows == []


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/api/v1/auth/presence/heartbeat"),
        ("POST", "/api/v1/auth/presence/leave"),
        ("POST", "/api/v1/audit/events"),
        ("PUT", "/api/v1/notifications/read-all"),
        ("PUT", "/api/v1/notifications/55/read"),
        ("GET", "/api/v1/jobs"),
        ("OPTIONS", "/api/v1/jobs"),
        ("GET", "/health"),
    ],
)
def test_noise_and_views_are_skipped(method, path):
    assert should_audit(method, path) is False


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/api/v1/scheduler/uploaded-report"),
        ("PUT", "/api/v1/scheduler/settings"),
        ("DELETE", "/api/v1/scheduler/uploaded-report/abc"),
        ("POST", "/api/v1/scheduler/uploaded-report/rerun"),
        ("POST", "/api/v1/analytics/off-price/mismatch-test"),
        ("POST", "/api/v1/analytics/off-price/mismatch-fix"),
        ("DELETE", "/api/v1/analytics/off-price/demo-snapshots"),
        ("PUT", "/api/v1/analytics/off-price/tracking/tev"),
        ("PUT", "/api/v1/auth/upc-dnk-print-id-allowlist"),
        ("GET", "/api/v1/keepa-import-export/dnk/download"),
        ("GET", "/api/v1/keepa-import-export/builds/abc/download"),
        ("GET", "/api/v1/keepa-import-export/builds/history/abc/download"),
    ],
)
def test_handler_logged_routes_are_not_double_logged(method, path):
    assert should_audit(method, path) is False


@pytest.mark.parametrize(
    "method,path,action,category",
    [
        ("POST", "/api/v1/jobs", "job.create", "job"),
        ("GET", "/api/v1/reports/abc/csv", "report.download", "download"),
        ("POST", "/api/v1/email-recipients/pool", "email.pool_add", "email"),
        ("POST", "/api/v1/manifest-generator/generate", "manifest.generate", "tool"),
        ("POST", "/api/v1/auth/users/abc/approve", "admin.user_approve", "admin"),
    ],
)
def test_known_routes_get_friendly_actions(method, path, action, category):
    assert should_audit(method, path) is True
    descriptor = describe(method, path)
    assert descriptor.action == action
    assert descriptor.category == category
    assert descriptor.label


def test_describe_includes_vendor_from_query():
    descriptor = describe(
        "PUT",
        "/api/v1/scheduler/settings",
        {"category": "tev"},
    )
    assert descriptor.action == "scheduler.settings_update"
    assert descriptor.label == "Updated TEV Daily Run scheduler settings"


def test_describe_upload_delete_includes_category():
    descriptor = describe(
        "DELETE",
        "/api/v1/scheduler/uploaded-report/abc",
        {"category": "clk"},
    )
    assert descriptor.action == "scheduler.upload_delete"
    assert descriptor.label == "Deleted an uploaded Keepa report for CLK"


def test_describe_analytics_tracking_from_path_and_query():
    descriptor = describe(
        "PUT",
        "/api/v1/analytics/off-price/tracking/tev",
        {"enabled": "false"},
    )
    assert descriptor.action == "analytics.tracking_update"
    assert descriptor.label == "Stopped Analytics tracking for TEV"


def test_unmapped_route_falls_back_to_derived_action():
    descriptor = describe("POST", "/api/v1/some/new/thing/9")
    assert descriptor.action == "post.some_new_thing"
    assert descriptor.category == "other"
