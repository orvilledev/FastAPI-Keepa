"""Scan endpoint: every scan with a box number is stored, and never half-saved."""
import uuid

import pytest
from fastapi import HTTPException

from app.api import fba_shipment_library as api
from app.models.fba_shipment_library import FbaShipmentScanRequest
from app.services.fba_shipment_library import build_accounting_workbook

USER = {"id": "user-1", "email": "worker@example.com"}
LINE_ID = "11111111-1111-1111-1111-111111111111"
UNKNOWN_ID = "22222222-2222-2222-2222-222222222222"


class FakeRepo:
    """In-memory stand-in for FbaShipmentLibraryRepository."""

    def __init__(self, *, fail_count=False, missing_box_table=False):
        self.fail_count = fail_count
        self.missing_box_table = missing_box_table
        self.lines = [
            {"id": LINE_ID, "line_number": 1, "merchant_sku": "A", "external_id": "111", "shipped": 2},
        ]
        self.counts: dict[str, int] = {}
        self.unknowns: dict[str, int] = {}
        self.box_rows: dict[str, dict] = {}
        self._next = 0

    def get_upload(self, upload_id):
        return {"id": upload_id, "created_by": USER["id"], "is_locked": False}

    def lines_for_barcode(self, upload_id, barcode):
        return [dict(row) for row in self.lines if row["external_id"] == barcode]

    def counts_for_lines(self, line_ids, user_id=None):
        return {key: value for key, value in self.counts.items() if key in line_ids}

    def list_unknown_scans(self, upload_id, user_id=None):
        return [
            {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, key)), "external_id": key, "counted": value}
            for key, value in self.unknowns.items()
        ]

    def list_lines(self, upload_id, *, limit=100, offset=0, search=None, line_ids=None):
        term = " ".join((search or "").strip().split()).casefold()
        rows = [
            dict(row)
            for row in self.lines
            if not term
            or term in str(row.get("merchant_sku") or "").casefold()
            or term in str(row.get("external_id") or "").casefold()
        ]
        return rows[offset : offset + limit], len(rows)

    def list_line_quantities(self, upload_id):
        return [dict(row) for row in self.lines]

    def record_box_scan(self, upload_id, user_id, external_id, box_number, line_id=None):
        if self.missing_box_table:
            raise ValueError("The FBA Order Checker tables are missing.")
        self._next += 1
        row_id = f"box-{self._next}"
        self.box_rows[row_id] = {"external_id": external_id, "box_number": box_number, "line_id": line_id}
        return row_id

    def counted_in_box(self, upload_id, box_number, line_counts, unknown_counts):
        lines = {
            key: sum(1 for row in self.box_rows.values() if row["line_id"] == key and row["box_number"] == box_number)
            for key in line_counts
        }
        unknown = {
            key: sum(
                1
                for row in self.box_rows.values()
                if not row["line_id"] and row["external_id"] == key and row["box_number"] == box_number
            )
            for key in unknown_counts
        }
        return lines, unknown

    def delete_box_scan(self, box_scan_id):
        self.box_rows.pop(box_scan_id, None)

    def increment_count(self, upload_id, line_id, user_id):
        if self.fail_count:
            raise ValueError("Could not record that scan. Scan it again.")
        self.counts[line_id] = self.counts.get(line_id, 0) + 1
        return self.counts[line_id]

    def increment_unknown_scan(self, upload_id, user_id, external_id):
        if self.fail_count:
            raise ValueError("Could not record that scan. Scan it again.")
        self.unknowns[external_id] = self.unknowns.get(external_id, 0) + 1
        return {"id": UNKNOWN_ID, "external_id": external_id, "counted": self.unknowns[external_id]}


@pytest.fixture()
def wire(monkeypatch):
    def install(repo: FakeRepo):
        monkeypatch.setattr(api, "FbaShipmentLibraryRepository", lambda db: repo)
        monkeypatch.setattr(api, "is_superadmin_user", lambda user, db: False)

    return install


def _scan(barcode, box):
    return api.scan_fba_shipment.__wrapped__("upload-1", FbaShipmentScanRequest(barcode=barcode, box_number=box), USER, None)


def test_a_scan_without_a_box_number_is_rejected(wire):
    repo = FakeRepo()
    wire(repo)
    with pytest.raises(HTTPException) as caught:
        _scan("111", None)
    assert caught.value.status_code == 400
    assert "box number" in caught.value.detail.lower()
    assert repo.counts == {}
    assert repo.box_rows == {}
    assert repo.unknowns == {}


