"""Counts belong to the shipment: everyone who opens it sees everyone's scans."""
from app.repositories.fba_shipment_library_repository import FbaShipmentLibraryRepository

UPLOAD = "upload-1"
LINE_A = "line-a"
LINE_B = "line-b"
OWNER = "owner"
SHARED = "shared-user"


class _Response:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows):
        self._rows = list(rows)
        self._start = 0
        self._end = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self._rows = [row for row in self._rows if row.get(column) == value]
        return self

    def in_(self, column, values):
        self._rows = [row for row in self._rows if row.get(column) in values]
        return self

    def order(self, column, desc=False):
        self._rows.sort(key=lambda row: str(row.get(column)), reverse=desc)
        return self

    def range(self, start, end):
        self._start, self._end = start, end
        return self

    def execute(self):
        # supabase-py treats the range end as exclusive.
        rows = self._rows[self._start : self._end]
        return _Response([dict(row) for row in rows])


class _Db:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Query(self.tables.get(name, []))


def _repo():
    db = _Db(
        {
            "fba_shipment_counts": [
                {"id": "1", "upload_id": UPLOAD, "line_id": LINE_A, "user_id": OWNER, "counted": 2},
                {"id": "2", "upload_id": UPLOAD, "line_id": LINE_A, "user_id": SHARED, "counted": 1},
                {"id": "3", "upload_id": UPLOAD, "line_id": LINE_B, "user_id": OWNER, "counted": 4},
            ],
            "fba_shipment_unknown_scans": [
                {"id": "u1", "upload_id": UPLOAD, "user_id": OWNER, "external_id": "999", "counted": 1, "updated_at": "2"},
                {"id": "u2", "upload_id": UPLOAD, "user_id": SHARED, "external_id": "999", "counted": 2, "updated_at": "3"},
                {"id": "u3", "upload_id": UPLOAD, "user_id": SHARED, "external_id": "888", "counted": 1, "updated_at": "1"},
            ],
            "fba_shipment_box_scans": [
                {"id": "b1", "upload_id": UPLOAD, "user_id": OWNER, "external_id": "111", "box_number": 1, "created_at": "1"},
                {"id": "b2", "upload_id": UPLOAD, "user_id": SHARED, "external_id": "111", "box_number": 2, "created_at": "2"},
            ],
        }
    )
    return FbaShipmentLibraryRepository(db)


def test_every_person_sees_the_same_line_counts():
    repo = _repo()
    assert repo.counts_for_lines([LINE_A, LINE_B]) == {LINE_A: 3, LINE_B: 4}


def test_one_person_can_still_be_asked_for_alone():
    repo = _repo()
    assert repo.counts_for_lines([LINE_A, LINE_B], SHARED) == {LINE_A: 1}


def test_unknown_barcodes_from_everyone_are_added_together():
    rows = {row["external_id"]: row["counted"] for row in _repo().list_unknown_scans(UPLOAD)}
    assert rows == {"999": 3, "888": 1}


def test_counted_in_box_uses_only_that_box():
    db = _Db(
        {
            "fba_shipment_box_scans": [
                {"id": "1", "upload_id": UPLOAD, "line_id": LINE_A, "external_id": "111", "box_number": 1, "created_at": "1"},
                {"id": "2", "upload_id": UPLOAD, "line_id": LINE_A, "external_id": "111", "box_number": 1, "created_at": "2"},
                {"id": "3", "upload_id": UPLOAD, "line_id": LINE_A, "external_id": "111", "box_number": 4, "created_at": "3"},
            ],
        }
    )
    repo = FbaShipmentLibraryRepository(db)
    line_counts, unknown_counts = repo.counted_in_box(UPLOAD, 4, {LINE_A: 3}, {})
    assert line_counts == {LINE_A: 1}
    assert unknown_counts == {}


