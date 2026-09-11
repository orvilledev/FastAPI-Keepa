"""Shipment Manager — turn Amazon FBA shipment exports into warehouse sheets.

The FBA "Individual units" export carries a metadata preamble, a SKU table, and a
per-box footer. Only the SKU table feeds the outputs.

Two sheets come out of it:

* **WR SKU Update** — one row per UPC across the whole shipment. SKU, Title and
  FNSKU copy across verbatim and the UPC is the numeric portion of the SKU. The
  nine dimension columns are left empty for the warehouse team to fill in.
  A registered shipment collects the rows from several uploads; each upload keeps
  its own rows, and `dedupe_by_upc` collapses them to one row per UPC only when
  the sheet is compiled — so removing one upload never disturbs another's rows.
* **PO Import** — the Berry purchase-order import template, built per upload
  rather than merged, because one purchase order covers one FBA shipment.
* **Order Import** — the warehouse order import template, also per upload. The
  ship-to block comes from the Ship To Address Catalog, looked up by the
  fulfilment-centre code in the export's "Ship to" line (DEN8, ONT8, …).
"""
import csv
import io
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

logger = logging.getLogger(__name__)

OUTPUT_FILENAME = "WR SKU UPDATE TEMPLATE.xlsx"

INPUT_SUFFIXES = (".csv", ".txt", ".tsv", ".xlsx", ".xlsm")

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static" / "shipment_manager"

TEMPLATE_PATH = _STATIC_DIR / "WR_SKU_UPDATE_TEMPLATE.xlsx"
PO_TEMPLATE_PATH = _STATIC_DIR / "WR_PO_IMPORT_TEMPLATE.xlsx"
ORDER_TEMPLATE_PATH = _STATIC_DIR / "WR_ORDER_IMPORT_TEMPLATE.xlsx"

_MAX_ROWS_SCANNED = 20000
_HEADER_SEARCH_LIMIT = 60
_UPC_NUMBER_FORMAT = "0"

# Columns the FBA export must expose for the SKU table to be usable.
_SKU_COLUMN = "sku"
_TITLE_COLUMN = "title"
_FNSKU_COLUMN = "fnsku"
_ASIN_COLUMN = "asin"
_TOTAL_UNITS_COLUMN = "total units"
_REQUIRED_COLUMNS = (_SKU_COLUMN, _TITLE_COLUMN, _FNSKU_COLUMN)

# Metadata rows in the export preamble, keyed by their label.
_META_SHIPMENT_ID = "shipment id"
_META_SHIPMENT_NAME = "shipment name"
_META_SHIP_TO = "ship to"
_META_BOXES = "boxes"

_FNSKU_SUFFIX = re.compile(r"[-_\s]*FNSKU$", re.IGNORECASE)

# --- Import text files ----------------------------------------------------
# The warehouse also takes each import sheet as Excel's "Text (Tab delimited)"
# save-as: every template column, tab separated, no header or banner rows,
# CRLF line endings and a trailing newline, written in ANSI like Excel does.
_TEXT_ENCODING = "cp1252"
_TEXT_NEWLINE = "\r\n"

# --- PO Import template ---------------------------------------------------
# Rows 1-4 are the banner and row 5 holds the headers, so data starts at row 6.
_PO_FIRST_DATA_ROW = 6
_PO_COLUMN_COUNT = 9
_PO_COL_PURCHASE_ORDER_NUMBER = 1
_PO_COL_SUPPLIER_COMPANY_NAME = 2
_PO_COL_ITEM_NUMBER = 5
_PO_COL_ITEM_QUANTITY = 6
_PO_COL_FACILITY = 7
_PO_FACILITY = "WHREP Ontario"
# The template's own body typeface; blank columns keep the sheet default.
_PO_BODY_FONT = Font(name="Open Sans", size=11, family=2)