def test_known_and_unknown_scans_store_their_box(wire):
    repo = FakeRepo()
    wire(repo)
    first = _scan("111", 4)
    _scan("111", 4)
    unknown = _scan("999", 9)
    assert first.box_number == 4
    assert first.line.counted == 1
    assert unknown.line.not_in_list is True
    assert sorted((row["external_id"], row["box_number"]) for row in repo.box_rows.values()) == [
        ("111", 4),
        ("111", 4),
        ("999", 9),
    ]
    assert repo.counts == {LINE_ID: 2}
    assert repo.unknowns == {"999": 1}


def test_a_scan_reports_the_count_in_its_own_box_and_the_shipment_total(wire):
    repo = FakeRepo()
    wire(repo)
    _scan("111", 4)
    in_four = _scan("111", 4)
    in_six = _scan("111", 6)
    unknown = _scan("999", 9)
    assert (in_four.box_counted, in_four.line.counted) == (2, 2)
    assert (in_six.box_counted, in_six.line.counted) == (1, 3)
    assert in_six.line.status == "Overage"
    assert unknown.box_counted == 1


def test_a_failed_count_removes_the_box_record(wire):
    repo = FakeRepo(fail_count=True)
    wire(repo)
    with pytest.raises(HTTPException):
        _scan("111", 1)
    with pytest.raises(HTTPException):
        _scan("999", 1)
    assert repo.box_rows == {}
    assert repo.counts == {} and repo.unknowns == {}


def test_missing_box_table_stops_the_scan_before_it_is_counted(wire):
    repo = FakeRepo(missing_box_table=True)
    wire(repo)
    with pytest.raises(HTTPException) as caught:
        _scan("111", 1)
    assert "tables are missing" in caught.value.detail
    assert repo.counts == {}


def test_stored_scans_produce_a_workbook_that_matches(wire):
    repo = FakeRepo()
    wire(repo)
    for barcode, box in [("111", 1), ("111", 2), ("999", 2)]:
        _scan(barcode, box)
    lines = [{**row, "counted": repo.counts.get(row["id"], 0)} for row in repo.lines]
    unknown = [{"external_id": key, "counted": value} for key, value in repo.unknowns.items()]
    boxed = list(repo.box_rows.values())
    content = build_accounting_workbook(
        shipment_id="FBA1", counted_by="Worker", lines=lines, unknown_lines=unknown, box_scans=boxed
    )
    from io import BytesIO

    from openpyxl import load_workbook

    sheet = load_workbook(BytesIO(content))["Boxed"]
    log = [tuple(c.value for c in row) for row in sheet.iter_rows(min_row=2, max_col=3)]
    assert [row for row in log if row[0] is not None] == [
        ("111", 1, 1),
        ("111", 1, 2),
        ("999", 1, 2),
    ]


def _open(repo: FakeRepo, search=None):
    upload_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    repo.get_upload = lambda _upload_id: {
        "id": upload_id,
        "created_by": "00000000-0000-0000-0000-000000000001",
        "created_at": "2026-10-19T12:45:40+00:00",
        "shipment_id": "FBA19T3YGF07",
        "is_locked": False,
    }
    return api.get_fba_shipment.__wrapped__(upload_id, 100, 0, search, None, USER, None)


def test_sku_search_hides_unknown_scans_that_are_not_the_searched_id(wire):
    repo = FakeRepo()
    repo.lines = [
        {
            "id": LINE_ID,
            "line_number": 1,
            "merchant_sku": "845028000027",
            "external_id": "845028000027",
            "shipped": 3,
        },
        {
            "id": "33333333-3333-3333-3333-333333333333",
            "line_number": 2,
            "merchant_sku": "OTHER-SKU",
            "external_id": "111",
            "shipped": 1,
        },
    ]
    repo.unknowns = {"810173985413": 1}
    wire(repo)

    detail = _open(repo, "845028000027")
    assert [line.external_id for line in detail.lines] == ["845028000027"]
    assert detail.unknown_lines == []
    assert detail.total == 1

    unknown_only = _open(repo, "810173985413")
    assert unknown_only.lines == []
    assert [line.external_id for line in unknown_only.unknown_lines] == ["810173985413"]

    everything = _open(repo, None)
    assert len(everything.lines) == 2
    assert [line.external_id for line in everything.unknown_lines] == ["810173985413"]
