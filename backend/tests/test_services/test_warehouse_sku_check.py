"""Tests for bulk SKU existence check against the Label Station catalog."""
from __future__ import annotations

from io import BytesIO

import openpyxl
import pytest
from openpyxl import Workbook

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


def test_parse_csv_with_sku_column():
    raw = b"SKU,Other\n9990357,x\nMISSING,y\n"
    assert parse_sku_list_file("list.csv", raw) == ["9990357", "MISSING"]


def test_parse_xlsx_with_sku_header():
    raw = _xlsx_bytes([["SKU", "Note"], ["9990357", "a"], [1234567.0, "b"]])
    assert parse_sku_list_file("list.xlsx", raw) == ["9990357", "1234567"]


def test_parse_xlsx_first_column_when_no_header():
    raw = _xlsx_bytes([["AAA"], ["BBB"]])
    assert parse_sku_list_file("list.xlsx", raw) == ["AAA", "BBB"]


def test_parse_empty_raises():
    with pytest.raises(WarehouseSkuCheckError, match="No SKUs"):
        parse_sku_list_file("empty.txt", b"\n\n")


def test_generate_workbook_marks_found_and_missing():
    skus = ["9990357", "MISSING"]
    found = {
        "9990357": [
            {
                "upc": "198269695492",
                "sku": "9990357",
                "fnsku": "X0052JFNEN",
                "style_name": "Sample",
                "condition": "New",
            }
        ]
    }
    result = generate_sku_check_workbook(skus, found)
    assert result.total == 2
    assert result.found == 1
    assert result.missing == 1
    assert result.filename == "SKU Existence Check.xlsx"

    workbook = openpyxl.load_workbook(BytesIO(result.file_bytes))
    try:
        sheet = workbook["SKU Check"]
        assert sheet["A1"].value == "SKU"
        assert sheet["B1"].value == "Exists"
        assert sheet["A2"].value == "9990357"
        assert sheet["B2"].value == "Yes"
        assert sheet["C2"].value == "198269695492"
        assert sheet["A3"].value == "MISSING"
        assert sheet["B3"].value == "No"
        assert sheet["G3"].value == 0
    finally:
        workbook.close()


def test_lookup_by_skus_batches_and_groups_matches():
    from unittest.mock import MagicMock

    from app.repositories.warehouse_product_repository import WarehouseProductRepository

    row_a = {"upc": "111", "sku": "SKU-A", "fnsku": "XA", "style_name": "A", "condition": "New"}
    row_a2 = {"upc": "112", "sku": "SKU-A", "fnsku": "XA2", "style_name": "A2", "condition": "New"}
    row_b = {"upc": "222", "sku": "SKU-B", "fnsku": "XB", "style_name": "B", "condition": "New"}

    db = MagicMock()
    chain = MagicMock()
    chain.select.return_value = chain
    chain.in_.return_value = chain
    chain.execute.return_value = MagicMock(data=[row_a, row_a2, row_b])
    db.table.return_value = chain

    repo = WarehouseProductRepository(db)
    found = repo.lookup_by_skus([" SKU-A ", "SKU-B", "SKU-A", ""])
    assert found == {"SKU-A": [row_a, row_a2], "SKU-B": [row_b]}
    chain.in_.assert_called_once_with("sku", ["SKU-A", "SKU-B"])
