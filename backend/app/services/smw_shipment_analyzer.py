"""SMW Shipment Analyzer — box-contents requests checked against Amazon pack lists.

Two file shapes feed this tool, and either may arrive as .xls, .xlsx or .csv:

* the **box-contents request** (``FBA… - bc request.xls``) — a carton dump with a
  ``PO#:`` shipment id, a ``Sku`` / ``UPC`` / ``Description`` / ``Qty`` header and
  repeating ``Carton#:`` blocks, each closed by a ``Total`` row, with a
  ``Total Ctns:`` / ``Total Units:`` footer;
* the **pack list** (``FBA… - pack list.csv``) — the Seller Central export whose
  preamble carries ``Shipment ID`` / ``Boxes`` / ``SKUs`` / ``Units`` and whose
  table holds one ``{UPC}-FNSKU`` row per barcode with ``Total units`` and one
  ``Box N units`` column per box.

Both sides reduce to units-per-UPC, which is what the basic analysis compares,
alongside the shipment id and the totals each file declares about itself.

Advanced analysis takes many files at once, pairs them by shipment id, and then
tries to explain every leftover difference by hunting for an opposite difference
elsewhere — the case where units were keyed against the wrong shipment. It works
through progressively looser theories (same UPC in another shipment, then the
same description under a different barcode) and only reports a difference as
unresolved once every theory has failed, recording what was searched.
"""
from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_TOTAL_BYTES = 80 * 1024 * 1024
MAX_FILES = 30
_MAX_ROWS_SCANNED = 200_000

BASIC_FILENAME = "SMW Shipment Analysis.xlsx"
ADVANCED_FILENAME = "SMW Advanced Shipment Analysis.xlsx"

SUMMARY_SHEET = "Summary"
COMPARISON_SHEET = "UPC Comparison"
DISCREPANCIES_SHEET = "Discrepancies"
CROSS_SHEET = "Cross-Shipment Matches"
UNRESOLVED_SHEET = "Unresolved"
FILES_SHEET = "Files"

KIND_CARTON = "carton"
KIND_PACK_LIST = "packlist"
KIND_LABELS = {KIND_CARTON: "Box contents request", KIND_PACK_LIST: "Pack list"}

STATUS_MATCH = "Match"
STATUS_QTY = "Quantity mismatch"
STATUS_ONLY_CARTON = "Only in box contents request"
STATUS_ONLY_PACK_LIST = "Only in pack list"

_CALIBRI = Font(name="Calibri", size=11)
_CALIBRI_BOLD = Font(name="Calibri", size=11, bold=True)
_TITLE_FONT = Font(name="Calibri", size=14, bold=True)
_LEFT = Alignment(horizontal="left", vertical="center")
_WRAP = Alignment(horizontal="left", vertical="top", wrap_text=True)
_HEADER_FILL = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
_GREEN_FILL = PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid")
_RED_FILL = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
_AMBER_FILL = PatternFill(start_color="FFEB9C", end_color="FFEB9C", fill_type="solid")

_FNSKU_SUFFIX = re.compile(r"[-_\s]*FNSKU$", re.IGNORECASE)
_BOX_UNITS_HEADER = re.compile(r"^box\s*(\d+)\s*units$")
# Amazon heads the quantity column "Total units" on a box-level pack list and
# "Quantity" on a shipment-plan export. "Qty" is deliberately absent: that is
# the box contents request's own heading.
_PACK_LIST_QTY_LABELS = frozenset({"total units", "quantity"})
_CARTON_LABELS = {"carton#:", "carton#", "carton:"}
_PO_LABELS = {"po#:", "po#", "po:"}


class SmwShipmentAnalyzerError(ValueError):
    """Raised for user-correctable input problems."""


Number = int | float


@dataclass(frozen=True)
class ParsedFile:
    """One uploaded file, reduced to units per UPC."""

    filename: str
    kind: str
    shipment_id: str
    units_by_upc: dict[str, Number]
    descriptions: dict[str, str]
    skus_by_upc: dict[str, str]
    line_count: int
    box_count: int
    total_units: Number
    # What the file says about itself, which need not agree with its own rows.
    declared_units: Number | None = None
    declared_box_count: int | None = None
    notes: tuple[str, ...] = ()

    @property
    def kind_label(self) -> str:
        return KIND_LABELS.get(self.kind, self.kind)


@dataclass(frozen=True)
class UpcComparison:
    shipment_id: str
    upc: str
    description: str
    carton_units: Number
    pack_list_units: Number
    delta: Number
    status: str


@dataclass(frozen=True)
class Discrepancy:
    shipment_id: str
    upc: str
    description: str
    issue: str
    carton_units: Number | None
    pack_list_units: Number | None
    delta: Number | None
    detail: str


@dataclass(frozen=True)
class CheckRow:
    check: str
    carton_value: str
    pack_list_value: str
    result: str
    note: str = ""

    @property
    def matched(self) -> bool:
        return self.result == STATUS_MATCH


@dataclass(frozen=True)
class CrossShipmentMatch:
    upc: str
    description: str
    units: Number
    surplus_shipment: str
    shortfall_shipment: str
    confidence: str
    finding: str


@dataclass(frozen=True)
class UnresolvedDelta:
    shipment_id: str
    upc: str
    description: str
    side: str
    units: Number
    searched: str
    finding: str


@dataclass
class ShipmentAnalysis:
    """One shipment id, with whichever of the two sides were uploaded for it."""

    shipment_id: str
    carton: ParsedFile | None = None
    pack_list: ParsedFile | None = None
    extra_files: list[ParsedFile] = field(default_factory=list)
    checks: list[CheckRow] = field(default_factory=list)
    comparisons: list[UpcComparison] = field(default_factory=list)
    discrepancies: list[Discrepancy] = field(default_factory=list)

    @property
    def paired(self) -> bool:
        return self.carton is not None and self.pack_list is not None

    @property
    def files(self) -> list[ParsedFile]:
        present = [item for item in (self.carton, self.pack_list) if item is not None]
        return present + self.extra_files

    @property
    def carton_units(self) -> Number:
        return self.carton.total_units if self.carton else 0

    @property
    def pack_list_units(self) -> Number:
        return self.pack_list.total_units if self.pack_list else 0

    @property
    def upc_count(self) -> int:
        return len({row.upc for row in self.comparisons})

    @property
    def matched_upc_count(self) -> int:
        return sum(1 for row in self.comparisons if row.status == STATUS_MATCH)


@dataclass(frozen=True)
class AnalyzerResult:
    file_bytes: bytes
    filename: str
    shipment_id: str
    shipment_count: int
    file_count: int
    upc_count: int
    total_units: Number
    discrepancy_count: int
    resolved_count: int
    unresolved_count: int

    @property
    def clean(self) -> bool:
        return self.discrepancy_count == 0

# --- Reading uploads ------------------------------------------------------


def _cell_text(value: object) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return ""
        if value.is_integer() and abs(value) < 2**53:
            return str(int(value))
        return format(value, ".15g").strip()
    return str(value).strip()


