"""Tests for FBA Box Contents Tool #2 (spaced PO# carton dump)."""
from __future__ import annotations

from io import BytesIO
from pathlib import Path

import openpyxl
import pytest
from openpyxl import Workbook

from app.services.fba_box_contents_tool2 import (
    BOX_CONTENTS_SHEET,
    DEFAULT_OUTPUT_FILENAME,
    DIMENSIONS_SHEET,
    PIVOT_START_COL,
    FbaBoxContentsTool2Error,
    generate_fba_box_contents_tool2,
    parse_carton_detail_tool2,
    sanitize_download_filename,
)

SAMPLE_INPUT = Path(r"c:\Users\Administrator\Downloads\FBA19PLBV097.xls")
SAMPLE_OUTPUT = Path(r"c:\Users\Administrator\Downloads\FBA19PLBV097 Output.xlsx")


def _spaced_xlsx(
    rows: list[list[object]],
    *,
    shipment_id: str = "FBA19TEST001",
) -> bytes:
    """Build a spaced-column carton dump similar to the Tool #2 sample."""
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["PO#:", shipment_id])
    sheet.append([])
    sheet.append(
        [
            "Sku",
            None,
            "UPC",
            None,
            "Description",
            None,
            None,
            "Qty",
            None,
            "Weight",
            None,
            "Carton Length",
            None,
            "Carton Width",
            None,
            "Carton Height",
        ]
    )
    sheet.append([])
    for row in rows:
        sheet.append(row)
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_sanitize_filename_adds_output_suffix():
    assert sanitize_download_filename("FBA19PLBV097.xls") == "FBA19PLBV097 Output.xlsx"
    assert sanitize_download_filename("FBA19PLBV097 Output.xlsx") == "FBA19PLBV097 Output.xlsx"
    assert sanitize_download_filename(None) == DEFAULT_OUTPUT_FILENAME


def test_parse_requires_carton_headers():
    raw = _spaced_xlsx(
        [["016349-L", None, "193392648759", None, "DESC", None, None, 50, None, 35.0]]
    )
    with pytest.raises(FbaBoxContentsTool2Error, match="Carton#"):
        parse_carton_detail_tool2(raw)


def test_generate_tool2_layout_and_types():
    raw = _spaced_xlsx(
        [
            ["Carton#:", "00001111", None, None, None, None, None, None, None, None, None, 19.88, None, 17.79, None, 14.59],
            [],
            ["016349-L", None, "193392648759", None, "M CL", None, None, 50.0, None, 35.0],
            [],
            [None, None, None, None, None, "Total", None, 50.0, None, " 38.00"],
            [],
            ["Carton#:", "00002222", None, None, None, None, None, None, None, None, None, 24.0, None, 16.0, None, 11.0],
            [],
            ["0SN110-XS", None, "605284169933", None, "K CL", None, None, 2.0, None, 1.76],
            ["0SN110-S", None, "605284169940", None, "K CL", None, None, 2.0, None, 1.76],
            [None, None, None, None, None, "Total", None, 4.0, None, " 14.82"],
        ]
    )
    result = generate_fba_box_contents_tool2(raw, "FBA19PLBV097.xls")
    assert result.filename == "FBA19PLBV097 Output.xlsx"
    assert result.box_count == 2
    assert result.row_count == 3
    assert result.total_qty == 54
    assert result.shipment_id == "FBA19TEST001"
    assert result.upc_count == 3

    workbook = openpyxl.load_workbook(BytesIO(result.file_bytes))
    try:
        assert workbook.sheetnames == [BOX_CONTENTS_SHEET, DIMENSIONS_SHEET]
        contents = workbook[BOX_CONTENTS_SHEET]
        dims = workbook[DIMENSIONS_SHEET]

        assert contents["A1"].value == "UPC"
        assert contents["B1"].value == "Box Number"
        assert contents["C1"].value == "QTY"
        assert contents["A1"].font.bold is True
        assert contents["G1"].value == "Sum of QTY"
        assert contents["G1"].font.bold is False

        assert contents["A2"].value == "193392648759"
        assert contents["A2"].data_type == "s"
        assert contents["B2"].value == 1
        assert type(contents["B2"].value) is int
        assert contents["C2"].value == 50

        # No Total QTY footer on the left
        for row in range(1, contents.max_row + 1):
            assert contents.cell(row, 2).value != "Total QTY"

        assert dims["A1"].value == "Weight"
        assert dims["B1"].value == "Length"
        assert dims["C1"].value == "Width"
        assert dims["D1"].value == "Height"
        assert dims["A1"].font.bold is False
        assert dims.max_column == 4

        assert dims["A2"].value == " 38.00"
        assert dims["A2"].data_type == "s"
        assert dims["B2"].value == 19.88
        assert dims["C2"].value == 17.79
        assert dims["D2"].value == 14.59
        assert dims["A3"].value == " 14.82"
        assert dims["B3"].value == 24
    finally:
        workbook.close()


@pytest.mark.skipif(not SAMPLE_INPUT.exists() or not SAMPLE_OUTPUT.exists(), reason="sample files not present")
def test_matches_sample_output_values():
    result = generate_fba_box_contents_tool2(SAMPLE_INPUT.read_bytes(), SAMPLE_INPUT.name)
    assert result.filename == "FBA19PLBV097 Output.xlsx"
    assert result.shipment_id == "FBA19PLBV097"
    assert result.box_count == 29
    assert result.row_count == 348
    assert result.upc_count == 321

    got = openpyxl.load_workbook(BytesIO(result.file_bytes), data_only=True)
    expected = openpyxl.load_workbook(SAMPLE_OUTPUT, data_only=True)
    try:
        exp_contents = expected[BOX_CONTENTS_SHEET]
        got_contents = got[BOX_CONTENTS_SHEET]
        exp_dims = expected[DIMENSIONS_SHEET]
        got_dims = got[DIMENSIONS_SHEET]

        # Left side UPC / Box Number / QTY
        for row in range(1, exp_contents.max_row + 1):
            for col in (1, 2, 3):
                exp_val = exp_contents.cell(row, col).value
                got_val = got_contents.cell(row, col).value
                if exp_val is None and got_val is None:
                    continue
                if col == 1 and exp_val is not None:
                    assert str(got_val) == str(exp_val), f"left {row},{col}"
                else:
                    assert got_val == exp_val, f"left {row},{col}: {got_val!r} != {exp_val!r}"

        # Pivot block
        for row in range(1, exp_contents.max_row + 1):
            for col in range(PIVOT_START_COL, exp_contents.max_column + 1):
                exp_val = exp_contents.cell(row, col).value
                got_val = got_contents.cell(row, col).value
                if exp_val is None and got_val is None:
                    continue
                if isinstance(exp_val, str):
                    assert str(got_val) == exp_val, f"pivot {row},{col}"
                else:
                    assert got_val == exp_val, f"pivot {row},{col}: {got_val!r} != {exp_val!r}"

        assert got_dims.max_row == exp_dims.max_row
        for row in range(1, exp_dims.max_row + 1):
            for col in range(1, 5):
                exp_val = exp_dims.cell(row, col).value
                got_val = got_dims.cell(row, col).value
                assert got_val == exp_val, f"dims {row},{col}: {got_val!r} != {exp_val!r}"
    finally:
        got.close()
        expected.close()
