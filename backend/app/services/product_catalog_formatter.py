"""Turn Amazon shipment-plan exports into one product catalog workbook.

The upload is the Amazon shipment-plan sheet (preamble, then a SKU table whose
barcode column is ``UPC/EAN/ISBN/JAN/CODABAR``). The download is a single
``PRODUCTS`` sheet:

    UPC | SKU | fnsku | STYLE NAME | Condition

Several uploads are merged. The same UPC is kept once: the first row wins, and
later copies are dropped.
"""
from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass

from openpyxl import Workbook, load_workbook

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_FILES = 30
MAX_ROWS = 100_000

OUTPUT_FILENAME = "Product Catalog Formatter.xlsx"
SHEET_NAME = "PRODUCTS"
OUTPUT_HEADERS = ("UPC", "SKU", "fnsku", "STYLE NAME", "Condition")
# Widths taken from the Product Catalog Formatter sample workbook.
COLUMN_WIDTHS = {"A": 20.77734375, "B": 19.33203125, "C": 14.77734375, "D": 47.21875, "E": 12.77734375}

_SCHEME_PRIORITY = {"upc": 0, "ean": 1, "jan": 2, "isbn": 3, "codabar": 4}
_SCHEME_RE = re.compile(
    r"\b(UPC|EAN|ISBN|JAN|CODABAR)\s*:\s*([A-Za-z0-9][A-Za-z0-9\-]*)",
    re.IGNORECASE,
)
_SKU_AS_UPC = re.compile(r"^(\d{8,14})(?:-FNSKU)?$", re.IGNORECASE)
_SCIENTIFIC = re.compile(r"^\d+(?:\.\d+)?[eE][+\-]?\d+$")
_TRAILING_FLOAT = re.compile(r"^(\d+)\.0+$")


class ProductCatalogFormatterError(ValueError):
    """The upload is not a shipment-plan export we can format."""


@dataclass(frozen=True)
class CatalogProduct:
    upc: str
    sku: str
    fnsku: str
    style_name: str
    condition: str


@dataclass(frozen=True)
class FormatResult:
    file_bytes: bytes
    filename: str
    file_count: int
    row_count: int
    source_rows: int
    duplicates_removed: int
    skipped_rows: int


def _cell_text(value: object) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return str(value) if value >= 0 else ""
    if isinstance(value, float):
        if not math.isfinite(value) or value < 0:
            return ""
        if value.is_integer() and abs(value) < 2**53:
            return str(int(value))
        return format(value, ".15g").strip()
    return str(value).strip()


def _normalize_label(value: object) -> str:
    return re.sub(r"\s+", " ", _cell_text(value)).strip().lower()


def _is_upc_header(label: str) -> bool:
    if label == "upc":
        return True
    parts = [part.strip() for part in label.split("/")]
    return "upc" in parts


def _looks_like_barcode(code: str) -> bool:
    if re.fullmatch(r"\d{8,14}", code):
        return True
    return bool(re.fullmatch(r"\d{9}[\dX]", code))


def extract_barcode(value: object) -> str:
    """``UPC:198268465935`` -> ``198268465935``. Prefers UPC over EAN/ISBN/JAN."""
    text = _cell_text(value)
    if not text:
        return ""
    if _SCIENTIFIC.fullmatch(text.replace(" ", "")):
        raise ProductCatalogFormatterError(
            f"A barcode is stored in scientific notation ({text}). "
            "Upload the original Excel file so the full UPC is preserved."
        )
    matches = list(_SCHEME_RE.finditer(text))
    if matches:
        best = min(matches, key=lambda match: _SCHEME_PRIORITY.get(match.group(1).lower(), 9))
        code = best.group(2)
    elif ":" in text:
        code = text.split(":", 1)[1].strip().split()[0]
    else:
        code = text
    code = code.strip().replace(" ", "")
    float_match = _TRAILING_FLOAT.fullmatch(code)
    if float_match:
        code = float_match.group(1)
    compact = code.replace("-", "")
    if _looks_like_barcode(compact):
        return compact
    if _looks_like_barcode(code):
        return code
    return ""


def _upc_from_sku(value: object) -> str:
    match = _SKU_AS_UPC.fullmatch(_cell_text(value))
    return match.group(1) if match else ""