def _normalize_label(value: object) -> str:
    return re.sub(r"\s+", " ", _cell_text(value)).strip().lower()


def _as_number(value: object) -> Number | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return int(value) if value.is_integer() and abs(value) < 2**53 else value
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() and abs(number) < 2**53 else number


def _as_qty(value: object) -> Number:
    parsed = _as_number(value)
    return 0 if parsed is None else parsed


def _as_digits(value: object) -> str:
    """A barcode as plain digits, surviving Excel's float coercion of long UPCs."""
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return str(value) if value >= 0 else ""
    if isinstance(value, float):
        if not math.isfinite(value) or value < 0:
            return ""
        if abs(value) < 2**53:
            return str(int(round(value)))
        return format(value, ".0f")
    text = str(value).strip()
    if re.fullmatch(r"\d+\.0+", text):
        return text.split(".", 1)[0]
    return text


def _looks_like_upc(value: object) -> bool:
    text = _as_digits(value).replace(" ", "")
    return bool(text) and text.isdigit() and 8 <= len(text) <= 14


def _rows_from_delimited(content: bytes) -> list[list[object]]:
    text = content.decode("utf-8-sig", errors="replace")
    first_line = text.split("\n", 1)[0]
    delimiter = "\t" if first_line.count("\t") > first_line.count(",") else ","
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
    rows: list[list[object]] = []
    for row in reader:
        rows.append(list(row))
        if len(rows) >= _MAX_ROWS_SCANNED:
            break
    return rows


def _rows_from_xlsx(content: bytes, filename: str) -> list[list[object]]:
    try:
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as a 400
        raise SmwShipmentAnalyzerError(
            f"Could not read \"{filename}\" as an Excel workbook."
        ) from exc
    try:
        sheet = workbook.worksheets[0]
        rows: list[list[object]] = []
        for row in sheet.iter_rows(values_only=True):
            rows.append(list(row))
            if len(rows) >= _MAX_ROWS_SCANNED:
                break
        return rows
    finally:
        workbook.close()


def _rows_from_xls(content: bytes, filename: str) -> list[list[object]]:
    try:
        import xlrd
    except ImportError as exc:  # pragma: no cover - xlrd ships with the backend
        raise SmwShipmentAnalyzerError(
            "Reading .xls files requires xlrd. Upload .xlsx or .csv instead."
        ) from exc
    try:
        book = xlrd.open_workbook(file_contents=content)
        sheet = book.sheet_by_index(0)
        rows: list[list[object]] = []
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
        return rows
    except SmwShipmentAnalyzerError:
        raise
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as a 400
        raise SmwShipmentAnalyzerError(
            f"Could not read \"{filename}\". Upload a valid .xls, .xlsx or .csv file."
        ) from exc


def read_grid(filename: str, content: bytes) -> list[list[object]]:
    """Every uploaded shape flattened to a grid of cells."""
    if not content:
        raise SmwShipmentAnalyzerError(f"\"{filename}\" is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise SmwShipmentAnalyzerError(f"\"{filename}\" is too large (max 15 MB).")

    lowered = (filename or "").lower()
    stripped = content.lstrip().lower()
    if stripped.startswith(b"<html") or stripped.startswith(b"<!doctype"):
        raise SmwShipmentAnalyzerError(
            f"\"{filename}\" looks like an HTML page saved as a spreadsheet. "
            "Re-export it as .xls, .xlsx or .csv."
        )

    if content.startswith(b"PK"):
        return _rows_from_xlsx(content, filename)
    if content.startswith(b"\xd0\xcf\x11\xe0"):
        return _rows_from_xls(content, filename)
    if lowered.endswith((".csv", ".txt", ".tsv")):
        return _rows_from_delimited(content)
    return _rows_from_delimited(content)


def _cell_at(row: Sequence[object], index: int) -> object:
    if index < 0 or index >= len(row):
        return None
    return row[index]


def _row_is_blank(row: Sequence[object]) -> bool:
    return all(_cell_text(cell) == "" for cell in row)

# --- Parsing the box contents request -------------------------------------


def _find_carton_header(rows: Sequence[Sequence[object]]) -> tuple[int, dict[str, int]] | None:
    """Locate the Sku / UPC / Qty header, which may have blank spacer columns."""
    wanted = {
        "sku": "sku",
        "upc": "upc",
        "description": "description",
        "qty": "qty",
        "quantity": "qty",
    }
    for index, row in enumerate(rows):
        mapping: dict[str, int] = {}
        for col, value in enumerate(row):
            key = wanted.get(_normalize_label(value))
            if key and key not in mapping:
                mapping[key] = col
        if {"sku", "upc", "qty"} <= set(mapping):
            return index, mapping
    return None


def _looks_like_carton_request(rows: Sequence[Sequence[object]]) -> bool:
    if _find_carton_header(rows) is None:
        return False
    return any(
        _normalize_label(_cell_at(row, 0)).replace(" ", "") in _CARTON_LABELS for row in rows
    )


def _labelled_value(row: Sequence[object], label: str) -> object:
    """The first non-empty cell after a label cell, as the footer row lays them out."""
    for index, cell in enumerate(row):
        if _normalize_label(cell) != label:
            continue
        for follower in range(index + 1, len(row)):
            if _cell_text(_cell_at(row, follower)) != "":
                return _cell_at(row, follower)
    return None