# Brand names as they appear at the start of an FBA Title, mapped to the
# SupplierCompanyName Extensiv expects. Longer names are matched first.
_SUPPLIER_BRANDS = (
    ("the north face", "North Face"),
    ("north face", "North Face"),
    ("smartwool", "Smartwool"),
    ("dansko", "Dansko"),
    ("oboz", "Oboz"),
    ("clarks", "Clarks"),
    ("josef seibel", "Josef Seibel"),
    ("josef siebel", "Josef Seibel"),
    ("chaco", "Chaco"),
    ("teva", "Teva"),
    ("reef", "Reef"),
    ("born", "Born"),
    ("sofft", "Sofft"),
    ("ugg", "UGG"),
)
_SUPPLIER_BRAND_BOUNDARY = re.compile(r"[\s,/'()\-]")
_SUPPLIER_CODES = {
    "nfa": "North Face",
    "dnk": "Dansko",
    "smw": "Smartwool",
    "obz": "Oboz",
    "clk": "Clarks",
    "jfs": "Josef Seibel",
    "cha": "Chaco",
    "tev": "Teva",
    "ref": "Reef",
    "bor": "Born",
    "sff": "Sofft",
    "ugg": "UGG",
}

# Where the supplier name stops in an export's filename. Everything before the
# first date, count or warehouse code is the supplier: "North Face WHRP 7.17.26
# 1 OF 5.csv" -> "North Face".
_SUPPLIER_STOP_WORDS = frozenset(
    {
        "box",
        "boxes",
        "contents",
        "export",
        "fba",
        "individual",
        "of",
        "pallet",
        "pallets",
        "ship",
        "shipment",
        "shipments",
        "sku",
        "skus",
        "to",
        "unit",
        "units",
        "wh",
        "whrep",
        "whrp",
    }
)
_SUPPLIER_TOKEN_SPLIT = re.compile(r"[\s_\-]+")

# --- Order Import template ------------------------------------------------
# Row 1 holds the headers, so data starts at row 2.
_ORDER_FIRST_DATA_ROW = 2
_ORDER_COLUMN_COUNT = 35
_ORDER_COL_REFERENCE_NUMBER = 1
_ORDER_COL_PURCHASE_ORDER_NUMBER = 2
_ORDER_COL_SHIP_TO_COMPANY = 11
_ORDER_COL_SHIP_TO_ADDRESS_1 = 12
_ORDER_COL_SHIP_TO_ADDRESS_2 = 13
_ORDER_COL_SHIP_TO_CITY = 14
_ORDER_COL_SHIP_TO_STATE = 15
_ORDER_COL_SHIP_TO_ZIP = 16
_ORDER_COL_SHIP_TO_COUNTRY = 17
_ORDER_COL_SKU = 24
_ORDER_COL_QUANTITY = 25
# Amazon fulfilment centres are entered as "DEN8 Amazon" on the order sheet.
_ORDER_COMPANY_SUFFIX = "Amazon"
_ORDER_COUNTRY = "US"
# The template's own body typeface; column A also wraps.
_ORDER_BODY_FONT = Font(name="Calibri", size=11, family=2)
_ORDER_WRAP = Alignment(wrap_text=True)

# Amazon fulfilment-centre codes are three letters and one or two digits.
_SHIP_TO_CODE = re.compile(r"[A-Z]{3}[0-9]{1,2}", re.IGNORECASE)


class ShipmentManagerError(Exception):
    """Raised when an uploaded shipment file cannot be converted."""


@dataclass
class ShipmentSkuRow:
    sku: str
    description: str
    upc: str
    fnsku: str
    total_units: int = 0


@dataclass
class ShipToAddress:
    """One Ship To Address Catalog entry, as the order sheet needs it."""

    code: str
    address_1: str = ""
    address_2: str = ""
    city: str = ""
    state: str = ""
    postal_code: str = ""
    country: str = _ORDER_COUNTRY

    @property
    def company(self) -> str:
        return f"{self.code} {_ORDER_COMPANY_SUFFIX}".strip()


@dataclass
class ShipmentManagerResult:
    workbook_bytes: bytes = b""
    filename: str = OUTPUT_FILENAME
    shipment_id: str = ""
    shipment_name: str = ""
    ship_to: str = ""
    box_count: int = 0
    sku_count: int = 0
    total_units: int = 0
    duplicate_skus: int = 0
    rows: List[ShipmentSkuRow] = field(default_factory=list)


def _normalize(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _detect_delimiter(text: str) -> str:
    first_line = text.split("\n", 1)[0]
    return "\t" if first_line.count("\t") > first_line.count(",") else ","


def _rows_from_csv(content: bytes) -> List[List[str]]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=_detect_delimiter(text))
    rows: List[List[str]] = []
    for row in reader:
        rows.append([_normalize(cell) for cell in row])
        if len(rows) >= _MAX_ROWS_SCANNED:
            break
    return rows


