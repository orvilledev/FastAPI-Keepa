"""Tests for bulk catalog existence check (SKU / UPC / FNSKU)."""
from __future__ import annotations

from io import BytesIO
from unittest.mock import MagicMock

import openpyxl
import pytest
from openpyxl import Workbook

from app.repositories.warehouse_product_repository import WarehouseProductRepository
from app.services.warehouse_sku_check import (
    WarehouseSkuCheckError,
    generate_sku_check_workbook,
    parse_sku_list_file,
)


def _xlsx_bytes(rows: list[list[object]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_parse_txt_one_per_line_dedupes_and_skips_header():
    raw = b"SKU\n9990357\n9990357\nABC-100\n\n"
    assert parse_sku_list_file("skus.txt", raw) == ["9990357", "ABC-100"]


def test_parse_txt_skips_upc_and_fnsku_headers():
    raw = b"UPC\n198269695492\nFNSKU\nX0052JFNEN\n"
    assert parse_sku_list_file("ids.txt", raw) == ["198269695492", "X0052JFNEN"]


def test_parse_csv_with_upc_column():
    raw = b"UPC,Other\n198269695492,x\nMISSING,y\n"
    assert parse_sku_list_file("list.csv", raw) == ["198269695492", "MISSING"]


def test_parse_xlsx_with_fnsku_header():
    raw = _xlsx_bytes([["FNSKU", "Note"], ["X0052JFNEN", "a"], ["XB", "b"]])
    assert parse_sku_list_file("list.xlsx", raw) == ["X0052JFNEN", "XB"]


def test_parse_xlsx_with_sku_header():
    raw = _xlsx_bytes([["SKU", "Note"], ["9990357", "a"], [1234567.0, "b"]])
    assert parse_sku_list_file("list.xlsx", raw) == ["9990357", "1234567"]


def test_parse_xlsx_first_column_when_no_header():
    raw = _xlsx_bytes([["AAA"], ["BBB"]])
    assert parse_sku_list_file("list.xlsx", raw) == ["AAA", "BBB"]


def test_parse_empty_raises():
    with pytest.raises(WarehouseSkuCheckError, match="No identifiers"):
        parse_sku_list_file("empty.txt", b"\n\n")


def test_generate_workbook_marks_found_and_missing_with_matched_on():
    queries = ["9990357", "MISSING", "X0052JFNEN"]
    found = {
        "9990357": [
            {
                "upc": "198269695492",
                "sku": "9990357",
                "fnsku": "X0052JFNEN",
                "style_name": "Sample",
                "condition": "New",
            }
        ],
        "X0052JFNEN": [
            {
                "upc": "198269695492",
                "sku": "9990357",
                "fnsku": "X0052JFNEN",
                "style_name": "Sample",
                "condition": "New",
            }
        ],
    }
    result = generate_sku_check_workbook(queries, found)
    assert result.total == 3
    assert result.found == 2
    assert result.missing == 1
    assert result.filename == "Catalog Existence Check.xlsx"

    workbook = openpyxl.load_workbook(BytesIO(result.file_bytes))
    try:
        sheet = workbook["Existence Check"]
        assert sheet["A1"].value == "Input"
        assert sheet["C1"].value == "Matched On"
        assert sheet["A2"].value == "9990357"
        assert sheet["B2"].value == "Yes"
        assert sheet["C2"].value == "SKU"
        assert sheet["D2"].value == "9990357"
        assert sheet["A3"].value == "MISSING"
        assert sheet["B3"].value == "No"
        assert sheet["A4"].value == "X0052JFNEN"
        assert sheet["B4"].value == "Yes"
        assert sheet["C4"].value == "FNSKU"
    finally:
        workbook.close()


def test_lookup_by_identifiers_matches_sku_upc_and_fnsku():
    row = {
        "upc": "198269695492",
        "sku": "9990357",
        "fnsku": "X0052JFNEN",
        "style_name": "Sample",
        "condition": "New",
    }

    db = MagicMock()
    calls: list[tuple[str, list[str]]] = []

    def table_side_effect(_name):
        chain = MagicMock()
        chain.select.return_value = chain

        def in_side_effect(column, values):
            calls.append((column, list(values)))
            # Return the row only for the matching column query.
            if column == "sku" and "9990357" in values:
                chain.execute.return_value = MagicMock(data=[row])
            elif column == "upc" and "198269695492" in values:
                chain.execute.return_value = MagicMock(data=[row])
            elif column == "fnsku" and "X0052JFNEN" in values:
                chain.execute.return_value = MagicMock(data=[row])
            else:
                chain.execute.return_value = MagicMock(data=[])
            return chain

        chain.in_.side_effect = in_side_effect
        return chain

    db.table.side_effect = table_side_effect
    repo = WarehouseProductRepository(db)
    found = repo.lookup_by_identifiers(
        ["9990357", "198269695492", "X0052JFNEN", "MISSING", "9990357"]
    )

    assert set(found.keys()) == {"9990357", "198269695492", "X0052JFNEN"}
    assert found["9990357"] == [row]
    assert found["198269695492"] == [row]
    assert found["X0052JFNEN"] == [row]
    assert "MISSING" not in found
    assert [c[0] for c in calls] == ["sku", "upc", "fnsku"]