def parse_carton_request(filename: str, rows: Sequence[Sequence[object]]) -> ParsedFile:
    header = _find_carton_header(rows)
    if header is None:
        raise SmwShipmentAnalyzerError(
            f"Could not find a Sku / UPC / Qty header in \"{filename}\"."
        )
    header_index, cols = header
    sku_col = cols["sku"]
    upc_col = cols["upc"]
    qty_col = cols["qty"]
    description_col = cols.get("description", -1)

    shipment_id = ""
    for row in rows[: max(header_index, 1)]:
        if _normalize_label(_cell_at(row, 0)).replace(" ", "") in _PO_LABELS:
            candidate = _cell_text(_cell_at(row, 1))
            if candidate:
                shipment_id = candidate
                break

    units_by_upc: dict[str, Number] = {}
    descriptions: dict[str, str] = {}
    skus_by_upc: dict[str, str] = {}
    declared_units: Number | None = None
    declared_boxes: Number | None = None
    carton_ids: list[str] = []
    line_count = 0
    total_units: Number = 0
    seen_carton = False

    for row in rows[header_index + 1 :]:
        first_label = _normalize_label(_cell_at(row, 0)).replace(" ", "")
        if first_label in _CARTON_LABELS:
            seen_carton = True
            carton_ids.append(_cell_text(_cell_at(row, 1)))
            continue
        if first_label.startswith("totalctns"):
            declared_boxes = _as_number(_labelled_value(row, "total ctns:"))
            declared_units = _as_number(_labelled_value(row, "total units:"))
            continue
        if not seen_carton:
            continue
        # Per-carton "Total" rows restate the carton's own quantity; skip them.
        if any(_normalize_label(cell) == "total" for cell in row):
            continue
        if not _cell_text(_cell_at(row, sku_col)):
            continue
        upc_raw = _cell_at(row, upc_col)
        if not _looks_like_upc(upc_raw):
            continue
        upc = _as_digits(upc_raw)
        qty = _as_qty(_cell_at(row, qty_col))
        line_count += 1
        total_units += qty
        units_by_upc[upc] = units_by_upc.get(upc, 0) + qty
        skus_by_upc.setdefault(upc, _cell_text(_cell_at(row, sku_col)))
        if description_col >= 0 and upc not in descriptions:
            description = _cell_text(_cell_at(row, description_col))
            if description:
                descriptions[upc] = description

    if not carton_ids:
        raise SmwShipmentAnalyzerError(
            f"\"{filename}\" has no \"Carton#:\" rows under its Sku / UPC / Qty header."
        )
    if not units_by_upc:
        raise SmwShipmentAnalyzerError(
            f"No item rows with a UPC were found under any carton in \"{filename}\"."
        )

    notes: list[str] = []
    if not shipment_id:
        shipment_id = shipment_id_from_filename(filename)
        if shipment_id:
            notes.append(f"Shipment id {shipment_id} taken from the filename.")
        else:
            notes.append("No PO#/shipment id row found, and the filename holds no FBA id.")

    return ParsedFile(
        filename=filename,
        kind=KIND_CARTON,
        shipment_id=shipment_id,
        units_by_upc=units_by_upc,
        descriptions=descriptions,
        skus_by_upc=skus_by_upc,
        line_count=line_count,
        box_count=len(carton_ids),
        total_units=total_units,
        declared_units=declared_units,
        declared_box_count=int(declared_boxes) if declared_boxes is not None else None,
        notes=tuple(notes),
    )


# --- Parsing the pack list ------------------------------------------------


def _find_pack_list_header(rows: Sequence[Sequence[object]]) -> tuple[int, dict[str, int]] | None:
    """Locate the SKU table header of either pack-list export.

    The box-level export heads its quantity column ``Total units`` and adds a
    ``Box N units`` column per box. The shipment-plan export heads it
    ``Quantity`` and carries a ``UPC/EAN/ISBN/JAN/CODABAR`` column instead.
    """
    for index, row in enumerate(rows):
        mapping: dict[str, int] = {}
        for col, value in enumerate(row):
            label = _normalize_label(value)
            if label in {"sku", "title", "fnsku", "asin"} and label not in mapping:
                mapping[label] = col
            elif label in _PACK_LIST_QTY_LABELS and "qty" not in mapping:
                mapping["qty"] = col
            elif "upc" in label.split("/") and "upc" not in mapping:
                mapping["upc"] = col
        if "sku" in mapping and "qty" in mapping:
            return index, mapping
    return None


def _looks_like_pack_list(rows: Sequence[Sequence[object]]) -> bool:
    return _find_pack_list_header(rows) is not None


def strip_fnsku_suffix(value: str) -> str:
    """``198268465171-FNSKU`` -> ``198268465171``."""
    return _FNSKU_SUFFIX.sub("", (value or "").strip()).strip()


def _barcode_from_cell(value: object) -> str:
    """``UPC:198268465935`` -> ``198268465935``, dropping the scheme label."""
    text = _cell_text(value)
    if not text:
        return ""
    if ":" in text:
        text = text.split(":", 1)[1].strip()
    return _as_digits(text)


def shipment_id_from_filename(filename: str) -> str:
    """The FBA id Amazon uses to name these exports, when no row states it."""
    match = re.search(r"\bFBA[0-9A-Z]{6,}\b", Path(filename or "").stem.upper())
    return match.group(0) if match else ""


def parse_pack_list(filename: str, rows: Sequence[Sequence[object]]) -> ParsedFile:
    header = _find_pack_list_header(rows)
    if header is None:
        raise SmwShipmentAnalyzerError(
            f"Could not find a SKU table with a Total units or Quantity column in \"{filename}\"."
        )
    header_index, cols = header
    sku_col = cols["sku"]
    title_col = cols.get("title", -1)
    qty_col = cols["qty"]
    upc_col = cols.get("upc", -1)

    header_row = rows[header_index]
    box_columns = [
        col
        for col, value in enumerate(header_row)
        if _BOX_UNITS_HEADER.match(_normalize_label(value))
    ]

    preamble: dict[str, str] = {}
    for row in rows[:header_index]:
        label = _normalize_label(_cell_at(row, 0))
        value = _cell_text(_cell_at(row, 1))
        if label and value and label not in preamble:
            preamble[label] = value

    notes: list[str] = []
    shipment_id = preamble.get("shipment id", "")
    if not shipment_id:
        # The shipment-plan export names the shipment only in its filename.
        shipment_id = shipment_id_from_filename(filename)
        if shipment_id:
            notes.append(f"Shipment id {shipment_id} taken from the filename.")
        else:
            notes.append('No "Shipment ID" row, and the filename holds no FBA id.')
    declared_units = _as_number(preamble.get("units"))
    declared_boxes = _as_number(preamble.get("boxes"))

    units_by_upc: dict[str, Number] = {}
    descriptions: dict[str, str] = {}
    line_count = 0
    total_units: Number = 0
    boxes_used: set[int] = set()

    for row in rows[header_index + 1 :]:
        identifier = strip_fnsku_suffix(_cell_text(_cell_at(row, sku_col)))
        barcode = _barcode_from_cell(_cell_at(row, upc_col)) if upc_col >= 0 else ""
        if not identifier and not barcode:
            continue
        if barcode and _looks_like_upc(barcode):
            key = barcode
        elif _looks_like_upc(identifier):
            key = _as_digits(identifier)
        else:
            key = identifier
        qty = _as_qty(_cell_at(row, qty_col))
        line_count += 1
        total_units += qty
        units_by_upc[key] = units_by_upc.get(key, 0) + qty
        if title_col >= 0 and key not in descriptions:
            title = _cell_text(_cell_at(row, title_col))
            if title:
                descriptions[key] = title
        for offset, col in enumerate(box_columns, start=1):
            if _as_qty(_cell_at(row, col)):
                boxes_used.add(offset)

    if not units_by_upc:
        raise SmwShipmentAnalyzerError(f"No SKU rows were found in \"{filename}\".")

    # A shipment-plan export carries no box breakdown at all, which is different
    # from a box-level export that happens to use one box.
    box_count = len(box_columns) or len(boxes_used)
    if not box_count:
        notes.append("No box breakdown in this export, so box counts were not compared.")
    return ParsedFile(
        filename=filename,
        kind=KIND_PACK_LIST,
        shipment_id=shipment_id,
        units_by_upc=units_by_upc,
        descriptions=descriptions,
        skus_by_upc={},
        line_count=line_count,
        box_count=box_count,
        total_units=total_units,
        declared_units=declared_units,
        declared_box_count=int(declared_boxes) if declared_boxes is not None else None,
        notes=tuple(notes),
    )


