"""Tests for shared AMZ reconcile helpers used by DNK / Tool2 compare."""
from __future__ import annotations

from collections import defaultdict

from app.services.fba_upload_compare import (
    MISSING_UPC_REASON,
    NOT_IN_AMZ_REASON,
    RELOCATED_REASON,
    SEEDED_BOX_REASON,
    SHORTFALL_REASON,
    SURPLUS_REASON,
    AmzSkuRow,
    ContentRow,
    ParsedAmz,
    reconcile_to_amz,
)


def _amz(*pairs: tuple[str, int]) -> ParsedAmz:
    return ParsedAmz(skus=[AmzSkuRow(sku_id=sku, expected_qty=qty) for sku, qty in pairs])


def _rows(*triples: tuple[str, int, int]) -> list[ContentRow]:
    return [ContentRow(identifier=u, box_number=b, qty=q) for u, b, q in triples]


def _totals(rows) -> dict[str, int | float]:
    totals: dict[str, int | float] = defaultdict(int)
    for row in rows:
        totals[row.identifier] += row.qty
    return dict(totals)


def test_reconcile_leaves_matching_rows_untouched():
    rows = _rows(("111", 1, 4), ("222", 2, 6))
    result = reconcile_to_amz(rows, _amz(("111", 4), ("222", 6)), {})

    assert result.rows == rows
    assert result.added == []
    assert result.removed == []
    assert result.box_numbers == [1, 2]
    assert result.last_box == 2


def _box_totals(rows) -> dict[int, int | float]:
    totals: dict[int, int | float] = defaultdict(int)
    for row in rows:
        totals[row.box_number] += row.qty
    return dict(totals)


def test_reconcile_drops_upcs_the_amz_file_does_not_expect():
    result = reconcile_to_amz(
        _rows(("111", 1, 4), ("999", 1, 7), ("999", 2, 3)),
        _amz(("111", 4)),
        {},
    )

    assert _totals(result.rows) == {"111": 4}
    dropped = [a for a in result.removed if a.reason == NOT_IN_AMZ_REASON]
    assert [(a.identifier, a.box_number, a.qty) for a in dropped] == [
        ("999", 1, 7),
        ("999", 2, 3),
    ]


def test_reconcile_never_deducts_the_last_unit_out_of_a_box():
    # The reported case: box 1 holds 1 unit, box 2 holds 2, and 1 unit must go.
    # It has to come off box 2, because box 1 would otherwise end up empty.
    result = reconcile_to_amz(
        _rows(("111", 1, 1), ("111", 2, 2)),
        _amz(("111", 2)),
        {},
    )

    assert [(r.box_number, r.qty) for r in result.rows] == [(1, 1), (2, 1)]
    assert [(a.box_number, a.qty, a.reason) for a in result.removed] == [(2, 1, SURPLUS_REASON)]


def test_reconcile_trims_the_tail_first_but_stops_at_the_per_box_floor():
    result = reconcile_to_amz(
        _rows(("111", 1, 5), ("111", 2, 4), ("111", 3, 3)),
        _amz(("111", 6)),
        {},
    )

    # 12 units down to 6, taken from the tail but leaving every box alive.
    assert [(r.box_number, r.qty) for r in result.rows] == [(1, 4), (2, 1), (3, 1)]
    assert [(a.box_number, a.qty, a.reason) for a in result.removed] == [
        (3, 2, SURPLUS_REASON),
        (2, 3, SURPLUS_REASON),
        (1, 1, SURPLUS_REASON),
    ]
    assert _totals(result.rows) == {"111": 6}


def test_reconcile_keeps_every_box_populated_when_trimming_to_the_bone():
    result = reconcile_to_amz(
        _rows(("111", 1, 4), ("111", 2, 4), ("111", 3, 4)),
        _amz(("111", 3)),
        {},
    )

    assert _box_totals(result.rows) == {1: 1, 2: 1, 3: 1}
    assert _totals(result.rows) == {"111": 3}


def test_reconcile_adds_missing_upc_to_the_last_box():
    result = reconcile_to_amz(
        _rows(("111", 1, 4), ("111", 3, 2)),
        _amz(("111", 6), ("222", 9)),
        {},
    )

    assert [(a.identifier, a.box_number, a.qty, a.reason) for a in result.added] == [
        ("222", 3, 9, MISSING_UPC_REASON)
    ]
    added_row = next(row for row in result.rows if row.identifier == "222")
    assert (added_row.box_number, added_row.qty, added_row.added) == (3, 9, True)
    assert _totals(result.rows) == {"111": 6, "222": 9}


