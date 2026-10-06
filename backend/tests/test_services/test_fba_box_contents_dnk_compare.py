"""Tests for DNK Box Contents vs manifest compare / correct."""
from __future__ import annotations

from collections import defaultdict
from io import BytesIO
from pathlib import Path

import openpyxl
import pytest

from app.services.fba_box_contents_dnk_compare import (
    CONTENTS_SHEET,
    generate_dnk_box_contents_compare,
    parse_dnk_box_contents,
    parse_manifest,
    sanitize_download_filename,
)

SAMPLE_BOX = Path(r"c:\Users\Administrator\Downloads\FBA19QRV5XHD Box Contents.xlsx")
SAMPLE_MANIFEST = Path(r"c:\Users\Administrator\Downloads\manifest.xlsx")
SAMPLE_CORRECTED = Path(
    r"c:\Users\Administrator\Downloads\FBA19QRV5XHD Box Contents - corrected.xlsx"
)

# Catalog row that maps the UPC in Box Contents to Old SKU 50504 on the manifest.
SAMPLE_CATALOG = [
    {"old_sku": "50504", "upc_code": "673088034429", "vendor_name": "Dansko"},
]


def _totals(rows) -> dict[str, int | float]:
    totals: dict[str, int | float] = defaultdict(int)
    for row in rows:
        totals[row.identifier] += row.qty
    return dict(totals)


def test_sanitize_download_filename():
    assert sanitize_download_filename("FBA19QRV5XHD") == (
        "FBA19QRV5XHD Box Contents - corrected.xlsx"
    )
    assert sanitize_download_filename(None) == "Box Contents - corrected.xlsx"


@pytest.mark.skipif(not SAMPLE_BOX.exists(), reason="sample Box Contents missing")
def test_parse_dnk_box_contents_sample():
    parsed = parse_dnk_box_contents(
        SAMPLE_BOX.read_bytes(),
        filename=SAMPLE_BOX.name,
    )
    assert parsed.shipment_id == "FBA19QRV5XHD"
    assert len(parsed.rows) == 136
    assert sum(r.qty for r in parsed.rows) == 250
    assert any(r.identifier == "673088034429" for r in parsed.rows)
    assert parsed.dimensions
    assert parsed.dimensions[-1].box_number == 21


@pytest.mark.skipif(not SAMPLE_MANIFEST.exists(), reason="sample manifest missing")
def test_parse_manifest_sample():
    parsed = parse_manifest(SAMPLE_MANIFEST.read_bytes())
    assert parsed.shipment_id == "FBA19QRV5XHD"
    assert len(parsed.skus) == 100
    assert sum(s.expected_qty for s in parsed.skus) == 255
    sku_ids = {s.sku_id for s in parsed.skus}
    assert "50504" in sku_ids
    assert "673088448608" in sku_ids
    assert "673088519421" in sku_ids


@pytest.mark.skipif(
    not (SAMPLE_BOX.exists() and SAMPLE_MANIFEST.exists()),
    reason="sample files missing",
)
def test_generate_matches_corrected_sample_adjustments():
    result = generate_dnk_box_contents_compare(
        SAMPLE_BOX.read_bytes(),
        SAMPLE_MANIFEST.read_bytes(),
        SAMPLE_CATALOG,
        box_contents_filename=SAMPLE_BOX.name,
        manifest_filename=SAMPLE_MANIFEST.name,
    )

    assert result.shipment_id == "FBA19QRV5XHD"
    assert result.filename == "FBA19QRV5XHD Box Contents - corrected.xlsx"
    assert result.total_qty == 255
    assert result.last_box == 21
    assert result.remapped_count == 1
    assert result.added_count == 2
    assert result.added_qty == 5

    wb = openpyxl.load_workbook(BytesIO(result.file_bytes), data_only=True)
    assert CONTENTS_SHEET in wb.sheetnames
    sheet = wb[CONTENTS_SHEET]

    # Row 4 remapped to Old SKU 50504 and highlighted yellow in the live file.
    assert sheet["A4"].value == 1
    assert str(sheet["B4"].value) == "50504"
    assert sheet["C4"].value == 4

    # Last-box summary in E–G
    assert sheet["E1"].value == "FBA19QRV5XHD"
    assert sheet["E2"].value == "Box Number"
    assert sheet["F2"].value == "UPC"
    assert sheet["G2"].value == "QTY"
    summary = {
        (str(sheet.cell(r, 6).value), int(sheet.cell(r, 7).value))
        for r in (3, 4)
    }
    assert summary == {("673088448608", 1), ("673088519421", 4)}

    # Summary UPCs must be text so Excel never shows scientific notation.
    # Yellow fills on adjusted A–C cells.
    styled = openpyxl.load_workbook(BytesIO(result.file_bytes), data_only=False)[CONTENTS_SHEET]
    for r in (3, 4):
        cell = styled.cell(r, 6)
        assert cell.data_type == "s", f"F{r} should be text, got {cell.data_type}"
        assert "E+" not in str(cell.value).upper()
        assert "." not in str(cell.value)

    # Appended yellow rows at the end
    last_rows = {
        (str(sheet.cell(r, 2).value), int(sheet.cell(r, 3).value))
        for r in (sheet.max_row - 1, sheet.max_row)
    }
    assert last_rows == {("673088448608", 1), ("673088519421", 4)}
    assert sheet.cell(sheet.max_row, 1).value == 21

    # Pivot shifted to column I when summary is present
    assert sheet["I1"].value == "Sum of Quantity"

    assert "FFFF00" in str(styled["B4"].fill.fgColor.rgb)
    assert "FFFF00" in str(styled.cell(styled.max_row, 2).fill.fgColor.rgb)

    if SAMPLE_CORRECTED.exists():
        expected = openpyxl.load_workbook(SAMPLE_CORRECTED, data_only=True)[CONTENTS_SHEET]
        # Core A–C data must match the hand-corrected reference.
        for r in range(1, expected.max_row + 1):
            for c in range(1, 4):
                exp = expected.cell(r, c).value
                got = sheet.cell(r, c).value
                assert _norm(got) == _norm(exp), f"R{r}C{c}: {got!r} != {exp!r}"


def _norm(value: object) -> str | None:
    if value is None:
        return None
    return str(value).strip()