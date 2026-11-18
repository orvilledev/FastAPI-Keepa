"""Tests for Label Station II catalog lookups (FNSKU comes from warehouse_products)."""
import pytest

from app.repositories.label_station2_product_repository import (
    LabelStation2NotFound,
    LabelStation2ProductRepository,
    build_label_station2_search_filter,
    upc_match_keys,
)


class _Result:
    def __init__(self, data):
        self.data = data
        self.count = len(data)


class _Query:
    def __init__(self, rows):
        self._rows = rows
        self._filters = []
        self._limit = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self._filters.append(lambda row: row.get(column) == value)
        return self

    def in_(self, column, values):
        wanted = set(values)
        self._filters.append(lambda row: row.get(column) in wanted)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        rows = [r for r in self._rows if all(f(r) for f in self._filters)]
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Result(rows)


class _FakeDb:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Query(self.tables.get(name, []))


def _ugg(upc="194715379404"):
    return {
        "upc": upc,
        "external_id": "194715379404",
        "description": "M-ASCOT",
        "vendor_name": "UGG",
        "size": "10 M",
        "color": "GREY SUEDE",
        "mpn": "1101110",
    }


def _repo(ls2_rows, source_rows):
    return LabelStation2ProductRepository(
        _FakeDb({"label_station2_products": ls2_rows, "warehouse_products": source_rows})
    )


def test_upc_match_keys_covers_dropped_leading_zeros():
    assert upc_match_keys("012345678905") == [
        "012345678905",
        "12345678905",
        "0012345678905",
        "00012345678905",
    ]
    assert upc_match_keys("12345678905")[0] == "12345678905"
    assert "012345678905" in upc_match_keys("12345678905")
    assert upc_match_keys(" amzn.gr.1 ") == ["amzn.gr.1"]
    assert upc_match_keys("") == []


def test_resolve_scan_fnsku_to_upc_to_product():
    repo = _repo([_ugg()], [{"upc": "194715379404", "fnsku": "X0056D33KL"}])
    row = repo.resolve_scan(" X0056D33KL ")
    assert row["upc"] == "194715379404"
    assert row["fnsku"] == "X0056D33KL"
    assert row["description"] == "M-ASCOT"
    assert row["size"] == "10 M"


def test_resolve_scan_lowercase_fnsku():
    repo = _repo([_ugg()], [{"upc": "194715379404", "fnsku": "X0056D33KL"}])
    assert repo.resolve_scan("x0056d33kl")["fnsku"] == "X0056D33KL"


def test_resolve_scan_matches_upc_without_leading_zero():
    repo = _repo([_ugg("12345678905")], [{"upc": "012345678905", "fnsku": "X00TEST001"}])
    row = repo.resolve_scan("X00TEST001")
    assert row["upc"] == "12345678905"
    assert row["fnsku"] == "X00TEST001"


def test_resolve_scan_upc_fallback_attaches_fnsku():
    repo = _repo([_ugg()], [{"upc": "194715379404", "fnsku": "X0056D33KL"}])
    row = repo.resolve_scan("194715379404")
    assert row["fnsku"] == "X0056D33KL"


def test_resolve_scan_upc_without_fnsku_still_resolves():
    repo = _repo([_ugg()], [])
    row = repo.resolve_scan("194715379404")
    assert row["fnsku"] == ""
    assert row["vendor_name"] == "UGG"


def test_resolve_scan_fnsku_known_but_not_in_label_station2():
    repo = _repo([], [{"upc": "194715379404", "fnsku": "X0056D33KL"}])
    with pytest.raises(LabelStation2NotFound) as exc:
        repo.resolve_scan("X0056D33KL")
    assert "194715379404" in exc.value.message
    assert "Label Station II" in exc.value.message


def test_resolve_scan_unknown():
    repo = _repo([_ugg()], [])
    with pytest.raises(LabelStation2NotFound):
        repo.resolve_scan("X000NOPE00")


def test_resolve_scan_picks_fnsku_row_that_exists_in_label_station2():
    repo = _repo(
        [_ugg("222222222222")],
        [
            {"upc": "111111111111", "fnsku": "XDUP"},
            {"upc": "222222222222", "fnsku": "XDUP"},
        ],
    )
    assert repo.resolve_scan("XDUP")["upc"] == "222222222222"


def test_fnsku_by_upcs_prefers_exact_upc():
    repo = _repo(
        [],
        [
            {"upc": "12345678905", "fnsku": "XEXACT"},
            {"upc": "012345678905", "fnsku": "XPADDED"},
        ],
    )
    assert repo.fnsku_by_upcs(["012345678905"]) == {"012345678905": "XPADDED"}
    assert repo.fnsku_by_upcs(["12345678905"]) == {"12345678905": "XEXACT"}
    assert repo.fnsku_by_upcs(["999"]) == {}


def test_search_filter_includes_fnsku_upcs():
    flt = build_label_station2_search_filter("ugg", ["194715379404"])
    assert 'vendor_name.ilike."%ugg%"' in flt
    assert 'upc.in.("194715379404")' in flt
    assert build_label_station2_search_filter("  ") is None
