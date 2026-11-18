"""Parse the Label Station II catalog sheet (.xlsx / .csv).

Columns: UPC, External ID, Description, Vendor Name, Size, Color, MPN.
An FNSKU column, if present, is ignored: FNSKUs come from the Label Station catalog.
"""
from __future__ import annotations

import csv
import io
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import load_workbook

from app.repositories.warehouse_product_repository import normalize_upc_key
from app.services.warehouse_product_import import _spreadsheet_cell_str

FIELDS = ("upc", "external_id", "description", "vendor_name", "size", "color", "mpn")

_HEADER_ALIASES = {
    "upc": "upc",
    "external id": "external_id",
    "external_id": "external_id",
    "externalid": "external_id",
    "description": "description",
    "vendor name": "vendor_name",
    "vendor_name": "vendor_name",
    "vendor": "vendor_name",
    "size": "size",
    "color": "color",
    "colour": "color",
    "mpn": "mpn",
}

_HEADER_ERROR = (
    'The sheet must include a "UPC" column (plus External ID, Description, Vendor Name, '
    "Size, Color, MPN). Download the Label Station II template for the exact headers."
)


def _normalize_header(cell: Any) -> Optional[str]:
    if cell is None:
        return None
    key = " ".join(str(cell).strip().lower().split())
    return _HEADER_ALIASES.get(key)


def _header_mapping(headers: Tuple[Any, ...]) -> Optional[Dict[str, int]]:
    mapping: Dict[str, int] = {}
    for idx, header in enumerate(headers):
        field = _normalize_header(header)
        if field and field not in mapping:
            mapping[field] = idx
    # UPC alone could be any sheet; require at least one label field next to it.
    if "upc" not in mapping or len(mapping) < 2:
        return None
    return mapping


def _parse_row(mapping: Dict[str, int], values: Tuple[Any, ...]) -> Optional[Dict[str, str]]:
    def cell(name: str) -> str:
        idx = mapping.get(name)
        if idx is None or idx >= len(values):
            return ""
        return _spreadsheet_cell_str(values[idx])

    upc = normalize_upc_key(cell("upc"))
    if not upc:
        return None
    row = {field: cell(field) for field in FIELDS}
    row["upc"] = upc
    return row


def _parse_rows(rows: List[Tuple[Any, ...]]) -> Tuple[List[Dict[str, str]], int]:
    if not rows:
        return [], 0
    header_idx = -1
    mapping: Optional[Dict[str, int]] = None
    for idx, row in enumerate(rows[:20]):
        mapping = _header_mapping(row)
        if mapping:
            header_idx = idx
            break
    if not mapping:
        raise ValueError(_HEADER_ERROR)

    valid: List[Dict[str, str]] = []
    invalid = 0
    for row in rows[header_idx + 1 :]:
        if not any(c is not None and str(c).strip() for c in row):
            continue
        parsed = _parse_row(mapping, row)
        if parsed:
            valid.append(parsed)
        else:
            invalid += 1
    return valid, invalid


def parse_label_station2_csv(content: bytes) -> Tuple[List[Dict[str, str]], int]:
    text = content.decode("utf-8-sig", errors="replace")
    return _parse_rows([tuple(row) for row in csv.reader(io.StringIO(text))])


def _workbook_rows(content: bytes) -> List[Tuple[Any, ...]]:
    wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    try:
        sheet = None
        for name in wb.sheetnames:
            if name.strip().upper() == "PRODUCTS":
                sheet = wb[name]
                break
        if sheet is None:
            sheet = wb[wb.sheetnames[0]]
        return [tuple(row) for row in sheet.iter_rows(values_only=True)]
    finally:
        wb.close()


def parse_label_station2_spreadsheet(
    filename: str, content: bytes
) -> Tuple[List[Dict[str, str]], int]:
    lower = (filename or "").lower()
    if lower.endswith(".csv"):
        return parse_label_station2_csv(content)
    if not lower.endswith((".xlsx", ".xlsm")):
        raise ValueError("Upload a .xlsx, .xlsm, or .csv file.")
    try:
        rows = _workbook_rows(content)
    except Exception as exc:
        raise ValueError("Could not read the spreadsheet. Save it as .xlsx and try again.") from exc
    return _parse_rows(rows)


def dedupe_by_upc(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Last row wins for duplicate UPCs within one file."""
    seen: Dict[str, Dict[str, str]] = {}
    for row in rows:
        seen[row["upc"]] = row
    return list(seen.values())