def test_reconcile_merges_a_shortfall_into_an_existing_last_box_row():
    result = reconcile_to_amz(
        _rows(("111", 1, 4), ("111", 2, 1)),
        _amz(("111", 10)),
        {},
    )

    assert [(a.box_number, a.qty, a.reason) for a in result.added] == [(2, 5, SHORTFALL_REASON)]
    # The shortfall lands on the existing last-box row instead of duplicating it.
    assert [(r.identifier, r.box_number, r.qty, r.added) for r in result.rows] == [
        ("111", 1, 4, False),
        ("111", 2, 6, True),
    ]
    assert _totals(result.rows) == {"111": 10}


def test_reconcile_seeds_a_box_emptied_by_unexpected_upcs_from_the_added_units():
    # Box 2 holds nothing the AMZ file expects, so it is seeded from 222's top-up
    # instead of being left empty for Seller Central to drop.
    result = reconcile_to_amz(
        _rows(("111", 1, 4), ("999", 2, 7), ("111", 3, 1)),
        _amz(("111", 5), ("222", 9)),
        {},
    )

    assert result.box_numbers == [1, 2, 3]
    assert _box_totals(result.rows) == {1: 4, 2: 1, 3: 9}
    assert _totals(result.rows) == {"111": 5, "222": 9}
    assert [(a.identifier, a.box_number, a.qty, a.reason) for a in result.added] == [
        ("222", 2, 1, SEEDED_BOX_REASON),
        ("222", 3, 8, MISSING_UPC_REASON),
    ]


def test_reconcile_relocates_a_unit_when_nothing_is_being_added():
    # Box 2 empties and there is no shortfall to seed from, so a unit moves out
    # of the fullest box. Per-UPC totals still match the AMZ file.
    result = reconcile_to_amz(
        _rows(("111", 1, 4), ("999", 2, 7), ("111", 3, 1)),
        _amz(("111", 5)),
        {},
    )

    assert _box_totals(result.rows) == {1: 3, 2: 1, 3: 1}
    assert _totals(result.rows) == {"111": 5}
    assert [(a.identifier, a.box_number, a.qty, a.reason) for a in result.added] == [
        ("111", 2, 1, SEEDED_BOX_REASON)
    ]
    assert ("111", 1, 1, RELOCATED_REASON) in [
        (a.identifier, a.box_number, a.qty, a.reason) for a in result.removed
    ]


def test_reconcile_never_leaves_an_empty_box_for_the_reported_shipment_shape():
    # Three boxes whose entire contents are unexpected, plus a big top-up.
    result = reconcile_to_amz(
        _rows(("111", 1, 8), ("999", 2, 40), ("888", 3, 11), ("777", 4, 91), ("111", 5, 4)),
        _amz(("111", 12), ("222", 100)),
        {},
    )

    totals = _box_totals(result.rows)
    assert sorted(totals) == [1, 2, 3, 4, 5]
    assert all(qty >= 1 for qty in totals.values())
    assert _totals(result.rows) == {"111": 12, "222": 100}


def test_reconcile_matches_old_sku_identifiers_through_the_catalog():
    result = reconcile_to_amz(
        [ContentRow(identifier="9990262", box_number=1, qty=4)],
        _amz(("111", 6)),
        {"111": "9990262"},
    )

    # Resolved to the AMZ id, relabelled, and topped up rather than replaced.
    assert [(r.identifier, r.box_number, r.qty, r.remapped) for r in result.rows] == [
        ("111", 1, 6, True)
    ]
    assert result.removed == []


def test_reconcile_result_always_equals_the_amz_expected_quantities():
    amz = _amz(("111", 6), ("222", 1), ("333", 12), ("444", 3))
    result = reconcile_to_amz(
        _rows(
            ("111", 1, 20),
            ("222", 1, 1),
            ("333", 2, 4),
            ("999", 2, 8),
            ("333", 4, 1),
        ),
        amz,
        {},
    )

    assert _totals(result.rows) == {"111": 6, "222": 1, "333": 12, "444": 3}
    original = 20 + 1 + 4 + 8 + 1
    added = sum(a.qty for a in result.added)
    removed = sum(a.qty for a in result.removed)
    assert original + added - removed == sum(row.expected_qty for row in amz.skus)
