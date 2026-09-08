"""Tests for the Shipment Manager FBA export -> WR SKU Update conversion."""
import io

import pytest
from openpyxl import load_workbook

from app.services.shipment_manager import (
    OUTPUT_FILENAME,
    ShipmentManagerError,
    ShipmentSkuRow,
    build_workbook,
    build_wr_sku_update,
    dedupe_by_upc,
    parse_fba_export,
)

FBA_EXPORT = """Workflow name,wf5acb45b4-38bc-4c72-b878-c6b522ac6f99,,
Shipment ID,FBA19JHYH77Q,,
Shipment name,NFA WHRP 7.17.26 1 OF 5,,
Ship to,DEN8,,
Boxes,38,,
SKUs,2,,
Units,140,,
,,,
Individual units (38 boxes),,,
SKU,Title,ASIN,FNSKU,Condition,Prep type,Total units,Box 1 units
197642130629-FNSKU,"Borealis Backpack, Blk",B0CN9SD8JF,X0052Z3NU3,New,FC_PROVIDED,139,4
198268844372-FNSKU,"Antora Jacket, XL",B0FX3FSCDN,X0057D6IM5,New,FC_PROVIDED,1,1
,,,,,,,
,,,,,,Box ID,FBA19JHYH77QU000022
,,,,,,Box weight (lb):,11
"""


def _run(text: str = FBA_EXPORT, filename: str = "FBA19JHYH77Q.csv"):
    return build_wr_sku_update(filename, text.encode("utf-8"))


def _sheet(result):
    return load_workbook(io.BytesIO(result.workbook_bytes)).active


def test_parses_shipment_metadata():
    result = _run()
    assert result.shipment_id == "FBA19JHYH77Q"
    assert result.shipment_name == "NFA WHRP 7.17.26 1 OF 5"
    assert result.ship_to == "DEN8"
    assert result.box_count == 38
    assert result.sku_count == 2
    assert result.total_units == 140
    assert result.filename == OUTPUT_FILENAME


def test_maps_columns_from_the_sku_table():
    sheet = _sheet(_run())
    assert [sheet.cell(1, col).value for col in range(1, 5)] == [
        "SKU",
        "Description",
        "UPC",
        "FNSKU",
    ]
    assert sheet.cell(2, 1).value == "197642130629-FNSKU"
    assert sheet.cell(2, 2).value == "Borealis Backpack, Blk"
    assert sheet.cell(2, 4).value == "X0052Z3NU3"
    assert sheet.cell(3, 1).value == "198268844372-FNSKU"


def test_upc_is_the_sku_without_the_fnsku_suffix_as_a_number():
    cell = _sheet(_run())["C2"]
    assert cell.value == 197642130629
    assert isinstance(cell.value, int)
    assert cell.number_format == "0"


def test_dimension_columns_are_left_blank():
    sheet = _sheet(_run())
    assert sheet.max_row == 3
    assert all(
        sheet.cell(row, col).value is None
        for row in range(2, sheet.max_row + 1)
        for col in range(5, 14)
    )


def test_stops_at_the_per_box_footer():
    sheet = _sheet(_run())
    # Two SKU rows only; the Box ID / Box weight rows below the blank line are ignored.
    assert sheet.max_row == 3
    assert sheet.cell(4, 1).value is None


def test_template_formatting_is_preserved():
    sheet = _sheet(_run())
    assert sheet["A1"].fill.fgColor.rgb == "FF92D050"
    assert sheet["A1"].font.bold is True
    assert sheet.row_dimensions[1].height == 28.8
    assert round(sheet.column_dimensions["B"].width, 3) == 61.332


def test_duplicate_skus_are_collapsed():
    duplicated = FBA_EXPORT.replace(
        '198268844372-FNSKU,"Antora Jacket, XL",B0FX3FSCDN,X0057D6IM5,New,FC_PROVIDED,1,1',
        '197642130629-FNSKU,"Borealis Backpack, Blk",B0CN9SD8JF,X0052Z3NU3,New,FC_PROVIDED,139,4',
    )
    result = _run(duplicated)
    assert result.sku_count == 1
    assert result.duplicate_skus == 1


def test_duplicate_upcs_keep_the_first_row_only():
    """Two different SKUs that strip to the same UPC become one output row."""
    duplicated = FBA_EXPORT.replace(
        '198268844372-FNSKU,"Antora Jacket, XL",B0FX3FSCDN,X0057D6IM5,New,FC_PROVIDED,1,1',
        '197642130629_FNSKU,"Borealis Backpack, Navy",B0CN9VGKD5,X0053P8X57,New,FC_PROVIDED,5,1',
    )
    result = _run(duplicated)
    sheet = _sheet(result)
    assert result.sku_count == 1
    assert result.duplicate_skus == 1
    assert sheet.max_row == 2
    assert sheet.cell(2, 1).value == "197642130629-FNSKU"
    assert sheet.cell(2, 3).value == 197642130629
    assert sheet.cell(3, 1).value is None


def test_non_numeric_upc_falls_back_to_text():
    text = FBA_EXPORT.replace("197642130629-FNSKU", "ABC-123-FNSKU")
    assert _sheet(_run(text))["C2"].value == "ABC-123"


def test_tab_delimited_export_is_supported():
    result = _run(FBA_EXPORT.replace(",", "\t"), filename="FBA19JHYH77Q.txt")
    assert result.shipment_id == "FBA19JHYH77Q"
    assert result.sku_count == 2


def _row(upc: str, sku: str = "", description: str = "") -> ShipmentSkuRow:
    return ShipmentSkuRow(
        sku=sku or f"{upc}-FNSKU",
        description=description or f"Item {upc}",
        upc=upc,
        fnsku=f"X{upc[-8:]}",
    )


def test_parse_fba_export_does_not_render_a_workbook():
    result = parse_fba_export("FBA19JHYH77Q.csv", FBA_EXPORT.encode("utf-8"))
    assert result.workbook_bytes == b""
    assert result.sku_count == 2
    assert [row.upc for row in result.rows] == ["197642130629", "198268844372"]


def test_dedupe_by_upc_keeps_the_first_occurrence():
    rows = [
        _row("111111111111", description="From first upload"),
        _row("222222222222"),
        _row("111111111111", description="From second upload"),
    ]
    unique = dedupe_by_upc(rows)
    assert [row.upc for row in unique] == ["111111111111", "222222222222"]
    assert unique[0].description == "From first upload"


def test_dedupe_by_upc_drops_blank_upcs():
    assert dedupe_by_upc([_row(""), _row("333333333333")]) == [_row("333333333333")]


def test_build_workbook_renders_collected_rows():
    sheet = load_workbook(io.BytesIO(build_workbook([_row("111111111111"), _row("222222222222")]))).active
    assert sheet.max_row == 3
    assert sheet.cell(2, 3).value == 111111111111
    assert sheet.cell(3, 3).value == 222222222222
    assert sheet["A1"].fill.fgColor.rgb == "FF92D050"


def test_missing_sku_table_is_rejected():
    with pytest.raises(ShipmentManagerError, match="Could not find the SKU table"):
        _run("Shipment ID,FBA19JHYH77Q\nBoxes,38\n")


def test_empty_file_is_rejected():
    with pytest.raises(ShipmentManagerError):
        _run("")
