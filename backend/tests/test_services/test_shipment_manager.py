"""Tests for the Shipment Manager FBA export -> WR SKU Update / PO Import / Order Import conversions."""
import io

import pytest
from openpyxl import load_workbook

from app.services.shipment_manager import (
    OUTPUT_FILENAME,
    ShipmentManagerError,
    ShipmentSkuRow,
    build_order_import_text,
    build_order_import_workbook,
    build_po_import_text,
    build_po_import_workbook,
    build_shipment_ledger_workbook,
    build_workbook,
    build_wr_sku_update,
    compile_stored_rows,
    dedupe_by_upc,
    ledger_filename,
    order_import_filename,
    parse_fba_export,
    po_import_filename,
    resolve_po_supplier,
    ship_to_address_from_catalog,
    ship_to_code,
    supplier_from_filename,
    supplier_from_title,
    supplier_from_titles,
    order_import_text_filename,
    po_import_text_filename,
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


def test_compile_stored_rows_merges_uploads_and_drops_duplicate_upcs():
    stored = [
        {"sku": "111-FNSKU", "description": "First file", "upc": "111", "fnsku": "XA", "total_units": 2},
        {"sku": "222-FNSKU", "description": "First file B", "upc": "222", "fnsku": "XB", "total_units": 1},
        {"sku": "111-FNSKU", "description": "Second file duplicate", "upc": "111", "fnsku": "XA", "total_units": 9},
        {"sku": "333", "description": "Second file new", "upc": "333", "fnsku": "XC", "total_units": 4},
    ]
    unique, collected = compile_stored_rows(stored)
    assert collected == 4
    assert [row.upc for row in unique] == ["111", "222", "333"]
    assert unique[0].description == "First file"
    assert unique[2].description == "Second file new"


# ---- PO Import sheet ----------------------------------------------------


def _po_sheet(rows=None, *, purchase_order_number="FBA19JHYH77Q", supplier="North Face"):
    rows = parse_fba_export("x.csv", FBA_EXPORT.encode("utf-8")).rows if rows is None else rows
    workbook = load_workbook(
        io.BytesIO(
            build_po_import_workbook(
                rows, purchase_order_number=purchase_order_number, supplier=supplier
            )
        )
    )
    return workbook.active


@pytest.mark.parametrize(
    "filename, expected",
    [
        ("North Face WHRP 7.17.26 1 OF 5.csv", "North Face"),
        ("Dansko WHRP 8.1.26.xlsx", "Dansko"),
        ("north-face-whrp-7.17.26.txt", "north face"),
        ("Dansko 8.1.26 2 of 3.csv", "Dansko"),
        ("C:\\Users\\me\\Downloads\\North Face WHRP 7.17.26.csv", "North Face"),
        ("North Face.csv", "North Face"),
        # No supplier in the title: the FBA id leads, so there is nothing to take.
        ("FBA19JHYH77Q.csv", ""),
        ("", ""),
    ],
)
def test_supplier_is_the_leading_words_of_the_filename(filename, expected):
    assert supplier_from_filename(filename) == expected


def test_po_import_filename_names_the_supplier_and_purchase_order():
    assert po_import_filename("FBA19JHYH77Q", "North Face") == "PO IMPORT North Face FBA19JHYH77Q.xlsx"
    assert po_import_filename("FBA19JHYH77Q", "") == "PO IMPORT FBA19JHYH77Q.xlsx"
    assert po_import_filename("", "") == "PO IMPORT.xlsx"


def test_po_import_keeps_the_template_headers_and_banner():
    sheet = _po_sheet()
    assert sheet.title == "Purchase Order Import Template"
    assert [sheet.cell(5, col).value for col in range(1, 10)] == [
        "PurchaseOrderNumber",
        "SupplierCompanyName",
        "IssueDate",
        "PONotes",
        "ItemNumber",
        "ItemQuantity",
        "Facility",
        "ExpectedDate",
        "LineItemNotes",
    ]
    assert sheet["B1"].value.startswith("Purchase Order Import Template")
    assert sheet["A5"].font.name == "Lato Black"
    assert {str(rng) for rng in sheet.merged_cells.ranges} == {"A1:A4", "B1:I4"}
    assert round(sheet.column_dimensions["B"].width, 4) == 52.4258


def test_po_import_writes_one_line_per_sku_from_row_six():
    sheet = _po_sheet()
    assert [sheet.cell(row, 1).value for row in (6, 7)] == ["FBA19JHYH77Q", "FBA19JHYH77Q"]
    assert [sheet.cell(row, 2).value for row in (6, 7)] == ["North Face", "North Face"]
    assert [sheet.cell(row, 5).value for row in (6, 7)] == [
        "197642130629-FNSKU",
        "198268844372-FNSKU",
    ]
    assert [sheet.cell(row, 6).value for row in (6, 7)] == [139, 1]
    assert sheet.max_row == 7


def test_po_import_line_items_use_the_template_body_font():
    sheet = _po_sheet()
    assert sheet["A6"].font.name == "Open Sans"
    assert sheet["F6"].font.sz == 11


def test_po_import_fills_facility_with_whrep_ontario():
    sheet = _po_sheet()
    assert [sheet.cell(row, 7).value for row in (6, 7)] == ["WHREP Ontario", "WHREP Ontario"]
    assert sheet["G6"].font.name == "Open Sans"


def test_po_import_leaves_the_optional_columns_blank():
    sheet = _po_sheet()
    # IssueDate, PONotes, ExpectedDate, LineItemNotes. Facility is always filled.
    assert all(sheet.cell(row, col).value is None for row in (6, 7) for col in (3, 4, 8, 9))


@pytest.mark.parametrize(
    "title, expected",
    [
        ("The North Face Borealis Commuter Laptop Backpack, Blk/Blk-NPF, OSFA", "The North Face"),
        ("THE NORTH FACE Evolution Simple Dome Hoodie, Pale Gy Hth, S", "The North Face"),
        ("Smartwool Women's Classic Thermal Merino Base Layer Crew", "Smartwool"),
        ("Dansko Women's Professional Clog", "Dansko"),
        ("Oboz Bridger 7\" Insulated Waterproof Winter Boot", "Oboz"),
        ("Borealis Backpack, Blk", ""),
        ("", ""),
    ],
)
def test_supplier_is_the_brand_at_the_start_of_the_title(title, expected):
    assert supplier_from_title(title) == expected


def test_supplier_from_titles_keeps_the_first_known_brand():
    assert (
        supplier_from_titles(
            [
                "Borealis Backpack, Blk",
                "THE NORTH FACE Evolution Simple Dome Hoodie, Pale Gy Hth, S",
                "Dansko Women's Professional Clog",
            ]
        )
        == "The North Face"
    )


def test_resolve_po_supplier_prefers_the_title_over_the_filename():
    rows = [
        ShipmentSkuRow(
            sku="197642130629-FNSKU",
            description="The North Face Borealis Commuter Laptop Backpack, Blk/Blk-NPF, OSFA",
            upc="197642130629",
            fnsku="X0052Z3NU3",
            total_units=139,
        )
    ]
    assert (
        resolve_po_supplier(rows, filename="FBA19JHYH77Q.csv", shipment_name="NFA WHRP 7.17.26")
        == "The North Face"
    )


def test_resolve_po_supplier_falls_back_to_the_shipment_name_code():
    rows = [_row("197642130629", description="Borealis Backpack, Blk")]
    assert (
        resolve_po_supplier(rows, filename="FBA19JHYH77Q.csv", shipment_name="NFA WHRP 7.17.26 1 OF 5")
        == "The North Face"
    )


def test_po_import_keeps_the_instructions_sheet():
    rows = parse_fba_export("x.csv", FBA_EXPORT.encode("utf-8")).rows
    workbook = load_workbook(
        io.BytesIO(build_po_import_workbook(rows, purchase_order_number="X", supplier="Y"))
    )
    assert workbook.sheetnames == ["Purchase Order Import Template", "Instructions"]
    assert workbook["Instructions"]["A5"].value == "To prepare the file for import:"


def test_po_import_tolerates_a_missing_supplier_or_purchase_order():
    sheet = _po_sheet(purchase_order_number="", supplier="")
    assert sheet.cell(6, 1).value is None
    assert sheet.cell(6, 2).value is None
    assert sheet.cell(6, 5).value == "197642130629-FNSKU"


def test_po_import_of_no_rows_is_just_the_template():
    assert _po_sheet([]).max_row == 5


# ---- Order Import sheet -------------------------------------------------

DEN8 = {
    "code": "DEN8",
    "full_address": "21000 E 13th Ave, AURORA, CO, 80018",
    "address_1": "21000 E 13th Ave",
    "city": "AURORA",
    "state": "CO",
    "postal_code": "80018",
}


def _order_sheet(rows=None, *, reference_number="FBA19JHYH77Q", record=None):
    rows = parse_fba_export("x.csv", FBA_EXPORT.encode("utf-8")).rows if rows is None else rows
    address = ship_to_address_from_catalog("DEN8", record if record is not None else DEN8)
    workbook = load_workbook(
        io.BytesIO(
            build_order_import_workbook(
                rows, reference_number=reference_number, address=address
            )
        )
    )
    return workbook["Order Import Template"]


@pytest.mark.parametrize(
    "ship_to, expected",
    [
        ("DEN8", "DEN8"),
        ("den8", "DEN8"),
        ("ONT8, 2125 W San Bernardino Rd", "ONT8"),
        ("Amazon DEN8", "DEN8"),
        ("SCK4", "SCK4"),
        ("MDW12", "MDW12"),
        # No code pattern: the first word is the best guess.
        ("Ontario", "ONTARIO"),
        ("", ""),
    ],
)
def test_ship_to_code_is_the_fulfilment_centre_code(ship_to, expected):
    assert ship_to_code(ship_to) == expected


def test_ship_to_address_reads_the_catalog_row():
    address = ship_to_address_from_catalog("den8", DEN8)
    assert address.code == "DEN8"
    assert address.company == "DEN8 Amazon"
    assert address.address_1 == "21000 E 13th Ave"
    assert address.city == "AURORA"
    assert address.state == "CO"
    assert address.postal_code == "80018"
    assert address.country == "US"


def test_order_import_filename_names_the_code_and_reference():
    assert order_import_filename("FBA19JHYH77Q", "DEN8") == "ORDER IMPORT DEN8 FBA19JHYH77Q.xlsx"
    assert order_import_filename("", "DEN8") == "ORDER IMPORT DEN8.xlsx"
    assert order_import_filename("", "") == "ORDER IMPORT.xlsx"


def test_order_import_keeps_the_template_headers_and_helper_sheets():
    workbook = load_workbook(
        io.BytesIO(
            build_order_import_workbook(
                [],
                reference_number="X",
                address=ship_to_address_from_catalog("DEN8", DEN8),
            )
        )
    )
    assert workbook.sheetnames == [
        "Order Import Template",
        "Instructions",
        "Country Values",
        "State Values",
    ]
    sheet = workbook["Order Import Template"]
    assert sheet.max_row == 1
    assert sheet.max_column == 35
    assert [sheet.cell(1, col).value for col in (1, 2, 11, 12, 13, 14, 15, 16, 17, 24, 25)] == [
        "Reference Number",
        "Purchase Order Number",
        "Ship To Company",
        "Ship To Address 1",
        "Ship To Address 2",
        "Ship To City",
        "Ship To State",
        "Ship To Zip",
        "Ship To Country",
        "SKU",
        "Quantity",
    ]
    # The ship-to block carries the template's orange header fill.
    assert sheet["K1"].fill.fgColor.rgb == "FFFF9E18"
    assert sheet["K1"].font.b is True
    assert round(sheet.column_dimensions["A"].width, 4) == 24.6641


def test_order_import_writes_one_line_per_sku_from_row_two():
    sheet = _order_sheet()
    assert [sheet.cell(row, 1).value for row in (2, 3)] == ["FBA19JHYH77Q", "FBA19JHYH77Q"]
    assert [sheet.cell(row, 2).value for row in (2, 3)] == ["FBA19JHYH77Q", "FBA19JHYH77Q"]
    assert [sheet.cell(row, 24).value for row in (2, 3)] == [
        "197642130629-FNSKU",
        "198268844372-FNSKU",
    ]
    assert [sheet.cell(row, 25).value for row in (2, 3)] == [139, 1]
    assert sheet.max_row == 3


def test_order_import_repeats_the_catalog_address_on_every_line():
    sheet = _order_sheet()
    for row in (2, 3):
        assert [sheet.cell(row, col).value for col in (11, 12, 14, 15, 16, 17)] == [
            "DEN8 Amazon",
            "21000 E 13th Ave",
            "AURORA",
            "CO",
            "80018",
            "US",
        ]
        assert sheet.cell(row, 13).value is None


def test_order_import_line_items_use_the_template_body_font():
    sheet = _order_sheet()
    assert sheet["A2"].font.name == "Calibri"
    assert sheet["A2"].font.sz == 11
    assert sheet["A2"].alignment.wrap_text is True
    assert sheet["X2"].font.name == "Calibri"


def test_order_import_leaves_the_carrier_and_option_columns_blank():
    sheet = _order_sheet()
    # Ship Carrier..Ship To Name, then the phone/fax/email/id block and the trailing options.
    blank = list(range(3, 11)) + list(range(18, 24)) + list(range(26, 36))
    assert all(sheet.cell(row, col).value is None for row in (2, 3) for col in blank)


def test_order_import_tolerates_a_catalog_row_with_gaps():
    sheet = _order_sheet(record={"code": "DEN8", "address_1": "21000 E 13th Ave"})
    assert sheet.cell(2, 11).value == "DEN8 Amazon"
    assert sheet.cell(2, 12).value == "21000 E 13th Ave"
    assert all(sheet.cell(2, col).value is None for col in (14, 15, 16))
    assert sheet.cell(2, 17).value == "US"


def test_order_import_of_no_rows_is_just_the_template():
    assert _order_sheet([]).max_row == 1


# ---- Tab-delimited twins ------------------------------------------------
# The warehouse also takes each import sheet as Excel's "Text (Tab delimited)"
# save-as: every column, no headers, CRLF endings and a trailing newline.


def test_import_text_filenames_follow_the_warehouse_of_boxes_units_pattern():
    assert (
        po_import_text_filename("FBA19JHYH77Q", box_count=38, total_units=157)
        == "FBA19JHYH77Q OF 38 157 WR PO Import.txt"
    )
    assert (
        order_import_text_filename("FBA19JHYH77Q", box_count=38, total_units=157)
        == "FBA19JHYH77Q OF 38 157 WR Order Import.txt"
    )
    assert (
        po_import_text_filename("A3PUGGALCFA260625", box_count=2, total_units=12)
        == "A3PUGGALCFA260625 OF 2 12 WR PO Import.txt"
    )
    assert po_import_text_filename("", box_count=0, total_units=0) == "IMPORT OF 0 0 WR PO Import.txt"
    assert (
        po_import_text_filename('FBA/1:"x"', box_count=1, total_units=5)
        == "FBA 1 x OF 1 5 WR PO Import.txt"
    )


def test_po_import_text_filename_uses_boxes_and_units_from_the_export():
    result = parse_fba_export("x.csv", FBA_EXPORT.encode("utf-8"))
    assert po_import_text_filename(
        result.shipment_id,
        box_count=result.box_count,
        total_units=result.total_units,
    ) == "FBA19JHYH77Q OF 38 140 WR PO Import.txt"


def _po_text_lines(rows=None, *, purchase_order_number="FBA19JHYH77Q", supplier="North Face"):
    rows = parse_fba_export("x.csv", FBA_EXPORT.encode("utf-8")).rows if rows is None else rows
    blob = build_po_import_text(
        rows, purchase_order_number=purchase_order_number, supplier=supplier
    )
    assert blob == b"" or blob.endswith(b"\r\n")
    return [line.split("\t") for line in blob.decode("cp1252").split("\r\n") if line]


def _order_text_lines(rows=None, *, reference_number="FBA19JHYH77Q", record=None):
    rows = parse_fba_export("x.csv", FBA_EXPORT.encode("utf-8")).rows if rows is None else rows
    address = ship_to_address_from_catalog("DEN8", record if record is not None else DEN8)
    blob = build_order_import_text(rows, reference_number=reference_number, address=address)
    assert blob == b"" or blob.endswith(b"\r\n")
    return [line.split("\t") for line in blob.decode("cp1252").split("\r\n") if line]


def test_po_import_text_carries_no_headers_and_every_column():
    lines = _po_text_lines()
    assert len(lines) == 2
    assert all(len(line) == 9 for line in lines)
    assert lines[0] == [
        "FBA19JHYH77Q",
        "North Face",
        "",
        "",
        "197642130629-FNSKU",
        "139",
        "WHREP Ontario",
        "",
        "",
    ]


def test_order_import_text_carries_no_headers_and_every_column():
    lines = _order_text_lines()
    assert len(lines) == 2
    assert all(len(line) == 35 for line in lines)
    assert lines[0][:2] == ["FBA19JHYH77Q", "FBA19JHYH77Q"]
    assert lines[0][10:17] == [
        "DEN8 Amazon",
        "21000 E 13th Ave",
        "",
        "AURORA",
        "CO",
        "80018",
        "US",
    ]
    assert lines[0][23:25] == ["197642130629-FNSKU", "139"]


@pytest.mark.parametrize(
    "text_lines, workbook_sheet, first_data_row, width",
    [
        (_po_text_lines, _po_sheet, 6, 9),
        (_order_text_lines, _order_sheet, 2, 35),
    ],
)
def test_import_text_matches_its_workbook_cell_for_cell(
    text_lines, workbook_sheet, first_data_row, width
):
    """The .txt is a render of the same rows, so it can never drift from the sheet."""
    lines = text_lines()
    sheet = workbook_sheet()
    for offset, line in enumerate(lines):
        row = first_data_row + offset
        for column in range(1, width + 1):
            value = sheet.cell(row, column).value
            assert line[column - 1] == ("" if value is None else str(value))


def test_import_text_of_no_rows_is_empty():
    assert build_po_import_text([], purchase_order_number="X", supplier="Y") == b""
    assert _po_text_lines([]) == []
    assert _order_text_lines([]) == []


# ---- Shipment ledger ----------------------------------------------------


def test_ledger_filename_sanitizes_the_shipment_name():
    assert ledger_filename("NFA WHRP 7.17.26") == "LEDGER NFA WHRP 7.17.26.xlsx"
    assert ledger_filename('NFA/WHRP: "a"') == "LEDGER NFA WHRP a.xlsx"
    assert ledger_filename("") == "LEDGER.xlsx"


def test_shipment_ledger_has_summary_uploads_and_unique_lines():
    parsed = parse_fba_export("x.csv", FBA_EXPORT.encode("utf-8"))
    workbook = load_workbook(
        io.BytesIO(
            build_shipment_ledger_workbook(
                shipment={
                    "name": "NFA WHRP 7.17.26",
                    "vendor": "NFA",
                    "notes": "Week 29",
                    "created_at": "2026-09-09T12:00:00+00:00",
                    "created_by_email": "orville@example.com",
                },
                uploads=[
                    {
                        "filename": "North Face WHRP 7.17.26 1 OF 5.csv",
                        "amazon_shipment_id": "FBA19JHYH77Q",
                        "amazon_shipment_name": "NFA WHRP 7.17.26 1 OF 5",
                        "ship_to": "DEN8",
                        "box_count": 38,
                        "row_count": 2,
                        "total_units": 140,
                        "uploaded_by": "u1",
                        "uploaded_by_name": "Orville",
                        "created_at": "2026-09-09T13:00:00+00:00",
                    }
                ],
                sku_rows=parsed.rows,
                registered_by="Orville",
            )
        )
    )
    assert workbook.sheetnames == ["Summary", "FBA Shipments", "Uploads", "Lines"]

    summary = workbook["Summary"]
    assert summary["A2"].value == "Shipment"
    assert summary["B2"].value == "NFA WHRP 7.17.26"
    assert summary["B3"].value == "NFA"
    assert summary["B5"].value == "Orville"
    assert summary["B7"].value == 1
    assert summary["B10"].value == 2
    assert summary["B11"].value == 140

    fba = workbook["FBA Shipments"]
    assert [fba.cell(1, col).value for col in range(1, 6)] == [
        "Name",
        "Shipment ID",
        "Total SKUs",
        "Total Units",
        "Ship To",
    ]
    assert [fba.cell(2, col).value for col in range(1, 6)] == [
        "NFA WHRP 7.17.26 1 OF 5",
        "FBA19JHYH77Q",
        2,
        140,
        "DEN8",
    ]

    uploads = workbook["Uploads"]
    assert uploads["A1"].value == "Filename"
    assert uploads["A2"].value == "North Face WHRP 7.17.26 1 OF 5.csv"
    assert uploads["D2"].value == "DEN8"
    assert uploads["H2"].value == "Orville"

    lines = workbook["Lines"]
    assert [lines.cell(1, col).value for col in range(1, 6)] == [
        "SKU",
        "Description",
        "UPC",
        "FNSKU",
        "Total Units",
    ]
    assert lines["A2"].value == "197642130629-FNSKU"
    assert lines["C2"].value == 197642130629
    assert lines["E2"].value == 139
    assert lines["E3"].value == 1
    assert lines.max_row == 3


def test_shipment_ledger_fba_shipments_one_row_per_upload():
    workbook = load_workbook(
        io.BytesIO(
            build_shipment_ledger_workbook(
                shipment={"name": "NFA FBA 4.17.26 GRP 1", "vendor": "NFA", "created_at": ""},
                uploads=[
                    {
                        "amazon_shipment_name": "NFA FBA 4.17.26 GRP 1 1",
                        "amazon_shipment_id": "FBA19BSJC15G",
                        "row_count": 23,
                        "total_units": 141,
                        "ship_to": "DEN8",
                    },
                    {
                        "amazon_shipment_name": "NFA FBA 4.17.26 GRP 1 1",
                        "amazon_shipment_id": "FBA19BSFJ4YH",
                        "row_count": 23,
                        "total_units": 143,
                        "ship_to": "DEN8",
                    },
                ],
                sku_rows=[],
            )
        )
    )
    sheet = workbook["FBA Shipments"]
    assert sheet.max_row == 3
    assert [sheet.cell(2, col).value for col in range(1, 6)] == [
        "NFA FBA 4.17.26 GRP 1 1",
        "FBA19BSJC15G",
        23,
        141,
        "DEN8",
    ]
    assert [sheet.cell(3, col).value for col in range(1, 6)] == [
        "NFA FBA 4.17.26 GRP 1 1",
        "FBA19BSFJ4YH",
        23,
        143,
        "DEN8",
    ]


def test_shipment_ledger_allows_empty_uploads():
    workbook = load_workbook(
        io.BytesIO(
            build_shipment_ledger_workbook(
                shipment={"name": "Empty", "vendor": "DNK", "created_at": ""},
                uploads=[],
                sku_rows=[],
            )
        )
    )
    assert workbook["Summary"]["B7"].value == 0
    assert workbook["FBA Shipments"].max_row == 1
    assert workbook["Uploads"].max_row == 1
    assert workbook["Lines"].max_row == 1


def test_missing_sku_table_is_rejected():
    with pytest.raises(ShipmentManagerError, match="Could not find the SKU table"):
        _run("Shipment ID,FBA19JHYH77Q\nBoxes,38\n")


def test_empty_file_is_rejected():
    with pytest.raises(ShipmentManagerError):
        _run("")