def parse_upload(filename: str, content: bytes) -> ParsedFile:
    """Read one upload, deciding for itself which of the two shapes it is."""
    rows = read_grid(filename or "upload", content)
    if not rows or all(_row_is_blank(row) for row in rows):
        raise SmwShipmentAnalyzerError(f"\"{filename}\" has no rows.")
    # Carton blocks are the more distinctive marker, so they decide first.
    if _looks_like_carton_request(rows):
        return parse_carton_request(filename, rows)
    if _looks_like_pack_list(rows):
        return parse_pack_list(filename, rows)
    raise SmwShipmentAnalyzerError(
        f"Could not tell what \"{filename}\" is. Upload a box contents request "
        "(Carton#: blocks under a Sku / UPC / Qty header) or an Amazon pack list "
        "(a SKU table with a Total units or Quantity column)."
    )

# --- Comparing one shipment ------------------------------------------------


def _format_units(value: Number | None) -> str:
    if value is None:
        return "—"
    if isinstance(value, float) and not value.is_integer():
        return f"{value:g}"
    return f"{int(value):,}"


def _format_count(value: int | None) -> str:
    return "—" if value is None else f"{value:,}"


def _pick_description(upc: str, *sources: ParsedFile | None) -> str:
    for source in sources:
        if source is None:
            continue
        description = source.descriptions.get(upc)
        if description:
            return description
    return ""


def _resolve_pack_list_keys(carton: ParsedFile, pack_list: ParsedFile) -> dict[str, Number]:
    """Pack-list units keyed by UPC, folding in rows keyed by a seller SKU instead.

    Pack lists normally key each row as ``{UPC}-FNSKU``, but an export keyed by
    seller SKU still lines up with the request, which carries both.
    """
    sku_to_upc = {
        sku.strip().upper(): upc for upc, sku in carton.skus_by_upc.items() if sku.strip()
    }
    resolved: dict[str, Number] = {}
    for key, units in pack_list.units_by_upc.items():
        target = key
        if key not in carton.units_by_upc:
            mapped = sku_to_upc.get(key.strip().upper())
            if mapped:
                target = mapped
        resolved[target] = resolved.get(target, 0) + units
    return resolved


def _compare_units(
    shipment_id: str,
    carton: ParsedFile,
    pack_list: ParsedFile,
) -> list[UpcComparison]:
    pack_list_units = _resolve_pack_list_keys(carton, pack_list)
    comparisons: list[UpcComparison] = []
    for upc in sorted(set(carton.units_by_upc) | set(pack_list_units)):
        carton_units = carton.units_by_upc.get(upc, 0)
        listed_units = pack_list_units.get(upc, 0)
        delta = carton_units - listed_units
        if upc not in carton.units_by_upc:
            status = STATUS_ONLY_PACK_LIST
        elif upc not in pack_list_units:
            status = STATUS_ONLY_CARTON
        elif delta:
            status = STATUS_QTY
        else:
            status = STATUS_MATCH
        comparisons.append(
            UpcComparison(
                shipment_id=shipment_id,
                upc=upc,
                description=_pick_description(upc, pack_list, carton),
                carton_units=carton_units,
                pack_list_units=listed_units,
                delta=delta,
                status=status,
            )
        )
    return comparisons


def _build_checks(analysis: ShipmentAnalysis) -> list[CheckRow]:
    carton = analysis.carton
    pack_list = analysis.pack_list
    checks: list[CheckRow] = []

    carton_id = (carton.shipment_id if carton else "") or ""
    listed_id = (pack_list.shipment_id if pack_list else "") or ""
    if carton_id and listed_id:
        same = carton_id.strip().upper() == listed_id.strip().upper()
        checks.append(
            CheckRow(
                check="Shipment ID",
                carton_value=carton_id,
                pack_list_value=listed_id,
                result=STATUS_MATCH if same else "Mismatch",
                note="" if same else "The two files name different shipments.",
            )
        )
    else:
        checks.append(
            CheckRow(
                check="Shipment ID",
                carton_value=carton_id or "—",
                pack_list_value=listed_id or "—",
                result="Not compared",
                note="One file does not state a shipment id.",
            )
        )

    carton_upcs = len(carton.units_by_upc) if carton else None
    listed_upcs = len(pack_list.units_by_upc) if pack_list else None
    checks.append(
        CheckRow(
            check="Distinct UPCs",
            carton_value=_format_count(carton_upcs),
            pack_list_value=_format_count(listed_upcs),
            result=STATUS_MATCH if carton_upcs == listed_upcs else "Mismatch",
            note="" if carton_upcs == listed_upcs else "The two files list a different number of barcodes.",
        )
    )

    carton_units = carton.total_units if carton else None
    listed_units = pack_list.total_units if pack_list else None
    checks.append(
        CheckRow(
            check="Units (rows)",
            carton_value=_format_units(carton_units),
            pack_list_value=_format_units(listed_units),
            result=STATUS_MATCH if carton_units == listed_units else "Mismatch",
            note="" if carton_units == listed_units else "Totals taken by adding up every line.",
        )
    )

    matched = analysis.matched_upc_count
    total = analysis.upc_count
    checks.append(
        CheckRow(
            check="Units per UPC",
            carton_value=f"{matched:,} of {total:,} agree",
            pack_list_value=f"{matched:,} of {total:,} agree",
            result=STATUS_MATCH if matched == total else "Mismatch",
            note="" if matched == total else f"{total - matched:,} barcode(s) differ.",
        )
    )

    # A shipment-plan pack list has no box breakdown, so there is nothing to
    # compare the cartons against.
    carton_boxes = carton.box_count if carton else None
    listed_boxes = pack_list.box_count if pack_list else None
    if carton_boxes and listed_boxes:
        checks.append(
            CheckRow(
                check="Boxes",
                carton_value=_format_count(carton_boxes),
                pack_list_value=_format_count(listed_boxes),
                result=STATUS_MATCH if carton_boxes == listed_boxes else "Mismatch",
                note="Cartons in the request against box columns on the pack list.",
            )
        )
    else:
        checks.append(
            CheckRow(
                check="Boxes",
                carton_value=_format_count(carton_boxes) if carton_boxes else "—",
                pack_list_value=_format_count(listed_boxes) if listed_boxes else "—",
                result="Not compared",
                note="This pack list export carries no box breakdown.",
            )
        )

    # Each file also states its own totals, which need not agree with its rows.
    for source in (carton, pack_list):
        if source is None or source.declared_units is None:
            continue
        declared = source.declared_units
        actual = source.total_units
        if declared != actual:
            checks.append(
                CheckRow(
                    check=f"{source.kind_label} — stated unit total",
                    carton_value=_format_units(declared) if source.kind == KIND_CARTON else "—",
                    pack_list_value=_format_units(declared) if source.kind == KIND_PACK_LIST else "—",
                    result="Mismatch",
                    note=(
                        f"{source.filename} states {_format_units(declared)} units but its rows "
                        f"add up to {_format_units(actual)}."
                    ),
                )
            )

    return checks


