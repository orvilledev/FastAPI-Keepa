"""DNK CCL → Contents + Dimensions, including the FBA19QRSWGPN sample."""
from __future__ import annotations

import io
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook

from app.services.fba_box_contents_dnk import (
    FbaBoxContentsDnkError,
    generate_fba_box_contents_dnk,
)

SAMPLE_INPUT = Path(r"c:\Users\Administrator\Downloads\FBA19QRSWGPN CCL.xlsx")
SAMPLE_OUTPUT = Path(r"c:\Users\Administrator\Downloads\FBA19QRSWGPN Box Contents.xlsx")


def _ccl_bytes() -> bytes:
    workbook = Workbook()
    contents = workbook.active
    contents.title = "Contents"
    contents["A1"] = "Carton Contents"
    contents["A2"] = "FBA19TEST"
    contents["B3"] = "Carton"
    contents["C3"] = "Item"
    contents["F3"] = "UPC"
    contents["G3"] = "Quantity"
    contents["I3"] = "Weight"
    contents["J3"] = "Length"
    contents["K3"] = "Width"
    contents["L3"] = "Height"
    contents["B4"] = "1 of 1"
    contents["C5"] = "SKU1"
    contents["F5"] = "673088001889"
    contents["G5"] = 2
    contents["F6"] = "Carton Total"
    contents["G6"] = 2
    contents["I6"] = 10.5
    contents["J6"] = 20
    contents["K6"] = 15
    contents["L6"] = 10

    dimensions = workbook.create_sheet("Dimensions")
    dimensions["A1"] = "Carton Dimensions"
    dimensions["A2"] = "Order"
    dimensions["B2"] = "Carton"
    dimensions["C2"] = "Weight"
    dimensions["D2"] = "Length"
    dimensions["E2"] = "Width"
    dimensions["F2"] = "Height"
    dimensions["A3"] = "FBA19TEST"
    dimensions["B3"] = 1
    dimensions["C3"] = 10.5
    dimensions["D3"] = 20
    dimensions["E3"] = 15
    dimensions["F3"] = 10

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_missing_contents_sheet_is_rejected():
    workbook = Workbook()
    workbook.active.title = "Other"
    raw = io.BytesIO()
    workbook.save(raw)
    with pytest.raises(FbaBoxContentsDnkError, match="Contents"):
        generate_fba_box_contents_dnk(raw.getvalue(), "empty.xlsx")


def test_synthetic_ccl_builds_contents_and_dimensions():
    result = generate_fba_box_contents_dnk(_ccl_bytes(), "FBA19TEST CCL.xlsx")
    assert result.filename == "FBA19TEST Box Contents.xlsx"
    assert result.shipment_id == "FBA19TEST"
    assert result.row_count == 1
    assert result.box_count == 1
    assert result.upc_count == 1
    assert result.total_qty == 2

    workbook = load_workbook(io.BytesIO(result.file_bytes))
    assert workbook.sheetnames == ["Contents", "Dimensions"]

    sheet = workbook["Contents"]
    assert sheet["A1"].value == "Box Number"
    assert sheet["B1"].value == "UPC"
    assert sheet["C1"].value == "Quantity"
    assert sheet["A2"].value == 1
    assert sheet["A2"].data_type == "n"
    assert isinstance(sheet["A2"].value, int)
    assert sheet["B2"].value == "673088001889"
    assert sheet["B2"].data_type == "s"
    assert sheet["C2"].value == 2
    assert sheet["C2"].data_type == "n"
    assert isinstance(sheet["C2"].value, int)

    assert sheet["G1"].value == "Sum of Quantity"
    assert sheet["H1"].value == "Column Labels"
    assert sheet["G2"].value == "Row Labels"
    assert sheet["H2"].value == 1
    assert sheet["I2"].value == "Grand Total"
    assert sheet["G3"].value == "673088001889"
    assert sheet["H3"].value == 2
    assert sheet["I3"].value == 2
    assert sheet["G4"].value == "Grand Total"
    assert sheet["H4"].value == 2
    assert sheet["I4"].value == 2

    dims = workbook["Dimensions"]
    assert dims["A1"].value == "Carton Dimensions"
    assert dims["A2"].value == "Order"
    assert dims["B2"].value == "Carton"
    assert dims["A3"].value == "FBA19TEST"
    assert dims["B3"].value == 1
    assert isinstance(dims["B3"].value, int)
    assert dims["C3"].value == 10.5
    assert isinstance(dims["C3"].value, float)
    assert dims["D3"].value == 20
    assert isinstance(dims["D3"].value, int)
    assert dims["E3"].value == 15
    assert dims["F3"].value == 10


@pytest.mark.skipif(
    not SAMPLE_INPUT.is_file() or not SAMPLE_OUTPUT.is_file(),
    reason="DNK sample workbooks are not on this machine",
)
def test_fba19qrswgpn_matches_the_sample_workbook():
    result = generate_fba_box_contents_dnk(SAMPLE_INPUT.read_bytes(), SAMPLE_INPUT.name)
    assert result.filename == "FBA19QRSWGPN Box Contents.xlsx"
    assert result.shipment_id == "FBA19QRSWGPN"
    assert result.row_count == 14
    assert result.box_count == 2
    assert result.upc_count == 14
    assert result.total_qty == 24

    actual_wb = load_workbook(io.BytesIO(result.file_bytes))
    expected_wb = load_workbook(SAMPLE_OUTPUT)
    assert actual_wb.sheetnames == expected_wb.sheetnames == ["Contents", "Dimensions"]

    for sheet_name in ("Contents", "Dimensions"):
        actual = actual_wb[sheet_name]
        expected = expected_wb[sheet_name]
        mismatches: list[str] = []
        max_row = max(actual.max_row or 1, expected.max_row or 1)
        max_col = max(actual.max_column or 1, expected.max_column or 1)
        for row in range(1, max_row + 1):
            for column in range(1, max_col + 1):
                got = actual.cell(row, column)
                want = expected.cell(row, column)
                if got.value != want.value:
                    mismatches.append(
                        f"{sheet_name}!{got.coordinate}: got {got.value!r}/{got.data_type} "
                        f"want {want.value!r}/{want.data_type}"
                    )
                elif got.value is not None and got.data_type != want.data_type:
                    mismatches.append(
                        f"{sheet_name}!{got.coordinate}: type {got.data_type} != {want.data_type} "
                        f"value={got.value!r}"
                    )
                elif got.value is not None and type(got.value) is not type(want.value):
                    # int vs float for whole numbers is still wrong for the sample.
                    if not (
                        isinstance(got.value, (int, float))
                        and isinstance(want.value, (int, float))
                        and got.value == want.value
                        and int(got.value) == got.value
                        and int(want.value) == want.value
                    ):
                        mismatches.append(
                            f"{sheet_name}!{got.coordinate}: python type "
                            f"{type(got.value).__name__} != {type(want.value).__name__}"
                        )
        assert mismatches == [], "\n".join(mismatches[:40])
