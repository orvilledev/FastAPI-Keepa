"""Parse a bulk identifier list and build a catalog existence-check workbook.

Uploaded values are matched against warehouse_products ``sku``, ``upc``, and
``fnsku`` (exact match after trim).
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font

_MAX_UPLOAD_BYTES = 15 * 1024 * 1024
_MAX_IDS = 25_000
_CALIBRI = Font(name="Calibri", size=11)
_CALIBRI_BOLD = Font(name="Calibri", size=11, bold=True)

_HEADER_ALIASES = {
    "sku": "id",
    "skus": "id",
    "merchant sku": "id",
    "merchant_sku": "id",
    "product sku": "id",
    "upc": "id",
    "upcs": "id",
    "fnsku": "id",
    "fnskus": "id",
    "id": "id",
    "identifier": "id",
    "identifiers": "id",
    "value": "id",
    "code": "id",
}

_SKIP_HEADERS = frozenset(_HEADER_ALIASES.keys())


class WarehouseSkuCheckError(ValueError):
    """User-correctable catalog existence-check input problems."""


@dataclass(frozen=True)
class SkuCheckRow:
    query: str
    exists: bool
    matched_on: str = ""
    sku: str = ""
    upc: str = ""
    fnsku: str = ""
    style_name: str = ""
    condition: str = ""
    match_count: int = 0


@dataclass(frozen=True)
class SkuCheckResult:
    file_bytes: bytes
    filename: str
    total: int
    found: int
    missing: int
    unique_skus: int


def _cell_str(raw: Any) -> str:
    if raw is None or isinstance(raw, bool):
        return ""
    if isinstance(raw, int):
        return str(raw)
    if isinstance(raw, float):
        if raw.is_integer() and abs(raw) < 2**53:
            return str(int(raw))
        return format(raw, ".15g").strip()
    return str(raw).strip()


def _normalize_header(cell: Any) -> str | None:
    if cell is None:
        return None
    key = re.sub(r"\s+", " ", str(cell).strip().lower())
    return _HEADER_ALIASES.get(key)


def _split_tokens(text: str) -> list[str]:
    parts = re.split(r"[\n\r,;\t]+", text)
    return [part.strip() for part in parts if part.strip()]


def _is_header_label(value: str) -> bool:
    return value.strip().lower() in _SKIP_HEADERS


def _ids_from_table(rows: Sequence[Sequence[Any]]) -> list[str]:
    if not rows:
        return []
    header = rows[0]
    mapping: dict[str, int] = {}
    for idx, cell in enumerate(header):
        normalized = _normalize_header(cell)
        if normalized and normalized not in mapping:
            mapping[normalized] = idx

    if "id" in mapping:
        col = mapping["id"]
        values: list[str] = []
        for row in rows[1:]:
            if col < len(row):
                text = _cell_str(row[col])
                if text:
                    values.append(text)
        return values

    # No recognized header — take the first non-empty cell per row (including row 0).
    values: list[str] = []
    for row in rows:
        for cell in row:
            text = _cell_str(cell)
            if text:
                values.append(text)
                break
    return values


def _parse_text(content: bytes) -> list[str]:
    text = content.decode("utf-8-sig", errors="replace")
    return _split_tokens(text)


def _parse_csv_bytes(content: bytes) -> list[str]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = [tuple(row) for row in reader]
    return _ids_from_table(rows)


def _parse_excel(content: bytes) -> list[str]:
    try:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise WarehouseSkuCheckError(
            "Could not read the Excel file. Upload a valid .xlsx."
        ) from exc
    try:
        sheet = workbook[workbook.sheetnames[0]]
        rows = [tuple(row) for row in sheet.iter_rows(values_only=True)]
        return _ids_from_table(rows)
    finally:
        workbook.close()


def _parse_xls(content: bytes) -> list[str]:
    try:
        import xlrd
    except ImportError as exc:
        raise WarehouseSkuCheckError(
            "Reading .xls requires xlrd. Save as .xlsx or .txt and try again."
        ) from exc
    try:
        book = xlrd.open_workbook(file_contents=content)
        sheet = book.sheet_by_index(0)
        rows = [
            tuple(sheet.cell_value(r, c) for c in range(sheet.ncols))
            for r in range(sheet.nrows)
        ]
        return _ids_from_table(rows)
    except WarehouseSkuCheckError:
        raise
    except Exception as exc:
        raise WarehouseSkuCheckError(
            "Could not read the .xls file. Save as .xlsx or .txt."
        ) from exc


def parse_sku_list_file(filename: str | None, content: bytes) -> list[str]:
    """Extract unique identifiers from .txt / .csv / .xlsx / .xls, preserving order."""
    if not content:
        raise WarehouseSkuCheckError("Uploaded file is empty.")
    if len(content) > _MAX_UPLOAD_BYTES:
        raise WarehouseSkuCheckError("File is too large (max 15 MB).")

    name = (filename or "upload.txt").lower()
    if name.endswith((".xlsx", ".xlsm")) or content.startswith(b"PK"):
        values = _parse_excel(content)
    elif name.endswith(".xls"):
        values = _parse_xls(content)
    elif name.endswith(".csv"):
        values = _parse_csv_bytes(content)
    else:
        values = _parse_text(content)

    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        key = value.strip()
        if not key or _is_header_label(key):
            continue
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(key)
        if len(cleaned) > _MAX_IDS:
            raise WarehouseSkuCheckError(
                f"Too many identifiers (max {_MAX_IDS:,}). Split the file and try again."
            )

    if not cleaned:
        raise WarehouseSkuCheckError(
            "No identifiers found. Use a .txt (one SKU/UPC/FNSKU per line), "
            ".csv, or .xlsx with a SKU, UPC, or FNSKU column."
        )
    return cleaned


def _matched_fields(query: str, row: Mapping[str, Any]) -> list[str]:
    fields: list[str] = []
    if str(row.get("sku") or "").strip() == query:
        fields.append("SKU")
    if str(row.get("upc") or "").strip() == query:
        fields.append("UPC")
    if str(row.get("fnsku") or "").strip() == query:
        fields.append("FNSKU")
    return fields


def build_check_rows(
    queries: Sequence[str],
    found_by_query: Mapping[str, Sequence[Mapping[str, Any]]],
) -> list[SkuCheckRow]:
    rows: list[SkuCheckRow] = []
    for query in queries:
        matches = list(found_by_query.get(query) or [])
        if not matches:
            rows.append(SkuCheckRow(query=query, exists=False, match_count=0))
            continue
        first = matches[0]
        matched_set: list[str] = []
        for match in matches:
            for field in _matched_fields(query, match):
                if field not in matched_set:
                    matched_set.append(field)
        rows.append(
            SkuCheckRow(
                query=query,
                exists=True,
                matched_on=", ".join(matched_set),
                sku=str(first.get("sku") or ""),
                upc=str(first.get("upc") or ""),
                fnsku=str(first.get("fnsku") or ""),
                style_name=str(first.get("style_name") or ""),
                condition=str(first.get("condition") or ""),
                match_count=len(matches),
            )
        )
    return rows


def build_sku_check_workbook(rows: Sequence[SkuCheckRow]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Existence Check"
    headers = (
        "Input",
        "Exists",
        "Matched On",
        "SKU",
        "UPC",
        "FNSKU",
        "Style Name",
        "Condition",
        "Match Count",
    )
    for col, header in enumerate(headers, start=1):
        cell = sheet.cell(row=1, column=col, value=header)
        cell.font = _CALIBRI_BOLD

    for index, row in enumerate(rows, start=2):
        values = (
            row.query,
            "Yes" if row.exists else "No",
            row.matched_on or None,
            row.sku or None,
            row.upc or None,
            row.fnsku or None,
            row.style_name or None,
            row.condition or None,
            row.match_count,
        )
        for col, value in enumerate(values, start=1):
            cell = sheet.cell(row=index, column=col, value=value)
            cell.font = _CALIBRI
            if col in (1, 4, 5, 6):
                cell.number_format = "@"

    widths = {
        "A": 18,
        "B": 10,
        "C": 14,
        "D": 16,
        "E": 16,
        "F": 14,
        "G": 40,
        "H": 12,
        "I": 12,
    }
    for letter, width in widths.items():
        sheet.column_dimensions[letter].width = width

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def generate_sku_check_workbook(
    queries: Sequence[str],
    found_by_query: Mapping[str, Sequence[Mapping[str, Any]]],
    *,
    filename: str = "Catalog Existence Check.xlsx",
) -> SkuCheckResult:
    rows = build_check_rows(queries, found_by_query)
    found = sum(1 for row in rows if row.exists)
    missing = len(rows) - found
    return SkuCheckResult(
        file_bytes=build_sku_check_workbook(rows),
        filename=filename,
        total=len(rows),
        found=found,
        missing=missing,
        unique_skus=len(rows),
    )
