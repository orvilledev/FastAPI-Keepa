"""OBZ packing slip → Box Contents, including the FBA19PZSB42B sample."""
from __future__ import annotations

import io
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook

from app.services.fba_box_contents_obz import (
    FbaBoxContentsObzError,
    generate_fba_box_contents_obz,
    normalize_upc,
)

SAMPLE_INPUT = Path(
    r"c:\Users\Administrator\Downloads\PackingSlipByCartonReport DOC 52824029 FBA19PZSB42B.xlsx"
)
SAMPLE_OUTPUT = Path(r"c:\Users\Administrator\Downloads\FBA19PZSB42B Box Contents.xlsx")


def _slip_bytes() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet["A12"] = "Cartons"
    sheet["A14"] = 1
    sheet["R12"] = "Qty"
    sheet["R14"] = 3
    sheet["B18"] = "Carton"
    sheet["F18"] = 1
    sheet["B20"] = "PO"
    sheet["W20"] = "UPC/GTIN"
    sheet["AW20"] = "Qty"
    sheet["B21"] = "FBA19TEST"
    sheet["W21"] = "00840127862033"
    sheet["AW21"] = 2
    sheet["B22"] = "FBA19TEST"
    sheet["W22"] = "00840127862033"
    sheet["AW22"] = 1
    sheet["B29"] = "Carton"
    sheet["F29"] = 2
    sheet["B32"] = "PO"
    sheet["W32"] = "UPC/GTIN"
    sheet["AW32"] = "Qty"
    sheet["B33"] = "FBA19TEST"
    sheet["W33"] = "00810918010035"
    sheet["AW33"] = 1
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_normalize_upc_strips_leading_zeros_and_stays_text():
    assert normalize_upc("00840127862033") == "840127862033"
    assert isinstance(normalize_upc("00840127862033"), str)
    assert normalize_upc(840127862033) == "840127862033"


def test_missing_carton_is_rejected():
    workbook = Workbook()
    workbook.active["A2"] = "Packing Slip"
    raw = io.BytesIO()
    workbook.save(raw)
    with pytest.raises(FbaBoxContentsObzError, match="Carton"):
        generate_fba_box_contents_obz(raw.getvalue(), "empty.xlsx")


def test_duplicate_upc_in_a_carton_stays_on_two_lines_and_sums_in_the_pivot():
    result = generate_fba_box_contents_obz(_slip_bytes(), "slip.xlsx")
    assert result.filename == "FBA19TEST Box Contents.xlsx"
    assert result.shipment_id == "FBA19TEST"
    assert result.row_count == 3
    assert result.box_count == 2
    assert result.upc_count == 2
    assert result.total_qty == 4

    workbook = load_workbook(io.BytesIO(result.file_bytes))
    sheet = workbook["Box Contents"]
    assert sheet["A1"].value == "Box Number"
    assert sheet["B1"].value == "UPC"
    assert sheet["C1"].value == "Qty"
    assert sheet["A2"].value == 1
    assert sheet["A2"].data_type == "n"
    assert sheet["B2"].value == "840127862033"
    assert sheet["B2"].data_type == "s"
    assert sheet["C2"].value == 2
    assert sheet["C2"].data_type == "n"
    assert sheet["B3"].value == "840127862033"
    assert sheet["C3"].value == 1
    assert sheet["A4"].value == 2
    assert sheet["B4"].value == "810918010035"
    assert sheet["C4"].value == 1
    assert sheet["B5"].value == "Total"
    assert sheet["B5"].font.bold is True
    assert sheet["C5"].value == "=SUM(C2:C4)"
    assert sheet["C5"].data_type == "f"

    assert sheet["F1"].value == "Sum of Qty"
    assert sheet["G2"].value == 1
    assert sheet["H2"].value == 2
    assert sheet["I2"].value == "Grand Total"
    # First sorted UPC is 810918010035 (box 2 only).
    assert sheet["F3"].value == "810918010035"
    assert sheet["F3"].data_type == "s"
    assert sheet["G3"].value is None
    assert sheet["H3"].value == 1
    assert sheet["I3"].value == 1
    assert sheet["F4"].value == "840127862033"
    assert sheet["G4"].value == 3
    assert sheet["H4"].value is None
    assert sheet["I4"].value == 3
    assert sheet["F5"].value == "Grand Total"
    assert sheet["G5"].value == 3
    assert sheet["H5"].value == 1
    assert sheet["I5"].value == 4


@pytest.mark.skipif(
    not SAMPLE_INPUT.is_file() or not SAMPLE_OUTPUT.is_file(),
    reason="Oboz sample workbooks are not on this machine",
)
def test_fba19pzsb42b_matches_the_sample_workbook():
    result = generate_fba_box_contents_obz(SAMPLE_INPUT.read_bytes(), SAMPLE_INPUT.name)
    assert result.filename == "FBA19PZSB42B Box Contents.xlsx"
    assert result.shipment_id == "FBA19PZSB42B"
    assert result.row_count == 15
    assert result.box_count == 2
    assert result.upc_count == 15
    assert result.total_qty == 15

    actual = load_workbook(io.BytesIO(result.file_bytes))["Box Contents"]
    expected = load_workbook(SAMPLE_OUTPUT)["Box Contents"]
    assert actual.max_row == expected.max_row
    assert actual.max_column == expected.max_column

    mismatches: list[str] = []
    for row in range(1, expected.max_row + 1):
        for column in range(1, expected.max_column + 1):
            got = actual.cell(row, column)
            want = expected.cell(row, column)
            if got.value != want.value or (got.value is not None and got.data_type != want.data_type):
                mismatches.append(
                    f"{got.coordinate}: got {got.value!r}/{got.data_type} "
                    f"want {want.value!r}/{want.data_type}"
                )
            elif got.value is not None:
                if bool(got.font.bold) != bool(want.font.bold):
                    mismatches.append(f"{got.coordinate}: bold {got.font.bold} != {want.font.bold}")
                if (got.alignment.horizontal or None) != (want.alignment.horizontal or None):
                    mismatches.append(
                        f"{got.coordinate}: align {got.alignment.horizontal!r} "
                        f"!= {want.alignment.horizontal!r}"
                    )
    assert mismatches == []