def _build_discrepancies(analysis: ShipmentAnalysis) -> list[Discrepancy]:
    discrepancies: list[Discrepancy] = []
    shipment_id = analysis.shipment_id

    for check in analysis.checks:
        if check.check == "Shipment ID" and check.result == "Mismatch":
            discrepancies.append(
                Discrepancy(
                    shipment_id=shipment_id,
                    upc="",
                    description="",
                    issue="Shipment ID mismatch",
                    carton_units=None,
                    pack_list_units=None,
                    delta=None,
                    detail=(
                        f"The box contents request is for {check.carton_value} but the pack list "
                        f"is for {check.pack_list_value}."
                    ),
                )
            )
        elif check.check.endswith("stated unit total") and check.result == "Mismatch":
            discrepancies.append(
                Discrepancy(
                    shipment_id=shipment_id,
                    upc="",
                    description="",
                    issue="Stated total disagrees with rows",
                    carton_units=None,
                    pack_list_units=None,
                    delta=None,
                    detail=check.note,
                )
            )
    for row in analysis.comparisons:
        if row.status == STATUS_MATCH:
            continue
        if row.status == STATUS_ONLY_CARTON:
            issue = "Missing from pack list"
            detail = (
                f"{_format_units(row.carton_units)} unit(s) sit on the box contents request "
                "with no matching pack list row."
            )
        elif row.status == STATUS_ONLY_PACK_LIST:
            issue = "Missing from box contents request"
            detail = (
                f"{_format_units(row.pack_list_units)} unit(s) sit on the pack list with no "
                "matching box contents row."
            )
        else:
            issue = STATUS_QTY
            detail = (
                f"The box contents request has {_format_units(row.carton_units)} unit(s) and the "
                f"pack list has {_format_units(row.pack_list_units)}."
            )
        discrepancies.append(
            Discrepancy(
                shipment_id=shipment_id,
                upc=row.upc,
                description=row.description,
                issue=issue,
                carton_units=row.carton_units,
                pack_list_units=row.pack_list_units,
                delta=row.delta,
                detail=detail,
            )
        )

    if not analysis.paired:
        missing = "pack list" if analysis.carton is not None else "box contents request"
        present = analysis.carton or analysis.pack_list
        discrepancies.append(
            Discrepancy(
                shipment_id=shipment_id,
                upc="",
                description="",
                issue="Unpaired file",
                carton_units=None,
                pack_list_units=None,
                delta=None,
                detail=(
                    f"Only the {present.kind_label.lower()} was uploaded for {shipment_id or 'this shipment'} "
                    f"({present.filename}); the {missing} is needed to compare units."
                ),
            )
        )

    for extra in analysis.extra_files:
        discrepancies.append(
            Discrepancy(
                shipment_id=shipment_id,
                upc="",
                description="",
                issue="Duplicate file",
                carton_units=None,
                pack_list_units=None,
                delta=None,
                detail=(
                    f"{extra.filename} is a second {extra.kind_label.lower()} for {shipment_id}; "
                    "its units were not folded into the comparison."
                ),
            )
        )

    return discrepancies


def analyze_shipment(analysis: ShipmentAnalysis) -> ShipmentAnalysis:
    if analysis.paired:
        analysis.comparisons = _compare_units(
            analysis.shipment_id, analysis.carton, analysis.pack_list
        )
        analysis.checks = _build_checks(analysis)
    analysis.discrepancies = _build_discrepancies(analysis)
    return analysis


def group_by_shipment(files: Sequence[ParsedFile]) -> list[ShipmentAnalysis]:
    """One analysis per shipment id, keeping the first file of each kind."""
    order: list[str] = []
    grouped: dict[str, ShipmentAnalysis] = {}
    for parsed in files:
        key = (parsed.shipment_id or f"(unknown — {parsed.filename})").strip()
        if key not in grouped:
            grouped[key] = ShipmentAnalysis(shipment_id=parsed.shipment_id or key)
            order.append(key)
        analysis = grouped[key]
        if parsed.kind == KIND_CARTON and analysis.carton is None:
            analysis.carton = parsed
        elif parsed.kind == KIND_PACK_LIST and analysis.pack_list is None:
            analysis.pack_list = parsed
        else:
            analysis.extra_files.append(parsed)
    return [analyze_shipment(grouped[key]) for key in order]

# --- Reconciling differences across shipments ------------------------------


@dataclass
class _OpenDelta:
    """One side of an unexplained difference, consumed as counterparts are found."""

    shipment_id: str
    upc: str
    description: str
    side: str  # KIND_CARTON when the request has the extra units, else KIND_PACK_LIST
    original: Number
    remaining: Number

    @property
    def whole(self) -> bool:
        return self.remaining == self.original


