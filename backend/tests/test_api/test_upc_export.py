"""Manage UPCs Excel export keeps full UPC codes (no scientific notation)."""
from io import BytesIO

from openpyxl import load_workbook

from app.api.upcs import _upc_export_filename, _write_upc_export_workbook


def test_upc_export_filename_uses_xlsx():
    assert _upc_export_filename(None).endswith(".xlsx")
    assert _upc_export_filename(["dnk"]).startswith("upcs_dnk_")
    assert _upc_export_filename(["dnk"]).endswith(".xlsx")


def test_single_vendor_export_writes_upc_as_excel_text():
    rows = [
        {"upc": "673012345678", "category": "dnk"},
        {"upc": "196248203201", "category": "dnk"},
    ]
    raw = _write_upc_export_workbook(rows, single_vendor=True)
    wb = load_workbook(BytesIO(raw))
    try:
        ws = wb.active
        assert ws["A1"].value == "upc"
        assert ws["A2"].value == "673012345678"
        assert isinstance(ws["A2"].value, str)
        assert ws["A2"].number_format == "@"
        assert "E+" not in str(ws["A2"].value).upper()
        assert ws["A3"].value == "196248203201"
        assert ws["A3"].number_format == "@"
        assert ws["B1"].value is None
    finally:
        wb.close()


def test_multi_vendor_export_includes_category_column():
    rows = [
        {"upc": "673012345678", "category": "dnk"},
        {"upc": "812345678901", "category": "clk"},
    ]
    raw = _write_upc_export_workbook(rows, single_vendor=False)
    wb = load_workbook(BytesIO(raw))
    try:
        ws = wb.active
        assert [ws["A1"].value, ws["B1"].value] == ["upc", "category"]
        assert ws["A2"].value == "673012345678"
        assert ws["A2"].number_format == "@"
        assert ws["B2"].value == "dnk"
        assert ws["B3"].value == "clk"
    finally:
        wb.close()