def _rows_from_delimited(content: bytes, filename: str) -> list[list[object]]:
    try:
        text = content.decode("utf-8-sig", errors="replace")
    except Exception as exc:  # noqa: BLE001
        raise ProductCatalogFormatterError(f'Could not read "{filename}".') from exc
    first_line = text.split("\n", 1)[0]
    delimiter = "\t" if first_line.count("\t") > first_line.count(",") else ","
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
    rows: list[list[object]] = []
    for row in reader:
        rows.append(list(row))
        if len(rows) > MAX_ROWS:
            raise ProductCatalogFormatterError(f'"{filename}" has too many rows (max {MAX_ROWS:,}).')
    return rows


def _rows_from_xlsx(content: bytes, filename: str) -> list[list[object]]:
    try:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise ProductCatalogFormatterError(
            f'Could not read "{filename}" as an Excel workbook.'
        ) from exc
    try:
        rows: list[list[object]] = []
        for sheet in workbook.worksheets:
            for row in sheet.iter_rows(values_only=True):
                rows.append(list(row))
                if len(rows) > MAX_ROWS:
                    raise ProductCatalogFormatterError(
                        f'"{filename}" has too many rows (max {MAX_ROWS:,}).'
                    )
            # A blank spacer keeps a header on the next sheet from being read as data.
            rows.append([])
        if rows:
            rows.pop()
        return rows
    finally:
        workbook.close()


def _rows_from_xls(content: bytes, filename: str) -> list[list[object]]:
    try:
        import xlrd
    except ImportError as exc:  # pragma: no cover
        raise ProductCatalogFormatterError(
            "Reading .xls files requires xlrd. Upload .xlsx or .csv instead."
        ) from exc
    try:
        book = xlrd.open_workbook(file_contents=content)
    except Exception as exc:  # noqa: BLE001
        raise ProductCatalogFormatterError(
            f'Could not read "{filename}". Upload a valid .xls, .xlsx or .csv file.'
        ) from exc
    rows: list[list[object]] = []
    for sheet in book.sheets():
        for row_index in range(sheet.nrows):
            values: list[object] = []
            for col_index in range(sheet.ncols):
                cell = sheet.cell(row_index, col_index)
                if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                    values.append(None)
                elif cell.ctype == xlrd.XL_CELL_BOOLEAN:
                    values.append(bool(cell.value))
                else:
                    values.append(cell.value)
            rows.append(values)
            if len(rows) > MAX_ROWS:
                raise ProductCatalogFormatterError(
                    f'"{filename}" has too many rows (max {MAX_ROWS:,}).'
                )
        rows.append([])
    if rows:
        rows.pop()
    return rows


def read_grid(filename: str, content: bytes) -> list[list[object]]:
    if not content:
        raise ProductCatalogFormatterError(f'"{filename}" is empty.')
    if len(content) > MAX_UPLOAD_BYTES:
        raise ProductCatalogFormatterError(f'"{filename}" is too large (max 15 MB).')

    lowered = (filename or "").lower()
    stripped = content.lstrip().lower()
    if stripped.startswith(b"<html") or stripped.startswith(b"<!doctype"):
        raise ProductCatalogFormatterError(
            f'"{filename}" looks like a web page saved as a spreadsheet. '
            "Re-export it as .xlsx or .csv."
        )
    if content.startswith(b"PK"):
        return _rows_from_xlsx(content, filename)
    if content.startswith(b"\xd0\xcf\x11\xe0"):
        return _rows_from_xls(content, filename)
    if lowered.endswith((".csv", ".txt", ".tsv", ".xlsx", ".xlsm", ".xls")):
        return _rows_from_delimited(content, filename)
    raise ProductCatalogFormatterError(
        f'"{filename}" is not a supported file. Upload .xlsx, .xlsm, .xls, or .csv.'
    )


def _cell_at(row: list[object], index: int) -> object:
    if index < 0 or index >= len(row):
        return None
    return row[index]


def _find_header(rows: list[list[object]]) -> tuple[int, dict[str, int]] | None:
    for index, row in enumerate(rows):
        mapping: dict[str, int] = {}
        for col, value in enumerate(row):
            label = _normalize_label(value)
            if not label:
                continue
            if label == "sku" and "sku" not in mapping:
                mapping["sku"] = col
            elif label == "title" and "title" not in mapping:
                mapping["title"] = col
            elif label == "fnsku" and "fnsku" not in mapping:
                mapping["fnsku"] = col
            elif label == "condition" and "condition" not in mapping:
                mapping["condition"] = col
            elif _is_upc_header(label) and "upc" not in mapping:
                mapping["upc"] = col
        if "sku" in mapping and "upc" in mapping:
            return index, mapping
    return None