def _rows_from_xlsx(content: bytes) -> List[List[str]]:
    try:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as a 400
        raise ShipmentManagerError(
            "That file could not be read as an Excel workbook. Upload the FBA shipment export."
        ) from exc
    try:
        sheet = workbook.worksheets[0]
        rows: List[List[str]] = []
        for row in sheet.iter_rows(values_only=True):
            rows.append([_normalize(cell) for cell in row])
            if len(rows) >= _MAX_ROWS_SCANNED:
                break
        return rows
    finally:
        workbook.close()


def _read_rows(filename: str, content: bytes) -> List[List[str]]:
    if filename.lower().endswith((".xlsx", ".xlsm")):
        return _rows_from_xlsx(content)
    return _rows_from_csv(content)


def _find_header_row(rows: Sequence[Sequence[str]]) -> int:
    """Locate the SKU table header, which sits below the shipment metadata preamble."""
    for index, row in enumerate(rows[:_HEADER_SEARCH_LIMIT]):
        labels = {cell.strip().lower() for cell in row if cell}
        if all(column in labels for column in _REQUIRED_COLUMNS):
            return index
    raise ShipmentManagerError(
        "Could not find the SKU table in that file. Expected a header row with "
        "SKU, Title and FNSKU columns, as produced by the FBA shipment export."
    )


def _column_index(header: Sequence[str], label: str) -> Optional[int]:
    for index, cell in enumerate(header):
        if cell.strip().lower() == label:
            return index
    return None


def _cell(row: Sequence[str], index: Optional[int]) -> str:
    if index is None or index >= len(row):
        return ""
    return row[index]


def _parse_metadata(rows: Sequence[Sequence[str]], header_index: int) -> Dict[str, str]:
    """Read the label/value pairs that precede the SKU table."""
    metadata: Dict[str, str] = {}
    for row in rows[:header_index]:
        if len(row) < 2:
            continue
        label = row[0].strip().lower()
        value = row[1].strip()
        if label and value and label not in metadata:
            metadata[label] = value
    return metadata


def _to_int(value: str) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _upc_from_sku(sku: str) -> str:
    """Strip the -FNSKU suffix; the remainder is the UPC in Amazon merchant SKUs."""
    return _FNSKU_SUFFIX.sub("", sku).strip()


def _parse_sku_rows(rows: Sequence[Sequence[str]], header_index: int) -> tuple[List[ShipmentSkuRow], int]:
    header = rows[header_index]
    sku_at = _column_index(header, _SKU_COLUMN)
    title_at = _column_index(header, _TITLE_COLUMN)
    fnsku_at = _column_index(header, _FNSKU_COLUMN)
    units_at = _column_index(header, _TOTAL_UNITS_COLUMN)

    parsed: List[ShipmentSkuRow] = []
    seen_upcs: set[str] = set()
    duplicates = 0

    for row in rows[header_index + 1 :]:
        sku = _cell(row, sku_at)
        # A blank SKU marks the end of the table; the per-box footer follows it.
        if not sku:
            break
        upc = _upc_from_sku(sku)
        if not upc:
            continue
        # One row per UPC — later repeats of the same UPC (same SKU or a
        # different SKU that strips to the same digits) are dropped.
        if upc in seen_upcs:
            duplicates += 1
            continue
        seen_upcs.add(upc)
        parsed.append(
            ShipmentSkuRow(
                sku=sku,
                description=_cell(row, title_at),
                upc=upc,
                fnsku=_cell(row, fnsku_at),
                total_units=_to_int(_cell(row, units_at)),
            )
        )

    if not parsed:
        raise ShipmentManagerError("No SKU rows were found below the header in that file.")
    return parsed, duplicates


def stored_rows_to_sku_rows(stored: Sequence[dict]) -> List[ShipmentSkuRow]:
    """Turn persisted shipment_sku_rows into compile-ready SKU rows."""
    return [
        ShipmentSkuRow(
            sku=row.get("sku") or "",
            description=row.get("description") or "",
            upc=row.get("upc") or "",
            fnsku=row.get("fnsku") or "",
            total_units=int(row.get("total_units") or 0),
        )
        for row in stored
    ]


