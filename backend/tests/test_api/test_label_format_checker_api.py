"""API tests for the Label Format Checker endpoint (router mounted on a minimal app)."""
from __future__ import annotations

import base64
import io
import zipfile
from pathlib import Path

import pytest

pytest.importorskip("fitz")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import load_workbook  # noqa: E402
from slowapi import _rate_limit_exceeded_handler  # noqa: E402
from slowapi.errors import RateLimitExceeded  # noqa: E402

from app.api import label_format_checker as api  # noqa: E402
from app.middleware.rate_limiter import limiter  # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "label_format"
MIXED = FIXTURES / "FBA19Y05XLDY-FBADNK17112026.pdf"
SINGLE = FIXTURES / "FBA19Y08MQFZ-FBADNK25112026.pdf"


@pytest.fixture()
def client():
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.include_router(api.router, prefix="/api/v1")
    limiter.reset()
    return TestClient(app)


def _post(client: TestClient, name: str, data: bytes, content_type: str = "application/octet-stream"):
    return client.post("/api/v1/label-format-checker/check", files={"file": (name, data, content_type)})


def test_single_pdf_returns_preview_and_report(client):
    res = _post(client, MIXED.name, MIXED.read_bytes(), "application/pdf")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["summary"] == {"total": 1, "passed": 1, "review": 0, "failed": 0, "skipped": 0}
    file = body["files"][0]
    assert file["status"] == "pass"
    assert file["box_id"] == "FBA19Y05XLDYU000001"
    assert file["thumbnails"] and file["thumbnails"][0]["src"].startswith("data:image/png;base64,")

    report = base64.b64decode(body["report_xlsx_base64"])
    wb = load_workbook(io.BytesIO(report))
    assert "Results" in wb.sheetnames
    assert body["report_filename"].endswith(".xlsx")


def test_zip_returns_all_files(client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.write(MIXED, MIXED.name)
        zf.write(SINGLE, SINGLE.name)
        zf.writestr("readme.txt", "x")
    res = _post(client, "labels.zip", buf.getvalue(), "application/zip")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["summary"]["total"] == 2
    assert body["summary"]["passed"] == 2
    assert body["summary"]["skipped"] == 1


@pytest.mark.parametrize(
    "name,data,fragment",
    [
        ("labels.png", b"x", "not supported"),
        ("labels.pdf", b"", "empty"),
        ("labels.pdf", b"not a pdf", "not a PDF"),
        ("labels.zip", b"not a zip", "not a valid ZIP"),
    ],
)
def test_bad_uploads_get_a_400_with_a_helpful_message(client, name, data, fragment):
    res = _post(client, name, data)
    assert res.status_code == 400
    assert fragment in res.json()["detail"]


def test_damaged_label_is_reported_not_errored(client):
    import fitz

    doc = fitz.open(MIXED)
    doc.delete_page(1)
    res = _post(client, "FBA19Y05XLDY-FBADNK17112026.pdf", doc.tobytes(), "application/pdf")
    assert res.status_code == 200
    body = res.json()
    assert body["summary"]["failed"] == 1
    failed = [c["id"] for c in body["files"][0]["checks"] + body["files"][0]["boxes"][0]["checks"] if c["status"] == "fail"]
    assert "ups.missing" in failed
