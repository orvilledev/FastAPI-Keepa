"""Shipment Manager — turn Amazon FBA shipment exports into a WR SKU Update sheet.

The FBA "Individual units" export carries a metadata preamble, a SKU table, and a
per-box footer. Only the SKU table feeds the WR SKU Update sheet: SKU, Title and
FNSKU copy across verbatim and the UPC is the numeric portion of the SKU. The nine
dimension columns are left empty for the warehouse team to fill in.

A registered shipment collects the rows from several uploads. Each upload keeps
its own rows, and `dedupe_by_upc` collapses them to one row per UPC only when the
sheet is compiled — so removing one upload never disturbs another's rows.
"""
import csv
import io
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from openpyxl import load_workbook

logger = logging.getLogger(__name__)

OUTPUT_FILENAME = "WR SKU UPDATE TEMPLATE.xlsx"

TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent
    / "static"
    / "shipment_manager"
    / "WR_SKU_UPDATE_TEMPLATE.xlsx"
)

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