def compile_stored_rows(stored: Sequence[dict]) -> tuple[List[ShipmentSkuRow], int]:
    """Merge stored rows and drop later duplicates by UPC. Returns (unique rows, collected count)."""
    sku_rows = stored_rows_to_sku_rows(stored)
    return dedupe_by_upc(sku_rows), len(sku_rows)


def dedupe_by_upc(sku_rows: Sequence[ShipmentSkuRow]) -> List[ShipmentSkuRow]:
    """Collapse rows to one per UPC, keeping the first occurrence."""
    seen: set[str] = set()
    unique: List[ShipmentSkuRow] = []
    for item in sku_rows:
        upc = (item.upc or "").strip()
        if not upc or upc in seen:
            continue
        seen.add(upc)
        unique.append(item)
    return unique


def build_workbook(sku_rows: Sequence[ShipmentSkuRow]) -> bytes:
    """Render rows into a copy of the WR SKU Update template."""
    return _build_workbook(sku_rows)


_LEDGER_HEADER_FILL = PatternFill(fill_type="solid", fgColor="FF404040")
_LEDGER_HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFFFF")
_LEDGER_BODY_FONT = Font(name="Calibri", size=11)
_LEDGER_SUMMARY_LABEL_FONT = Font(name="Calibri", size=11, bold=True)


def ledger_filename(shipment_name: str) -> str:
    """Name the ledger download after the shipment."""
    cleaned = re.sub(r'[\\/:*?"<>|]+', " ", (shipment_name or "").strip())
    cleaned = " ".join(cleaned.split())
    return f"LEDGER {cleaned}.xlsx" if cleaned else "LEDGER.xlsx"


def _ledger_autosize(sheet, min_width: float = 12, max_width: float = 48) -> None:
    for column_cells in sheet.columns:
        letter = get_column_letter(column_cells[0].column)
        widest = 0
        for cell in column_cells:
            value = "" if cell.value is None else str(cell.value)
            widest = max(widest, len(value))
        sheet.column_dimensions[letter].width = min(max(widest + 2, min_width), max_width)


def _ledger_write_header(sheet, headers: Sequence[str]) -> None:
    for index, title in enumerate(headers, start=1):
        cell = sheet.cell(row=1, column=index, value=title)
        cell.fill = _LEDGER_HEADER_FILL
        cell.font = _LEDGER_HEADER_FONT