def test_a_typed_box_keeps_only_items_scanned_into_that_box():
    db = _Db(
        {
            "fba_shipment_lines": [
                {"id": LINE_A, "upload_id": UPLOAD, "line_number": 2, "merchant_sku": "A"},
                {"id": LINE_B, "upload_id": UPLOAD, "line_number": 1, "merchant_sku": "B"},
                {"id": "line-c", "upload_id": UPLOAD, "line_number": 3, "merchant_sku": "C"},
            ],
            "fba_shipment_box_scans": [
                {"id": "b1", "upload_id": UPLOAD, "line_id": LINE_A, "external_id": "111", "box_number": 1},
                {"id": "b2", "upload_id": UPLOAD, "line_id": LINE_B, "external_id": "222", "box_number": 2},
                {"id": "b3", "upload_id": UPLOAD, "line_id": None, "external_id": "UPC: 999", "box_number": 1},
            ],
        }
    )
    repo = FbaShipmentLibraryRepository(db)
    line_ids, unknown = repo.box_scan_keys(UPLOAD, 1)
    assert line_ids == [LINE_A]
    assert unknown == {"999"}
    rows, total = repo.list_lines(UPLOAD, line_ids=line_ids)
    assert total == 1
    assert [row["id"] for row in rows] == [LINE_A]
    empty_rows, empty_total = repo.list_lines(UPLOAD, line_ids=[])
    assert empty_rows == []
    assert empty_total == 0


def test_box_scans_after_the_first_thousand_are_included():
    rows = [
        {
            "id": f"{index:04d}",
            "upload_id": UPLOAD,
            "external_id": "111",
            "box_number": 1,
            "created_at": f"{index:04d}",
        }
        for index in range(1001)
    ]
    repo = FbaShipmentLibraryRepository(_Db({"fba_shipment_box_scans": rows}))
    assert len(repo.list_box_scans(UPLOAD)) == 1001


def test_the_report_includes_everyones_box_scans():
    repo = _repo()
    assert [(row["external_id"], row["box_number"]) for row in repo.list_box_scans(UPLOAD)] == [
        ("111", 1),
        ("111", 2),
    ]


def test_everyone_who_scanned_is_listed_once():
    assert _repo().counter_user_ids(UPLOAD) == [OWNER, SHARED]


class _MutableQuery:
    def __init__(self, rows):
        self._rows = rows
        self._filters: list[tuple[str, object]] = []
        self._op = "select"
        self._payload = None

    def select(self, *_args, **_kwargs):
        self._op = "select"
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, column, value):
        self._filters.append((column, value))
        return self

    def limit(self, _count):
        return self

    def execute(self):
        matched = [row for row in self._rows if all(row.get(column) == value for column, value in self._filters)]
        if self._op == "delete":
            self._rows[:] = [row for row in self._rows if row not in matched]
            return _Response([dict(row) for row in matched])
        if self._op == "update":
            for row in matched:
                row.update(self._payload)
            return _Response([dict(row) for row in matched])
        return _Response([dict(row) for row in matched])


class _MutableDb:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _MutableQuery(self.tables.setdefault(name, []))


def test_deleting_a_unit_removes_that_person_count_then_the_scan():
    counts = [
        {"id": "1", "line_id": LINE_A, "user_id": OWNER, "counted": 2},
        {"id": "2", "line_id": LINE_A, "user_id": SHARED, "counted": 1},
    ]
    scans = [
        {"id": "b1", "upload_id": UPLOAD, "user_id": SHARED, "line_id": LINE_A, "external_id": "111", "box_number": 1},
    ]
    repo = FbaShipmentLibraryRepository(_MutableDb({"fba_shipment_counts": counts, "fba_shipment_box_scans": scans}))

    repo.decrement_count(LINE_A, SHARED)
    assert [row["id"] for row in counts] == ["1"]
    assert counts[0]["counted"] == 2

    repo.decrement_count(LINE_A, "someone-else")
    assert counts[0]["counted"] == 1

    repo.remove_box_scan(UPLOAD, "b1")
    assert scans == []
    assert repo.get_box_scan(UPLOAD, "b1") is None
