"""Tests for OBZ / SMW FBA INV ledger splitting."""
from __future__ import annotations

import io
import zipfile
from datetime import datetime
from pathlib import Path

import pytest
from openpyxl import load_workbook

from app.services.obz_smw_fba_inv import (
    ObzSmwFbaInvError,
    extract_ledger_csv_bytes,
    generate_fba_inv_reports,
)

SAMPLE_CSV = """Date,FNSKU,ASIN,MSKU,Title,Disposition,Starting Warehouse Balance,In Transit Between Warehouses,Receipts,Customer Shipments,Customer Returns,Vendor Returns,Warehouse Transfer In/Out,Found,Lost,Damaged,Disposed,Other Events,Ending Warehouse Balance,Unknown Events,Location,Store
11/14/2026,B0H6GMFB3W,B0H6GMFB3W,810173982429,"Oboz Men's Crosscut Low, Olive Branch, 11.5",SELLABLE,3,0,0,0,0,0,0,0,0,0,0,0,3,0,IND4,
11/14/2026,X005E4OEFF,B0DK9Y4XWF,197803941040-FNSKU,Smartwool Hike Sock,SELLABLE,1,0,0,0,0,0,0,0,0,0,0,0,1,0,BDL4,
11/14/2026,X005CX15YV,B0HM4HK1FN,9990384-FNSKU,Smartwool Hike Targeted Cushion Ankle Multipack,SELLABLE,1,0,0,0,0,0,0,0,0,0,0,0,1,0,FAT1,
11/14/2026,X00AMZN,B0AMZNTEST,amzn.gr.840127897653-abc,Oboz Ghost Row,SELLABLE,1,0,0,0,0,0,0,0,0,0,0,0,1,0,TST1,
11/14/2026,B0OTHER,B0OTHER,123456789012,Z SUPPLY Tee,SELLABLE,2,0,0,0,0,0,0,0,0,0,0,0,2,0,AAA1,
"""


def test_extract_csv_from_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("3076054020773.csv", SAMPLE_CSV)
    csv_bytes = extract_ledger_csv_bytes("ledger.zip", buf.getvalue())
    assert b"Oboz Men's Crosscut" in csv_bytes


def test_generate_splits_obz_and_smw_with_types():
    result = generate_fba_inv_reports(
        "3076054020773.csv",
        SAMPLE_CSV.encode("utf-8"),
        extra_old_sku_to_upc={"9990384": "197642705582"},
    )
    assert result.obz_rows == 1
    assert result.smw_rows == 2
    assert result.dropped_amzn_rows == 1
    assert result.weekly_filename == "OBZ WEEKLY SALES REPORT WE 11.14.26.xlsx"
    assert result.master_filename == "SALES REPORT MASTERFILE 11.14.26.xlsx"

    with zipfile.ZipFile(io.BytesIO(result.zip_bytes)) as zf:
        names = set(zf.namelist())
        assert result.weekly_filename in names
        assert result.master_filename in names
        weekly = load_workbook(io.BytesIO(zf.read(result.weekly_filename)), data_only=False)
        master = load_workbook(io.BytesIO(zf.read(result.master_filename)), data_only=False)

    ws = weekly["FBA INV"]
    assert ws.cell(1, 4).value == "Vendor"
    assert isinstance(ws.cell(2, 1).value, datetime)
    assert ws.cell(2, 1).number_format == "mm-dd-yy"
    assert ws.cell(2, 5).value == "810173982429"
    assert isinstance(ws.cell(2, 5).value, str)
    assert ws.cell(2, 8).value == 3
    assert isinstance(ws.cell(2, 8).value, int)

    ms = master["FBA INV"]
    assert ms.cell(1, 4).value is None
    # -FNSKU stripped; FNSKU kept from raw
    assert ms.cell(2, 5).value == "197803941040"
    assert isinstance(ms.cell(2, 5).value, str)
    # 999 remapped via old-sku map
    assert {ms.cell(2, 5).value, ms.cell(3, 5).value} == {"197803941040", "197642705582"}


def test_rejects_non_ledger():
    with pytest.raises(ObzSmwFbaInvError, match="inventory ledger"):
        generate_fba_inv_reports("bad.csv", b"foo,bar\n1,2\n")


GOLDEN_DIR = Path(r"c:\Users\Administrator\Downloads\Paulo Project\OBZ_SMW")


@pytest.mark.skipif(
    not (GOLDEN_DIR / "3076054020773.csv").is_file(),
    reason="Golden Paulo OBZ/SMW sample files are not present on this machine",
)
def test_golden_ledger_row_counts_match():
    payload = (GOLDEN_DIR / "3076054020773.csv").read_bytes()
    result = generate_fba_inv_reports("3076054020773.csv", payload)
    assert result.obz_rows == 3068
    assert result.smw_rows == 132792