def build_shipment_ledger_workbook(
    *,
    shipment: dict,
    uploads: Sequence[dict],
    sku_rows: Sequence[ShipmentSkuRow],
    registered_by: str = "",
) -> bytes:
    """Build a ledger workbook for one registered shipment.

    Sheets:
    * **Summary** — registration metadata and counts
    * **FBA Shipments** — one row per uploaded FBA export (name, id, SKUs, units, ship-to)
    * **Uploads** — file-level contribution history
    * **Lines** — unique SKUs across the shipment
    """
    workbook = Workbook()
    summary = workbook.active
    summary.title = "Summary"
    fba_sheet = workbook.create_sheet("FBA Shipments")
    uploads_sheet = workbook.create_sheet("Uploads")
    lines_sheet = workbook.create_sheet("Lines")

    unique_upcs = len(sku_rows)
    collected_rows = sum(int(item.get("row_count") or 0) for item in uploads)
    total_units = sum(item.total_units for item in sku_rows)
    registered_at = str(shipment.get("created_at") or "")
    if registered_at.endswith("+00:00"):
        registered_at = registered_at[:-6] + "Z"

    summary_rows = (
        ("Shipment", shipment.get("name") or ""),
        ("Vendor", shipment.get("vendor") or ""),
        ("Status", str(shipment.get("status") or "open").replace("_", " ").title()),
        ("Notes", shipment.get("notes") or ""),
        ("Registered by", registered_by or shipment.get("created_by_email") or ""),
        ("Registered at", registered_at),
        ("Uploads", len(uploads)),
        ("Contributors", len({str(item.get("uploaded_by") or "") for item in uploads if item.get("uploaded_by")})),
        ("Collected rows", collected_rows),
        ("Unique UPCs", unique_upcs),
        ("Total units (unique lines)", total_units),
    )
    summary["A1"] = "Field"
    summary["B1"] = "Value"
    summary["A1"].fill = _LEDGER_HEADER_FILL
    summary["B1"].fill = _LEDGER_HEADER_FILL
    summary["A1"].font = _LEDGER_HEADER_FONT
    summary["B1"].font = _LEDGER_HEADER_FONT
    for offset, (label, value) in enumerate(summary_rows, start=2):
        label_cell = summary.cell(row=offset, column=1, value=label)
        label_cell.font = _LEDGER_SUMMARY_LABEL_FONT
        value_cell = summary.cell(row=offset, column=2, value=value)
        value_cell.font = _LEDGER_BODY_FONT
    _ledger_autosize(summary, min_width=14, max_width=60)

    # One row per FBA export — Name / Shipment ID / Total SKUs / Total Units / Ship To
    # come from the export preamble and SKU table we stored when the file was uploaded.
    fba_headers = ("Name", "Shipment ID", "Total SKUs", "Total Units", "Ship To")
    _ledger_write_header(fba_sheet, fba_headers)
    for offset, upload in enumerate(uploads, start=2):
        values = (
            upload.get("amazon_shipment_name") or "",
            upload.get("amazon_shipment_id") or "",
            int(upload.get("row_count") or 0),
            int(upload.get("total_units") or 0),
            upload.get("ship_to") or "",
        )
        for column, value in enumerate(values, start=1):
            cell = fba_sheet.cell(row=offset, column=column, value=value)
            cell.font = _LEDGER_BODY_FONT
    _ledger_autosize(fba_sheet, min_width=12, max_width=40)

    upload_headers = (
        "Filename",
        "Amazon Shipment ID",
        "Amazon Shipment Name",
        "Ship To",
        "Boxes",
        "Rows",
        "Total Units",
        "Uploaded By",
        "Uploaded At",
    )
    _ledger_write_header(uploads_sheet, upload_headers)
    for offset, upload in enumerate(uploads, start=2):
        uploaded_at = str(upload.get("created_at") or "")
        if uploaded_at.endswith("+00:00"):
            uploaded_at = uploaded_at[:-6] + "Z"
        values = (
            upload.get("filename") or "",
            upload.get("amazon_shipment_id") or "",
            upload.get("amazon_shipment_name") or "",
            upload.get("ship_to") or "",
            int(upload.get("box_count") or 0),
            int(upload.get("row_count") or 0),
            int(upload.get("total_units") or 0),
            upload.get("uploaded_by_name")
            or upload.get("uploaded_by_email")
            or "",
            uploaded_at,
        )
        for column, value in enumerate(values, start=1):
            cell = uploads_sheet.cell(row=offset, column=column, value=value)
            cell.font = _LEDGER_BODY_FONT
    _ledger_autosize(uploads_sheet)

    line_headers = ("SKU", "Description", "UPC", "FNSKU", "Total Units")
    _ledger_write_header(lines_sheet, line_headers)
    for offset, item in enumerate(sku_rows, start=2):
        upc_value: object = int(item.upc) if item.upc.isdigit() else item.upc
        values = (item.sku, item.description, upc_value, item.fnsku, item.total_units)
        for column, value in enumerate(values, start=1):
            cell = lines_sheet.cell(row=offset, column=column, value=value)
            cell.font = _LEDGER_BODY_FONT
            if column == 3:
                cell.number_format = _UPC_NUMBER_FORMAT
    _ledger_autosize(lines_sheet, max_width=56)

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _build_workbook(sku_rows: Sequence[ShipmentSkuRow]) -> bytes:
    if not TEMPLATE_PATH.is_file():
        raise ShipmentManagerError("The WR SKU Update template file is missing on the server.")

    workbook = load_workbook(TEMPLATE_PATH)
    try:
        sheet = workbook.active
        for offset, item in enumerate(sku_rows):
            row_number = offset + 2  # row 1 holds the template header
            sheet.cell(row=row_number, column=1, value=item.sku)
            sheet.cell(row=row_number, column=2, value=item.description)
            upc_cell = sheet.cell(row=row_number, column=3)
            # The template stores the UPC as a number so it renders without quotes.
            upc_cell.value = int(item.upc) if item.upc.isdigit() else item.upc or None
            upc_cell.number_format = _UPC_NUMBER_FORMAT
            sheet.cell(row=row_number, column=4, value=item.fnsku)
        buffer = io.BytesIO()
        workbook.save(buffer)
        return buffer.getvalue()
    finally:
        workbook.close()