def parse_shipment_plan(filename: str, content: bytes) -> tuple[list[CatalogProduct], int]:
    """Return product rows in file order, plus rows under the table that had no UPC."""
    rows = read_grid(filename or "upload", content)
    header = _find_header(rows)
    if header is None:
        raise ProductCatalogFormatterError(
            f'Could not find a SKU table with a UPC/EAN/ISBN/JAN/CODABAR column in "{filename}".'
        )
    header_index, cols = header
    products: list[CatalogProduct] = []
    skipped = 0
    for row in rows[header_index + 1 :]:
        sku = _cell_text(_cell_at(row, cols["sku"]))
        barcode_cell = _cell_at(row, cols["upc"])
        barcode_text = _cell_text(barcode_cell)
        title = _cell_text(_cell_at(row, cols["title"])) if "title" in cols else ""
        fnsku = _cell_text(_cell_at(row, cols["fnsku"])) if "fnsku" in cols else ""
        condition = _cell_text(_cell_at(row, cols["condition"])) if "condition" in cols else ""
        if not any((sku, barcode_text, title, fnsku, condition)):
            continue
        if sku.lower() == "sku" and _normalize_label(barcode_cell) in {"", "upc", "upc/ean/isbn/jan/codabar"}:
            continue
        try:
            upc = extract_barcode(barcode_cell) if barcode_text else ""
        except ProductCatalogFormatterError as exc:
            raise ProductCatalogFormatterError(f'"{filename}": {exc}') from exc
        if not upc and not barcode_text:
            upc = _upc_from_sku(sku)
        if not upc:
            skipped += 1
            continue
        products.append(
            CatalogProduct(
                upc=upc,
                sku=sku,
                fnsku=fnsku,
                style_name=title,
                condition=condition,
            )
        )
    if not products and skipped == 0:
        raise ProductCatalogFormatterError(f'No product rows were found in "{filename}".')
    return products, skipped


def _dedupe(products: list[CatalogProduct]) -> tuple[list[CatalogProduct], int]:
    seen: dict[str, CatalogProduct] = {}
    order: list[str] = []
    duplicates = 0
    for product in products:
        key = product.upc.casefold()
        if key in seen:
            duplicates += 1
            continue
        seen[key] = product
        order.append(key)
    return [seen[key] for key in order], duplicates


def build_workbook(products: list[CatalogProduct]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = SHEET_NAME
    sheet.append(list(OUTPUT_HEADERS))
    for product in products:
        sheet.append(
            [product.upc, product.sku, product.fnsku, product.style_name, product.condition]
        )
    for letter, width in COLUMN_WIDTHS.items():
        sheet.column_dimensions[letter].width = width
    # Keep identifiers as text so Excel does not rewrite a UPC as a number.
    for row in sheet.iter_rows(min_row=2, max_row=sheet.max_row, min_col=1, max_col=3):
        for cell in row:
            cell.number_format = "@"
            if cell.value is None:
                cell.value = ""
            else:
                cell.value = str(cell.value)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def format_catalogs(uploads: list[tuple[str, bytes]]) -> FormatResult:
    """Merge one or more shipment-plan exports into one catalog workbook."""
    if not uploads:
        raise ProductCatalogFormatterError("No files were uploaded.")
    if len(uploads) > MAX_FILES:
        raise ProductCatalogFormatterError(f"Upload at most {MAX_FILES} files at a time.")

    products: list[CatalogProduct] = []
    skipped = 0
    for filename, content in uploads:
        parsed, file_skipped = parse_shipment_plan(filename, content)
        products.extend(parsed)
        skipped += file_skipped

    unique, duplicates = _dedupe(products)
    if not unique:
        raise ProductCatalogFormatterError(
            "No product rows with a UPC were found. "
            "Upload the shipment-plan file that has a UPC/EAN/ISBN/JAN/CODABAR column."
        )
    return FormatResult(
        file_bytes=build_workbook(unique),
        filename=OUTPUT_FILENAME,
        file_count=len(uploads),
        row_count=len(unique),
        source_rows=len(products),
        duplicates_removed=duplicates,
        skipped_rows=skipped,
    )
