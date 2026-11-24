"""API tests for the LTL Label Format Checker endpoint (router mounted on a minimal app)."""
from __future__ import annotations

import base64
import io
from pathlib import Path

import pytest

pytest.importorskip("fitz")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import load_workbook  # noqa: E402
from slowapi import _rate_limit_exceeded_handler  # noqa: E402
from slowapi.errors import RateLimitExceeded  # noqa: E402

from app.api import ltl_label_format_checker as api  # noqa: E402
from app.middleware.rate_limiter import limiter  # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "ltl_label_format"
CORRECT = FIXTURES / "FBA19WTTW2CG-correct_order.pdf"
WRONG = FIXTURES / "FBA19WBXZVZZ-wrong_order.pdf"


@pytest.fixture()
def client():
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.include_router(api.router, prefix="/api/v1")
    limiter.reset()
    return TestClient(app)


def _post(client: TestClient, uploads: list[tuple[str, bytes, str]]):
    return client.post(
        "/api/v1/ltl-label-format-checker/check",
        files=[("files", (name, data, content_type)) for name, data, content_type in uploads],
    )


def test_correct_and_wrong_order_pdfs(client):
    res = _post(
        client,
        [
            (CORRECT.name, CORRECT.read_bytes(), "application/pdf"),
            (WRONG.name, WRONG.read_bytes(), "application/pdf"),
        ],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["summary"] == {
        "total": 2, "passed": 1, "review": 0, "failed": 1, "skipped": 0, "out_of_order": 1,
    }
    by_name = {f["name"]: f for f in body["files"]}
    assert by_name[CORRECT.name]["status"] == "pass"
    assert by_name[CORRECT.name]["box_order"]["status"] == "pass"
    wrong = by_name[WRONG.name]
    assert wrong["status"] == "fail"
    assert wrong["box_order"]["out_of_order"] == 61
    assert wrong["box_order"]["entries"][0] == {
        "page": 1,
        "box_id": "FBA19WBXZVZZU000001",
        "box_tag": "FBA19WBXZVZZ - B2",
        "pack_group": "FBA19WBXZVZZ",
        "found": 2,
        "expected": 1,
        "ok": False,
    }
    assert wrong["thumbnails"] and wrong["thumbnails"][0]["src"].startswith("data:image/png;base64,")

    wb = load_workbook(io.BytesIO(base64.b64decode(body["report_xlsx_base64"])))
    assert "Box order" in wb.sheetnames
    assert body["report_filename"].startswith("LTL Label Format Check - ")


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
    res = _post(client, [(name, data, "application/octet-stream")])
    assert res.status_code == 400
    assert fragment in res.json()["detail"]