def supplier_from_filename(filename: str) -> str:
    """The leading words of an export's filename, which name the supplier.

    Uploads are named after the vendor and the warehouse run — "North Face WHRP
    7.17.26 1 OF 5.csv", "Dansko WHRP 8.1.26.csv" — so the supplier is every word
    before the first warehouse code, date or count. A filename that starts with
    the FBA id carries no supplier and yields "".
    """
    stem = (filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    for suffix in INPUT_SUFFIXES:
        if stem.lower().endswith(suffix):
            stem = stem[: -len(suffix)]
            break

    words: List[str] = []
    for token in _SUPPLIER_TOKEN_SPLIT.split(stem):
        word = token.strip(" .,()[]{}")
        if not word:
            continue
        if word.lower() in _SUPPLIER_STOP_WORDS or any(char.isdigit() for char in word):
            break
        words.append(word)
    return " ".join(words)


def supplier_from_title(title: str) -> str:
    """The brand at the start of an FBA Title, e.g. 'The North Face Borealis…'."""
    text = (title or "").strip()
    if not text:
        return ""
    lowered = text.lower()
    for needle, canonical in _SUPPLIER_BRANDS:
        if not lowered.startswith(needle):
            continue
        rest = text[len(needle) :]
        if rest and not _SUPPLIER_BRAND_BOUNDARY.match(rest[0]):
            continue
        return canonical
    return ""


def supplier_from_titles(titles: Sequence[str]) -> str:
    """First known brand found in the SKU titles. One PO is one supplier."""
    for title in titles:
        brand = supplier_from_title(title)
        if brand:
            return brand
    return ""


def _supplier_from_code_token(text: str) -> str:
    for token in _SUPPLIER_TOKEN_SPLIT.split(text or ""):
        mapped = _SUPPLIER_CODES.get(token.strip().lower())
        if mapped:
            return mapped
    return ""


def resolve_po_supplier(
    sku_rows: Sequence[ShipmentSkuRow],
    *,
    filename: str = "",
    shipment_name: str = "",
) -> str:
    """Prefer the FBA Title brand, then the filename, then a vendor code in the shipment name."""
    from_titles = supplier_from_titles(item.description for item in sku_rows)
    if from_titles:
        return from_titles
    from_file_raw = supplier_from_filename(filename)
    from_file = supplier_from_title(from_file_raw) or from_file_raw
    if from_file:
        return from_file
    return _supplier_from_code_token(shipment_name) or _supplier_from_code_token(filename)


def _filename_label(value: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', " ", (value or "").strip())
    return " ".join(cleaned.split())


def _import_text_filename(
    shipment_id: str,
    *,
    box_count: int,
    total_units: int,
    kind: str,
) -> str:
    """Warehouse naming: '{ShipmentID} OF {boxes} {units} WR {kind}.txt'.

    The shared samples follow this shape — e.g. ``FBA19JHYH77Q OF 38 157 WR PO
    Import.txt`` — where ``38`` is the FBA export's box count and ``157`` is the
    sum of units on the lines being exported.
    """
    label = _filename_label(shipment_id) or "IMPORT"
    return f"{label} OF {int(box_count)} {int(total_units)} WR {kind}.txt"


def po_import_text_filename(
    shipment_id: str, *, box_count: int, total_units: int
) -> str:
    return _import_text_filename(
        shipment_id, box_count=box_count, total_units=total_units, kind="PO Import"
    )


def order_import_text_filename(
    shipment_id: str, *, box_count: int, total_units: int
) -> str:
    return _import_text_filename(
        shipment_id, box_count=box_count, total_units=total_units, kind="Order Import"
    )


def _text_cell(value: object) -> str:
    """Render one cell the way Excel's tab-delimited save-as does."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _rows_to_tab_text(rows: Sequence[Sequence[object]]) -> bytes:
    """Join full-width rows into the warehouse's tab-delimited text file."""
    lines = ["\t".join(_text_cell(cell) for cell in row) for row in rows]
    if not lines:
        return b""
    body = _TEXT_NEWLINE.join(lines) + _TEXT_NEWLINE
    # Excel writes ANSI and substitutes anything the code page cannot express.
    return body.encode(_TEXT_ENCODING, errors="replace")


def po_import_filename(purchase_order_number: str, supplier: str) -> str:
    """Name the PO Import download after whatever identifies the upload."""
    label = " ".join(part for part in (supplier.strip(), purchase_order_number.strip()) if part)
    return f"PO IMPORT {label}.xlsx" if label else "PO IMPORT.xlsx"


def _po_import_rows(
    sku_rows: Sequence[ShipmentSkuRow],
    *,
    purchase_order_number: str,
    supplier: str,
) -> List[List[object]]:
    """One full-width PO template row per SKU — the single source both outputs render.

    Facility is always WHREP Ontario. IssueDate, PONotes, ExpectedDate and
    LineItemNotes stay blank — the FBA export does not carry them.
    """
    purchase_order = purchase_order_number.strip()
    company = supplier.strip()
    rows: List[List[object]] = []
    for item in sku_rows:
        row: List[object] = [""] * _PO_COLUMN_COUNT
        row[_PO_COL_PURCHASE_ORDER_NUMBER - 1] = purchase_order
        row[_PO_COL_SUPPLIER_COMPANY_NAME - 1] = company
        row[_PO_COL_ITEM_NUMBER - 1] = item.sku or ""
        row[_PO_COL_ITEM_QUANTITY - 1] = item.total_units
        row[_PO_COL_FACILITY - 1] = _PO_FACILITY
        rows.append(row)
    return rows


def build_po_import_workbook(
    sku_rows: Sequence[ShipmentSkuRow],
    *,
    purchase_order_number: str,
    supplier: str,
) -> bytes:
    """Render one upload's rows into a copy of the Berry PO import template."""
    if not PO_TEMPLATE_PATH.is_file():
        raise ShipmentManagerError("The PO Import template file is missing on the server.")

    rows = _po_import_rows(
        sku_rows, purchase_order_number=purchase_order_number, supplier=supplier
    )
    workbook = load_workbook(PO_TEMPLATE_PATH)
    try:
        sheet = workbook.active
        for offset, row in enumerate(rows):
            row_number = _PO_FIRST_DATA_ROW + offset
            for column, value in enumerate(row, start=1):
                if value == "":
                    continue
                cell = sheet.cell(row=row_number, column=column, value=value)
                cell.font = _PO_BODY_FONT
        buffer = io.BytesIO()
        workbook.save(buffer)
        return buffer.getvalue()
    finally:
        workbook.close()


def build_po_import_text(
    sku_rows: Sequence[ShipmentSkuRow],
    *,
    purchase_order_number: str,
    supplier: str,
) -> bytes:
    """The PO Import sheet as tab-delimited text, line for line with the workbook."""
    return _rows_to_tab_text(
        _po_import_rows(
            sku_rows, purchase_order_number=purchase_order_number, supplier=supplier
        )
    )


def ship_to_code(ship_to: str) -> str:
    """The fulfilment-centre code in an export's "Ship to" line, e.g. 'DEN8'.

    Exports name the destination as a bare code, sometimes followed by the
    warehouse address. Everything after the code is ignored — the catalog is
    keyed on the code alone.
    """
    match = _SHIP_TO_CODE.search(ship_to or "")
    if match:
        return match.group(0).upper()
    first = (ship_to or "").replace(",", " ").split()
    return first[0].upper() if first else ""


def ship_to_address_from_catalog(code: str, record: dict) -> ShipToAddress:
    """Build the order sheet's ship-to block from a catalog row."""
    return ShipToAddress(
        code=(code or record.get("code") or "").strip().upper(),
        address_1=_normalize(record.get("address_1")),
        city=_normalize(record.get("city")),
        state=_normalize(record.get("state")),
        postal_code=_normalize(record.get("postal_code")),
    )


def order_import_filename(reference_number: str, code: str) -> str:
    """Name the Order Import download after the ship-to code and the FBA id."""
    label = " ".join(part for part in (code.strip(), reference_number.strip()) if part)
    return f"ORDER IMPORT {label}.xlsx" if label else "ORDER IMPORT.xlsx"


def _order_import_rows(
    sku_rows: Sequence[ShipmentSkuRow],
    *,
    reference_number: str,
    address: ShipToAddress,
) -> List[List[object]]:
    """One full-width order template row per SKU — the single source both outputs render.

    Reference Number and Purchase Order Number are both the FBA shipment id, and
    every line repeats the same ship-to block. The carrier, date, phone and
    option columns stay blank — the FBA export does not carry them.
    """
    reference = reference_number.strip()
    rows: List[List[object]] = []
    for item in sku_rows:
        row: List[object] = [""] * _ORDER_COLUMN_COUNT
        row[_ORDER_COL_REFERENCE_NUMBER - 1] = reference
        row[_ORDER_COL_PURCHASE_ORDER_NUMBER - 1] = reference
        row[_ORDER_COL_SHIP_TO_COMPANY - 1] = address.company
        row[_ORDER_COL_SHIP_TO_ADDRESS_1 - 1] = address.address_1
        row[_ORDER_COL_SHIP_TO_ADDRESS_2 - 1] = address.address_2
        row[_ORDER_COL_SHIP_TO_CITY - 1] = address.city
        row[_ORDER_COL_SHIP_TO_STATE - 1] = address.state
        row[_ORDER_COL_SHIP_TO_ZIP - 1] = address.postal_code
        row[_ORDER_COL_SHIP_TO_COUNTRY - 1] = address.country
        row[_ORDER_COL_SKU - 1] = item.sku or ""
        row[_ORDER_COL_QUANTITY - 1] = item.total_units
        rows.append(row)
    return rows


def build_order_import_workbook(
    sku_rows: Sequence[ShipmentSkuRow],
    *,
    reference_number: str,
    address: ShipToAddress,
) -> bytes:
    """Render one upload's rows into a copy of the warehouse order import template."""
    if not ORDER_TEMPLATE_PATH.is_file():
        raise ShipmentManagerError("The Order Import template file is missing on the server.")

    rows = _order_import_rows(
        sku_rows, reference_number=reference_number, address=address
    )
    workbook = load_workbook(ORDER_TEMPLATE_PATH)
    try:
        sheet = workbook["Order Import Template"]
        for offset, row in enumerate(rows):
            row_number = _ORDER_FIRST_DATA_ROW + offset
            for column, value in enumerate(row, start=1):
                if value == "":
                    continue
                cell = sheet.cell(row=row_number, column=column, value=value)
                cell.font = _ORDER_BODY_FONT
                if column == _ORDER_COL_REFERENCE_NUMBER:
                    cell.alignment = _ORDER_WRAP
        buffer = io.BytesIO()
        workbook.save(buffer)
        return buffer.getvalue()
    finally:
        workbook.close()


def build_order_import_text(
    sku_rows: Sequence[ShipmentSkuRow],
    *,
    reference_number: str,
    address: ShipToAddress,
) -> bytes:
    """The Order Import sheet as tab-delimited text, line for line with the workbook."""
    return _rows_to_tab_text(
        _order_import_rows(sku_rows, reference_number=reference_number, address=address)
    )


def parse_fba_export(filename: str, content: bytes) -> ShipmentManagerResult:
    """Read an FBA shipment export into SKU rows without rendering a workbook."""
    rows = _read_rows(filename or "shipment.csv", content)
    if not rows:
        raise ShipmentManagerError("That file is empty.")

    header_index = _find_header_row(rows)
    metadata = _parse_metadata(rows, header_index)
    sku_rows, duplicates = _parse_sku_rows(rows, header_index)

    return ShipmentManagerResult(
        shipment_id=metadata.get(_META_SHIPMENT_ID, ""),
        shipment_name=metadata.get(_META_SHIPMENT_NAME, ""),
        ship_to=metadata.get(_META_SHIP_TO, ""),
        box_count=_to_int(metadata.get(_META_BOXES, "")),
        sku_count=len(sku_rows),
        total_units=sum(item.total_units for item in sku_rows),
        duplicate_skus=duplicates,
        rows=sku_rows,
    )


def build_wr_sku_update(filename: str, content: bytes) -> ShipmentManagerResult:
    """Convert a single FBA shipment export into a filled WR SKU Update workbook."""
    result = parse_fba_export(filename, content)
    result.workbook_bytes = _build_workbook(result.rows)
    return result
