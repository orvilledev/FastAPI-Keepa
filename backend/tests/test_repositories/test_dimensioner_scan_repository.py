"""dimensioner_scans data access: duplicates, missing table, and search escaping."""
from unittest.mock import MagicMock

import pytest

from app.repositories.dimensioner_scan_repository import (
    DimensionerScanRepository,
    DimensionerStorageError,
)


def _db():
    db = MagicMock()
    table = MagicMock()
    db.table.return_value = table
    for name in ("select", "insert", "delete", "eq", "ilike", "order", "limit"):
        getattr(table, name).return_value = table
    table.execute.return_value = MagicMock(data=[])
    return db, table


def test_insert_returns_the_saved_row():
    db, table = _db()
    table.execute.return_value = MagicMock(data=[{"id": "1", "barcode": "B"}])

    assert DimensionerScanRepository(db).insert({"dedupe_key": "k"}) == {"id": "1", "barcode": "B"}
    db.table.assert_called_with("dimensioner_scans")


def test_duplicate_key_means_already_stored_not_an_error():
    db, table = _db()
    table.execute.side_effect = Exception(
        'duplicate key value violates unique constraint "dimensioner_scans_dedupe_key_key" (23505)'
    )

    assert DimensionerScanRepository(db).insert({"dedupe_key": "k"}) is None


def test_missing_table_points_at_the_migration():
    db, table = _db()
    table.execute.side_effect = Exception(
        "Could not find the table 'public.dimensioner_scans' in the schema cache"
    )

    with pytest.raises(DimensionerStorageError, match="create_dimensioner_scans.sql"):
        DimensionerScanRepository(db).insert({"dedupe_key": "k"})


def test_other_database_errors_are_wrapped():
    db, table = _db()
    table.execute.side_effect = Exception("connection reset")

    with pytest.raises(DimensionerStorageError, match="connection reset"):
        DimensionerScanRepository(db).insert({"dedupe_key": "k"})


def test_list_orders_newest_first_and_applies_the_limit():
    db, table = _db()
    table.execute.return_value = MagicMock(data=[{"id": "1"}])

    rows = DimensionerScanRepository(db).list_recent(25)

    assert rows == [{"id": "1"}]
    table.order.assert_called_with("received_at", desc=True)
    table.limit.assert_called_with(25)
    table.ilike.assert_not_called()


def test_list_search_matches_literally():
    db, table = _db()

    DimensionerScanRepository(db).list_recent(10, "50%_off")

    table.ilike.assert_called_once_with("barcode", "%50\\%\\_off%")


def test_blank_search_is_ignored():
    db, table = _db()

    DimensionerScanRepository(db).list_recent(10, "   ")

    table.ilike.assert_not_called()


def test_delete_reports_whether_anything_was_removed():
    db, table = _db()
    table.execute.return_value = MagicMock(data=[])
    assert DimensionerScanRepository(db).delete("missing") is False
    table.delete.assert_not_called()

    db, table = _db()
    table.execute.return_value = MagicMock(data=[{"id": "1"}])
    assert DimensionerScanRepository(db).delete("1") is True
    table.delete.assert_called_once()
