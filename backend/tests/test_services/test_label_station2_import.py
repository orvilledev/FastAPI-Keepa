"""Tests for Label Station II catalog sheet parsing."""
from io import BytesIO

import pytest
from openpyxl import Workbook

from app.services.label_station2_import import (
    dedupe_by_upc,
    parse_label_station2_csv,
    parse_label_station2_spreadsheet,
)

HEADERS = ["UPC", "External ID", "Description", "Vendor Name", "Size", "Color", "MPN"]


def test_parse_xlsx_template_row_with_numeric_cells():
    wb = Workbook()
    ws = wb.active
    ws.title = "PRODUCTS"
    ws.append(HEADERS)
    ws.append([194715379404, 194715379404, "M-ASCOT", "UGG", "10 M", "GREY SUEDE", 1101110])
    buf = BytesIO()
    wb.save(buf)

    rows, invalid = parse_label_station2_spreadsheet("catalog.xlsx", buf.getvalue())
    assert invalid == 0
    assert rows == [
        {
            "upc": "194715379404",
            "external_id": "194715379404",
            "description": "M-ASCOT",
            "vendor_name": "UGG",
            "size": "10 M",
            "color": "GREY SUEDE",
            "mpn": "1101110",
        }
    ]


def test_parse_ignores_fnsku_column_and_skips_rows_without_upc():
    content = (
        "UPC,External ID,FNSKU,Description,Vendor Name,Size,Color,MPN\n"
        "194715379404,194715379404,X0056D33KL,M-ASCOT,UGG,10 M,GREY SUEDE,1101110\n"
        ",123,X0,No UPC,UGG,9,BLACK,1\n"
    ).encode("utf-8")
    rows, invalid = parse_label_station2_csv(content)
    assert invalid == 1
    assert len(rows) == 1
    assert "fnsku" not in rows[0]
    assert rows[0]["mpn"] == "1101110"


def test_parse_requires_upc_header():
    with pytest.raises(ValueError):
        parse_label_station2_csv(b"Description,Size\nM-ASCOT,10 M\n")


def test_parse_rejects_unsupported_extension():
    with pytest.raises(ValueError):
        parse_label_station2_spreadsheet("catalog.xls", b"x")


def test_dedupe_last_row_wins():
    rows = [{"upc": "1", "size": "9"}, {"upc": "1", "size": "10"}]
    assert dedupe_by_upc(rows) == [{"upc": "1", "size": "10"}]