def _normalized_description(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip().lower()


def _open_deltas(analyses: Sequence[ShipmentAnalysis]) -> list[_OpenDelta]:
    deltas: list[_OpenDelta] = []
    for analysis in analyses:
        for row in analysis.comparisons:
            if not row.delta:
                continue
            side = KIND_CARTON if row.delta > 0 else KIND_PACK_LIST
            amount = abs(row.delta)
            deltas.append(
                _OpenDelta(
                    shipment_id=analysis.shipment_id,
                    upc=row.upc,
                    description=row.description,
                    side=side,
                    original=amount,
                    remaining=amount,
                )
            )
    return deltas


def _finding_text(
    surplus: _OpenDelta,
    shortfall: _OpenDelta,
    units: Number,
    *,
    same_upc: bool,
) -> str:
    listed = _format_units(units)
    if same_upc:
        subject = f"{listed} unit(s) of {surplus.upc}"
    else:
        subject = f"{listed} unit(s) of {surplus.upc} and {shortfall.upc}"
    if surplus.shipment_id == shortfall.shipment_id:
        return (
            f"{subject} balance out inside {surplus.shipment_id}: the box contents request carries "
            f"{surplus.upc} while the pack list expects {shortfall.upc}, which reads like the wrong "
            "barcode was keyed for the same item."
        )
    return (
        f"{subject} sit on the box contents request for {surplus.shipment_id}, and the pack list "
        f"for {shortfall.shipment_id} is short the same amount — the units look like they were "
        f"keyed against {surplus.shipment_id} when they belong to {shortfall.shipment_id}."
    )


def _match_open_deltas(
    surpluses: Sequence[_OpenDelta],
    shortfalls: Sequence[_OpenDelta],
    *,
    same_upc: bool,
    cross_shipment: bool,
    confidence: str,
) -> list[CrossShipmentMatch]:
    """Pair leftover differences under one theory, exact amounts first."""
    matches: list[CrossShipmentMatch] = []
    for surplus in surpluses:
        if surplus.remaining <= 0:
            continue
        candidates = [
            item
            for item in shortfalls
            if item.remaining > 0
            and (item.upc == surplus.upc if same_upc else item.upc != surplus.upc)
            and (
                item.shipment_id != surplus.shipment_id
                if cross_shipment
                else item.shipment_id == surplus.shipment_id
            )
            and (
                same_upc
                or (
                    _normalized_description(item.description)
                    and _normalized_description(item.description)
                    == _normalized_description(surplus.description)
                )
            )
        ]
        # An exact counterpart explains the whole difference, so prefer it.
        candidates.sort(
            key=lambda item: (item.remaining != surplus.remaining, -item.remaining, item.shipment_id)
        )
        for candidate in candidates:
            if surplus.remaining <= 0:
                break
            units = min(surplus.remaining, candidate.remaining)
            if units <= 0:
                continue
            exact = units == surplus.original and units == candidate.original
            matches.append(
                CrossShipmentMatch(
                    upc=surplus.upc,
                    description=surplus.description or candidate.description,
                    units=units,
                    surplus_shipment=surplus.shipment_id,
                    shortfall_shipment=candidate.shipment_id,
                    confidence=f"{'Exact' if exact else 'Partial'} — {confidence}",
                    finding=_finding_text(surplus, candidate, units, same_upc=same_upc),
                )
            )
            surplus.remaining -= units
            candidate.remaining -= units
    return matches


def reconcile_across_shipments(
    analyses: Sequence[ShipmentAnalysis],
    files: Sequence[ParsedFile],
) -> tuple[list[CrossShipmentMatch], list[UnresolvedDelta]]:
    """Explain each leftover difference, trying looser theories before giving up."""
    deltas = _open_deltas(analyses)
    surpluses = [item for item in deltas if item.side == KIND_CARTON]
    shortfalls = [item for item in deltas if item.side == KIND_PACK_LIST]

    matches: list[CrossShipmentMatch] = []
    # 1. The same barcode over- and under-counted in two different shipments.
    matches += _match_open_deltas(
        surpluses, shortfalls, same_upc=True, cross_shipment=True, confidence="same UPC, other shipment"
    )
    # 2. The same item keyed under two barcodes inside one shipment.
    matches += _match_open_deltas(
        surpluses,
        shortfalls,
        same_upc=False,
        cross_shipment=False,
        confidence="same description, different UPC",
    )
    # 3. The same item keyed under two barcodes across shipments.
    matches += _match_open_deltas(
        surpluses,
        shortfalls,
        same_upc=False,
        cross_shipment=True,
        confidence="same description, different UPC, other shipment",
    )

    upc_shipments: dict[str, set[str]] = {}
    description_upcs: dict[str, set[str]] = {}
    for parsed in files:
        for upc in parsed.units_by_upc:
            upc_shipments.setdefault(upc, set()).add(parsed.shipment_id or parsed.filename)
        for upc, description in parsed.descriptions.items():
            key = _normalized_description(description)
            if key:
                description_upcs.setdefault(key, set()).add(upc)

    unresolved: list[UnresolvedDelta] = []
    for delta in deltas:
        if delta.remaining <= 0:
            continue
        elsewhere = sorted(upc_shipments.get(delta.upc, set()) - {delta.shipment_id})
        siblings = sorted(
            description_upcs.get(_normalized_description(delta.description), set()) - {delta.upc}
        )
        searched = (
            f"{len(analyses)} shipment(s); same UPC seen in "
            f"{len(elsewhere)} other shipment(s); {len(siblings)} other barcode(s) share the description"
        )
        if delta.side == KIND_CARTON:
            opening = (
                f"{_format_units(delta.remaining)} unit(s) of {delta.upc} are on the box contents "
                f"request for {delta.shipment_id} but on no pack list."
            )
        else:
            opening = (
                f"{_format_units(delta.remaining)} unit(s) of {delta.upc} are on the pack list for "
                f"{delta.shipment_id} but on no box contents request."
            )
        if elsewhere:
            closing = (
                f" The barcode also ships on {', '.join(elsewhere)}, where its counts already "
                "balance, so no counterpart was left to claim these units — check those shipments "
                "by hand."
            )
        elif siblings:
            closing = (
                f" No counterpart was found. The same description also uses {', '.join(siblings[:5])}"
                f"{' and others' if len(siblings) > 5 else ''}, which is worth checking for a keying slip."
            )
        else:
            closing = (
                " No counterpart was found in any uploaded file, so the units are unaccounted for "
                "and need a physical recount."
            )
        unresolved.append(
            UnresolvedDelta(
                shipment_id=delta.shipment_id,
                upc=delta.upc,
                description=delta.description,
                side=KIND_LABELS.get(delta.side, delta.side),
                units=delta.remaining,
                searched=searched,
                finding=opening + closing,
            )
        )

    return matches, unresolved

# --- Writing the analysis workbook -----------------------------------------


def _write_cell(
    sheet: Worksheet,
    row: int,
    column: int,
    value: object,
    *,
    bold: bool = False,
    fill: PatternFill | None = None,
    wrap: bool = False,
) -> None:
    cell = sheet.cell(row=row, column=column)
    cell.font = _CALIBRI_BOLD if bold else _CALIBRI
    cell.alignment = _WRAP if wrap else _LEFT
    if fill is not None:
        cell.fill = fill
    if value is None or value == "":
        cell.value = None
    elif isinstance(value, bool):
        cell.value = str(value)
    elif isinstance(value, (int, float)):
        cell.number_format = "General"
        cell.value = int(value) if float(value).is_integer() else float(value)
    else:
        cell.number_format = "General"
        cell.value = str(value)
        cell.data_type = "s"


def _write_header(sheet: Worksheet, row: int, headers: Sequence[str]) -> None:
    for column, label in enumerate(headers, start=1):
        _write_cell(sheet, row, column, label, bold=True, fill=_HEADER_FILL)
    sheet.freeze_panes = sheet.cell(row=row + 1, column=1)


def _set_widths(sheet: Worksheet, widths: Sequence[float]) -> None:
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width


def _result_fill(result: str) -> PatternFill | None:
    if result == STATUS_MATCH:
        return _GREEN_FILL
    if result == "Mismatch":
        return _RED_FILL
    return _AMBER_FILL


def _status_fill(status: str) -> PatternFill | None:
    return _GREEN_FILL if status == STATUS_MATCH else _RED_FILL


def _write_summary(
    sheet: Worksheet,
    analyses: Sequence[ShipmentAnalysis],
    *,
    title: str,
    matches: Sequence[CrossShipmentMatch] = (),
    unresolved: Sequence[UnresolvedDelta] = (),
) -> None:
    sheet.sheet_view.showGridLines = False
    _write_cell(sheet, 1, 1, title)
    sheet.cell(row=1, column=1).font = _TITLE_FONT

    discrepancy_count = sum(len(item.discrepancies) for item in analyses)
    total_units = sum(item.pack_list_units or item.carton_units for item in analyses)
    unpaired = [item for item in analyses if not item.paired]
    if not any(item.paired for item in analyses):
        # Every shipment is missing a side, so nothing was actually compared.
        missing = "box contents request" if all(item.carton is None for item in unpaired) else "counterpart file"
        verdict = (
            f"Nothing could be compared: all {len(analyses):,} shipment(s) are missing their "
            f"{missing}. Upload both files per shipment."
        )
        fill = _AMBER_FILL
    elif discrepancy_count == 0:
        verdict = "No discrepancies found in the shipment IDs, UPCs or units."
        fill = _GREEN_FILL
    else:
        verdict = f"{discrepancy_count:,} discrepancy row(s) found — see the {DISCREPANCIES_SHEET} tab."
        fill = _RED_FILL
    _write_cell(sheet, 2, 1, verdict, bold=True, fill=fill)

    row = 4
    _write_cell(sheet, row, 1, "Shipments analysed", bold=True)
    _write_cell(sheet, row, 2, len(analyses))
    row += 1
    _write_cell(sheet, row, 1, "Files read", bold=True)
    _write_cell(sheet, row, 2, sum(len(item.files) for item in analyses))
    row += 1
    _write_cell(sheet, row, 1, "Units counted", bold=True)
    _write_cell(sheet, row, 2, total_units)
    if matches or unresolved:
        row += 1
        _write_cell(sheet, row, 1, "Differences explained by another shipment", bold=True)
        _write_cell(sheet, row, 2, len(matches))
        row += 1
        _write_cell(sheet, row, 1, "Differences left unexplained", bold=True)
        _write_cell(sheet, row, 2, len(unresolved))

    row += 2
    for analysis in analyses:
        _write_cell(sheet, row, 1, analysis.shipment_id or "(no shipment id)", bold=True)
        row += 1
        for parsed in analysis.files:
            _write_cell(sheet, row, 1, f"{parsed.kind_label}:")
            _write_cell(sheet, row, 2, parsed.filename)
            row += 1
        if analysis.checks:
            _write_header(sheet, row, ("Check", "Box contents request", "Pack list", "Result", "Notes"))
            row += 1
            for check in analysis.checks:
                _write_cell(sheet, row, 1, check.check)
                _write_cell(sheet, row, 2, check.carton_value)
                _write_cell(sheet, row, 3, check.pack_list_value)
                _write_cell(sheet, row, 4, check.result, fill=_result_fill(check.result))
                _write_cell(sheet, row, 5, check.note, wrap=True)
                row += 1
        else:
            note = next(
                (item.detail for item in analysis.discrepancies if item.issue == "Unpaired file"),
                "Nothing to compare for this shipment.",
            )
            _write_cell(sheet, row, 1, note, fill=_AMBER_FILL, wrap=True)
            row += 1
        row += 1

    sheet.freeze_panes = "A4"
    _set_widths(sheet, (34, 30, 30, 16, 72))


def _write_comparison(
    sheet: Worksheet,
    analyses: Sequence[ShipmentAnalysis],
    *,
    include_shipment: bool,
) -> None:
    sheet.sheet_view.showGridLines = False
    headers = ["UPC", "Description", "Request units", "Pack list units", "Difference", "Status"]
    if include_shipment:
        headers.insert(0, "Shipment ID")
    _write_header(sheet, 1, headers)

    row = 2
    for analysis in analyses:
        for item in analysis.comparisons:
            column = 1
            if include_shipment:
                _write_cell(sheet, row, column, item.shipment_id)
                column += 1
            _write_cell(sheet, row, column, item.upc)
            _write_cell(sheet, row, column + 1, item.description)
            _write_cell(sheet, row, column + 2, item.carton_units)
            _write_cell(sheet, row, column + 3, item.pack_list_units)
            _write_cell(sheet, row, column + 4, item.delta)
            _write_cell(sheet, row, column + 5, item.status, fill=_status_fill(item.status))
            row += 1

    widths = [16, 52, 14, 16, 12, 30]
    if include_shipment:
        widths.insert(0, 16)
    _set_widths(sheet, widths)


def _write_discrepancies(sheet: Worksheet, analyses: Sequence[ShipmentAnalysis]) -> None:
    sheet.sheet_view.showGridLines = False
    _write_header(
        sheet,
        1,
        (
            "Shipment ID",
            "Issue",
            "UPC",
            "Description",
            "Request units",
            "Pack list units",
            "Difference",
            "What this means",
        ),
    )
    row = 2
    for analysis in analyses:
        for item in analysis.discrepancies:
            _write_cell(sheet, row, 1, item.shipment_id)
            _write_cell(sheet, row, 2, item.issue, fill=_RED_FILL)
            _write_cell(sheet, row, 3, item.upc)
            _write_cell(sheet, row, 4, item.description)
            _write_cell(sheet, row, 5, item.carton_units if item.carton_units is not None else "—")
            _write_cell(sheet, row, 6, item.pack_list_units if item.pack_list_units is not None else "—")
            _write_cell(sheet, row, 7, item.delta if item.delta is not None else "—")
            _write_cell(sheet, row, 8, item.detail, wrap=True)
            row += 1
    _set_widths(sheet, (16, 34, 16, 46, 14, 16, 12, 96))


def _write_cross_matches(sheet: Worksheet, matches: Sequence[CrossShipmentMatch]) -> None:
    sheet.sheet_view.showGridLines = False
    _write_header(
        sheet,
        1,
        (
            "UPC",
            "Description",
            "Units",
            "Counted on",
            "Expected on",
            "Confidence",
            "Finding",
        ),
    )
    for row, item in enumerate(matches, start=2):
        _write_cell(sheet, row, 1, item.upc)
        _write_cell(sheet, row, 2, item.description)
        _write_cell(sheet, row, 3, item.units)
        _write_cell(sheet, row, 4, item.surplus_shipment)
        _write_cell(sheet, row, 5, item.shortfall_shipment)
        _write_cell(
            sheet,
            row,
            6,
            item.confidence,
            fill=_GREEN_FILL if item.confidence.startswith("Exact") else _AMBER_FILL,
        )
        _write_cell(sheet, row, 7, item.finding, wrap=True)
    _set_widths(sheet, (16, 46, 10, 18, 18, 42, 104))


def _write_unresolved(sheet: Worksheet, unresolved: Sequence[UnresolvedDelta]) -> None:
    sheet.sheet_view.showGridLines = False
    _write_header(
        sheet,
        1,
        ("Shipment ID", "UPC", "Description", "Units", "Sits on", "Searched", "Finding"),
    )
    for row, item in enumerate(unresolved, start=2):
        _write_cell(sheet, row, 1, item.shipment_id)
        _write_cell(sheet, row, 2, item.upc)
        _write_cell(sheet, row, 3, item.description)
        _write_cell(sheet, row, 4, item.units, fill=_RED_FILL)
        _write_cell(sheet, row, 5, item.side)
        _write_cell(sheet, row, 6, item.searched, wrap=True)
        _write_cell(sheet, row, 7, item.finding, wrap=True)
    _set_widths(sheet, (16, 16, 46, 10, 24, 54, 104))


def _write_files(sheet: Worksheet, files: Sequence[ParsedFile]) -> None:
    sheet.sheet_view.showGridLines = False
    _write_header(
        sheet,
        1,
        (
            "Filename",
            "Read as",
            "Shipment ID",
            "Lines",
            "UPCs",
            "Units",
            "Boxes",
            "Stated units",
            "Notes",
        ),
    )
    for row, parsed in enumerate(files, start=2):
        _write_cell(sheet, row, 1, parsed.filename)
        _write_cell(sheet, row, 2, parsed.kind_label)
        _write_cell(sheet, row, 3, parsed.shipment_id or "(none)")
        _write_cell(sheet, row, 4, parsed.line_count)
        _write_cell(sheet, row, 5, len(parsed.units_by_upc))
        _write_cell(sheet, row, 6, parsed.total_units)
        _write_cell(sheet, row, 7, parsed.box_count)
        _write_cell(sheet, row, 8, parsed.declared_units if parsed.declared_units is not None else "—")
        _write_cell(sheet, row, 9, "; ".join(parsed.notes), wrap=True)
    _set_widths(sheet, (44, 24, 16, 10, 10, 10, 10, 14, 52))


def build_workbook(
    analyses: Sequence[ShipmentAnalysis],
    files: Sequence[ParsedFile],
    *,
    title: str,
    advanced: bool,
    matches: Sequence[CrossShipmentMatch] = (),
    unresolved: Sequence[UnresolvedDelta] = (),
) -> bytes:
    workbook = Workbook()
    summary = workbook.active
    summary.title = SUMMARY_SHEET
    _write_summary(summary, analyses, title=title, matches=matches, unresolved=unresolved)

    comparison = workbook.create_sheet(COMPARISON_SHEET)
    _write_comparison(comparison, analyses, include_shipment=advanced)

    if any(item.discrepancies for item in analyses):
        _write_discrepancies(workbook.create_sheet(DISCREPANCIES_SHEET), analyses)
    if matches:
        _write_cross_matches(workbook.create_sheet(CROSS_SHEET), matches)
    if unresolved:
        _write_unresolved(workbook.create_sheet(UNRESOLVED_SHEET), unresolved)
    if advanced:
        _write_files(workbook.create_sheet(FILES_SHEET), files)

    for sheet in workbook.worksheets:
        sheet.sheet_view.tabSelected = sheet is summary
    workbook.active = 0
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()

# --- Public entry points ---------------------------------------------------


def _sanitize_filename(name: str) -> str:
    cleaned = re.sub(r"[<>:\"/\\|?*]", "", (name or "").replace("\r", "").replace("\n", "")).strip()
    return cleaned or BASIC_FILENAME


def _basic_output_filename(shipment_id: str) -> str:
    stem = _sanitize_filename(shipment_id)
    if not shipment_id:
        return BASIC_FILENAME
    return f"{stem} Shipment Analysis.xlsx"


def _read_uploads(uploads: Sequence[tuple[str, bytes]]) -> list[ParsedFile]:
    if len(uploads) > MAX_FILES:
        raise SmwShipmentAnalyzerError(f"Upload at most {MAX_FILES} files at a time.")
    if sum(len(content) for _, content in uploads) > MAX_TOTAL_BYTES:
        raise SmwShipmentAnalyzerError("Those files add up to more than 80 MB.")
    parsed: list[ParsedFile] = []
    for filename, content in uploads:
        parsed.append(parse_upload(Path(filename or "upload").name, content))
    return parsed


def _result_totals(
    analyses: Sequence[ShipmentAnalysis],
) -> tuple[int, Number]:
    upcs: set[tuple[str, str]] = set()
    units: Number = 0
    for analysis in analyses:
        for row in analysis.comparisons:
            upcs.add((analysis.shipment_id, row.upc))
        units += analysis.pack_list_units or analysis.carton_units
    return len(upcs), units


def analyze_basic(uploads: Sequence[tuple[str, bytes]]) -> AnalyzerResult:
    """One box contents request against one pack list."""
    if len(uploads) != 2:
        raise SmwShipmentAnalyzerError(
            "Basic analysis takes exactly two files: the box contents request and the pack list."
        )
    files = _read_uploads(uploads)
    kinds = {parsed.kind for parsed in files}
    if kinds != {KIND_CARTON, KIND_PACK_LIST}:
        only = KIND_LABELS[files[0].kind].lower()
        raise SmwShipmentAnalyzerError(
            f"Both files were read as a {only}. Basic analysis needs one box contents request "
            "and one pack list."
        )

    carton = next(parsed for parsed in files if parsed.kind == KIND_CARTON)
    pack_list = next(parsed for parsed in files if parsed.kind == KIND_PACK_LIST)
    analysis = analyze_shipment(
        ShipmentAnalysis(
            shipment_id=carton.shipment_id or pack_list.shipment_id,
            carton=carton,
            pack_list=pack_list,
        )
    )
    analyses = [analysis]
    upc_count, total_units = _result_totals(analyses)
    file_bytes = build_workbook(
        analyses,
        files,
        title=f"SMW Shipment Analyzer — {analysis.shipment_id or 'basic analysis'}",
        advanced=False,
    )
    return AnalyzerResult(
        file_bytes=file_bytes,
        filename=_basic_output_filename(analysis.shipment_id),
        shipment_id=analysis.shipment_id,
        shipment_count=1,
        file_count=len(files),
        upc_count=upc_count,
        total_units=total_units,
        discrepancy_count=len(analysis.discrepancies),
        resolved_count=0,
        unresolved_count=0,
    )


def analyze_advanced(uploads: Sequence[tuple[str, bytes]]) -> AnalyzerResult:
    """Many files at once, with leftover differences chased across shipments."""
    if len(uploads) < 2:
        raise SmwShipmentAnalyzerError("Advanced analysis needs at least two files.")
    files = _read_uploads(uploads)
    analyses = group_by_shipment(files)
    matches, unresolved = reconcile_across_shipments(analyses, files)
    upc_count, total_units = _result_totals(analyses)
    shipment_ids = [item.shipment_id for item in analyses if item.shipment_id]
    file_bytes = build_workbook(
        analyses,
        files,
        title=(
            "SMW Shipment Analyzer — advanced analysis of "
            f"{len(analyses)} shipment(s) across {len(files)} file(s)"
        ),
        advanced=True,
        matches=matches,
        unresolved=unresolved,
    )
    return AnalyzerResult(
        file_bytes=file_bytes,
        filename=ADVANCED_FILENAME,
        shipment_id=shipment_ids[0] if len(shipment_ids) == 1 else "",
        shipment_count=len(analyses),
        file_count=len(files),
        upc_count=upc_count,
        total_units=total_units,
        discrepancy_count=sum(len(item.discrepancies) for item in analyses),
        resolved_count=len(matches),
        unresolved_count=len(unresolved),
    )
