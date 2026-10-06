"""FBA Box Contents DNK Tool — DNK Carton Contents List (CCL) → Box Contents workbook.

Input (DNK ``… CCL.xlsx``):
  - Sheet ``Contents``: title ``Carton Contents``, shipment id, header row with
    Carton / UPC / Quantity, carton markers like ``1 of 2``, item lines, and
    ``Carton Total`` rows to skip
  - Sheet ``Dimensions``: ``Carton Dimensions`` with Order / Carton / Weight /
    Length / Width / Height

Output (named ``{shipment_id} Box Contents.xlsx``):
  - ``Contents``: Box Number (number), UPC (text), Quantity (number), plus a
    Sum-of-Quantity pivot at column G (no Total footer)
  - ``Dimensions``: same layout as the input Dimensions sheet (numbers kept as
    ints or floats)
"""
from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field
from typing import Sequence

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

_MAX_UPLOAD_BYTES = 15 * 1024 * 1024
_CALIBRI = Font(name="Calibri", size=11)
_CALIBRI_BOLD = Font(name="Calibri", size=11, bold=True)
_CENTER = Alignment(horizontal="center")
_LEFT = Alignment(horizontal="left")

CONTENTS_SHEET = "Contents"
DIMENSIONS_SHEET = "Dimensions"
DEFAULT_OUTPUT_FILENAME = "Box Contents.xlsx"
PIVOT_START_COL = 7  # column G
_LINE_START_ROW = 2
_CARTON_OF_RE = re.compile(r"^(\d+)\s+of\s+\d+$", re.IGNORECASE)
_QTY_NUMBER_FORMAT = r'#,##0;(#,##0)'
_WEIGHT_NUMBER_FORMAT = r'#,##0.0;(#,##0.0)'
_DIM_INT_NUMBER_FORMAT = r'#,##0;(#,##0)'


class FbaBoxContentsDnkError(ValueError):
    """Raised for user-correctable input problems."""


@dataclass(frozen=True)
class ContentRow:
    upc: str
    box_number: int
    qty: int | float


@dataclass
class CartonDimension:
    box_number: int
    weight: int | float | None = None
    length: int | float | None = None
    width: int | float | None = None
    height: int | float | None = None


@dataclass
class ParsedCcl:
    shipment_id: str
    rows: tuple[ContentRow, ...]
    dimensions: tuple[CartonDimension, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class FbaBoxContentsDnkResult:
    file_bytes: bytes
    filename: str
    row_count: int
    box_count: int
    upc_count: int
    total_qty: int | float
    shipment_id: str


def sanitize_download_filename(shipment_id: str | None) -> str:
    """Return ``{shipment_id} Box Contents.xlsx``."""
    cleaned = (shipment_id or "").replace('"', "").replace("\r", "").replace("\n", "").strip()
    cleaned = re.sub(r'[<>:"/\\|?*]', "", cleaned).strip(" .")
    if not cleaned:
        return DEFAULT_OUTPUT_FILENAME
    return f"{cleaned} Box Contents.xlsx"


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


def _as_excel_number(value: object) -> int | float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        if value.is_integer() and abs(value) < 2**53:
            return int(value)
        return float(value)
    text = _cell_text(value).replace(",", "")
    if not text:
        return None
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if re.fullmatch(r"-?\d+\.\d+", text):
        number = float(text)
        if number.is_integer() and abs(number) < 2**53:
            return int(number)
        return number
    return None


def _as_qty(value: object) -> int | float | None:
    return _as_excel_number(value)


def _as_upc_string(value: object) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, int):
        if value < 0:
            return ""
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value) or value < 0:
            return ""
        if abs(value) < 2**53:
            return str(int(value)) if value.is_integer() else str(int(round(value)))
        return format(value, ".0f")
    text = str(value).strip()
    if not text:
        return ""
    if re.fullmatch(r"\d+\.0+", text):
        return text.split(".", 1)[0]
    return text


def _looks_like_upc(value: object) -> bool:
    text = _as_upc_string(value).replace(" ", "")
    return bool(text) and text.isdigit() and 8 <= len(text) <= 14


def _parse_carton_marker(value: object) -> int | None:
    """Parse markers like ``1 of 2`` into the carton number."""
    text = _cell_text(value)
    if not text:
        return None
    match = _CARTON_OF_RE.match(text)
    if not match:
        return None
    return int(match.group(1))


def _sheet_rows(workbook, sheet_name: str) -> list[tuple[object, ...]]:
    if sheet_name not in workbook.sheetnames:
        raise FbaBoxContentsDnkError(
            f'The workbook is missing a "{sheet_name}" sheet.'
        )
    sheet = workbook[sheet_name]
    return [tuple(row) for row in sheet.iter_rows(values_only=True)]


def _load_workbook_bytes(content: bytes):
    if not content:
        raise FbaBoxContentsDnkError("Uploaded file is empty.")
    if len(content) > _MAX_UPLOAD_BYTES:
        raise FbaBoxContentsDnkError("File is too large (max 15 MB).")

    stripped = content.lstrip()
    if stripped.lower().startswith(b"<html") or stripped.lower().startswith(b"<!doctype"):
        raise FbaBoxContentsDnkError(
            "This looks like an HTML file saved as Excel. Export the CCL as .xls or .xlsx."
        )

    if content.startswith(b"PK"):
        try:
            return load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        except Exception as exc:
            raise FbaBoxContentsDnkError(
                "Could not read the Excel file. Upload a valid .xlsx workbook."
            ) from exc

    try:
        import xlrd
    except ImportError as exc:
        raise FbaBoxContentsDnkError(
            "Reading .xls files requires xlrd. Upload .xlsx or install xlrd on the server."
        ) from exc

    try:
        book = xlrd.open_workbook(file_contents=content)
    except Exception as exc:
        raise FbaBoxContentsDnkError(
            "Could not read the Excel file. Upload a valid DNK CCL .xls or .xlsx."
        ) from exc

    # Adapt xlrd into an openpyxl-like shim for sheetnames + iter_rows.
    class _XlrdSheet:
        def __init__(self, sheet):
            self._sheet = sheet

        def iter_rows(self, values_only: bool = True):
            for row_index in range(self._sheet.nrows):
                values: list[object] = []
                for col_index in range(self._sheet.ncols):
                    cell = self._sheet.cell(row_index, col_index)
                    if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                        values.append(None)
                    elif cell.ctype == xlrd.XL_CELL_BOOLEAN:
                        values.append(bool(cell.value))
                    else:
                        values.append(cell.value)
                yield tuple(values)

    class _XlrdBook:
        def __init__(self, book):
            self.sheetnames = book.sheet_names()
            self._book = book

        def __getitem__(self, name: str):
            return _XlrdSheet(self._book.sheet_by_name(name))

        def close(self) -> None:
            return None

    return _XlrdBook(book)


def _find_header_map(rows: Sequence[Sequence[object]]) -> tuple[int, dict[str, int]]:
    wanted = {
        "carton": "carton",
        "upc": "upc",
        "quantity": "qty",
        "qty": "qty",
        "weight": "weight",
        "length": "length",
        "width": "width",
        "height": "height",
    }
    for index, row in enumerate(rows):
        mapping: dict[str, int] = {}
        for col, value in enumerate(row):
            key = wanted.get(_normalize_label(value))
            if key and key not in mapping:
                mapping[key] = col
        if "upc" in mapping and "qty" in mapping:
            return index, mapping
    raise FbaBoxContentsDnkError(
        'Could not find a Contents header row with "UPC" and "Quantity" columns.'
    )


def _cell_at(row: Sequence[object], index: int) -> object:
    if index < 0 or index >= len(row):
        return None
    return row[index]


def _find_shipment_id(rows: Sequence[Sequence[object]], header_index: int) -> str:
    for row in rows[:header_index]:
        for value in row:
            text = _cell_text(value)
            if text.upper().startswith("FBA"):
                return text
            if text and _normalize_label(text) not in {"carton contents", ""}:
                # Prefer an FBA id; fall through if none found.
                pass
    for row in rows[:header_index]:
        for value in row:
            text = _cell_text(value)
            if text and _normalize_label(text) not in {"carton contents"}:
                return text
    return ""


def parse_contents_sheet(rows: Sequence[Sequence[object]]) -> tuple[str, tuple[ContentRow, ...], dict[int, CartonDimension]]:
    if not any(any(cell is not None and cell != "" for cell in row) for row in rows):
        raise FbaBoxContentsDnkError("The Contents sheet has no rows.")

    header_index, cols = _find_header_map(rows)
    shipment_id = _find_shipment_id(rows, header_index)
    upc_col = cols["upc"]
    qty_col = cols["qty"]
    carton_col = cols.get("carton", 1)
    weight_col = cols.get("weight", -1)
    length_col = cols.get("length", -1)
    width_col = cols.get("width", -1)
    height_col = cols.get("height", -1)

    current_box: int | None = None
    content_rows: list[ContentRow] = []
    totals: dict[int, CartonDimension] = {}

    for row in rows[header_index + 1 :]:
        carton_marker = _parse_carton_marker(_cell_at(row, carton_col))
        if carton_marker is not None and carton_marker >= 1:
            # Carton start rows are otherwise empty of UPC/item data.
            upc_probe = _as_upc_string(_cell_at(row, upc_col))
            if not upc_probe:
                current_box = carton_marker
                continue

        label_cells = {_normalize_label(value) for value in row if _cell_text(value)}
        if "carton total" in label_cells:
            if current_box is None:
                continue
            totals[current_box] = CartonDimension(
                box_number=current_box,
                weight=_as_excel_number(_cell_at(row, weight_col)) if weight_col >= 0 else None,
                length=_as_excel_number(_cell_at(row, length_col)) if length_col >= 0 else None,
                width=_as_excel_number(_cell_at(row, width_col)) if width_col >= 0 else None,
                height=_as_excel_number(_cell_at(row, height_col)) if height_col >= 0 else None,
            )
            continue

        if current_box is None:
            continue

        upc_raw = _cell_at(row, upc_col)
        if not _looks_like_upc(upc_raw):
            continue
        upc = _as_upc_string(upc_raw)
        qty = _as_qty(_cell_at(row, qty_col))
        if qty is None:
            raise FbaBoxContentsDnkError(
                f"Item {upc} in carton {current_box} is missing a numeric Quantity."
            )
        if qty < 0:
            raise FbaBoxContentsDnkError(
                f"Item {upc} in carton {current_box} has a negative Quantity."
            )
        content_rows.append(ContentRow(upc=upc, box_number=current_box, qty=qty))

    if current_box is None:
        raise FbaBoxContentsDnkError(
            'No carton markers like "1 of 2" were found on the Contents sheet.'
        )
    if not content_rows:
        raise FbaBoxContentsDnkError("No item rows with a UPC were found under any carton.")

    return shipment_id, tuple(content_rows), totals


def parse_dimensions_sheet(
    rows: Sequence[Sequence[object]],
    *,
    shipment_id: str,
) -> tuple[str, tuple[CartonDimension, ...]]:
    if not rows:
        return shipment_id, ()

    header_index = None
    cols: dict[str, int] = {}
    wanted = {
        "order": "order",
        "carton": "carton",
        "weight": "weight",
        "length": "length",
        "width": "width",
        "height": "height",
    }
    for index, row in enumerate(rows):
        mapping: dict[str, int] = {}
        for col, value in enumerate(row):
            key = wanted.get(_normalize_label(value))
            if key and key not in mapping:
                mapping[key] = col
        if "carton" in mapping and "weight" in mapping:
            header_index = index
            cols = mapping
            break

    if header_index is None:
        return shipment_id, ()

    found_shipment = shipment_id
    dimensions: list[CartonDimension] = []
    for row in rows[header_index + 1 :]:
        order_text = _cell_text(_cell_at(row, cols.get("order", 0)))
        if order_text and not found_shipment:
            found_shipment = order_text
        elif order_text and order_text.upper().startswith("FBA"):
            found_shipment = order_text

        box_number = _as_excel_number(_cell_at(row, cols["carton"]))
        if not isinstance(box_number, int) or box_number < 1:
            continue
        dimensions.append(
            CartonDimension(
                box_number=box_number,
                weight=_as_excel_number(_cell_at(row, cols["weight"])) if "weight" in cols else None,
                length=_as_excel_number(_cell_at(row, cols["length"])) if "length" in cols else None,
                width=_as_excel_number(_cell_at(row, cols["width"])) if "width" in cols else None,
                height=_as_excel_number(_cell_at(row, cols["height"])) if "height" in cols else None,
            )
        )

    return found_shipment, tuple(dimensions)


def parse_ccl(content: bytes) -> ParsedCcl:
    workbook = _load_workbook_bytes(content)
    try:
        contents_rows = _sheet_rows(workbook, CONTENTS_SHEET)
        shipment_id, rows, totals_from_contents = parse_contents_sheet(contents_rows)

        dimensions: tuple[CartonDimension, ...] = ()
        if DIMENSIONS_SHEET in workbook.sheetnames:
            dim_rows = _sheet_rows(workbook, DIMENSIONS_SHEET)
            shipment_id, dimensions = parse_dimensions_sheet(
                dim_rows, shipment_id=shipment_id
            )

        if not dimensions and totals_from_contents:
            dimensions = tuple(
                totals_from_contents[box]
                for box in sorted(totals_from_contents)
            )

        return ParsedCcl(shipment_id=shipment_id, rows=rows, dimensions=dimensions)
    finally:
        close = getattr(workbook, "close", None)
        if callable(close):
            close()


def _set_text_cell(
    sheet: Worksheet,
    row: int,
    column: int,
    value: str,
    *,
    bold: bool = False,
    align_left: bool = False,
    align_center: bool = False,
) -> None:
    cell = sheet.cell(row=row, column=column)
    cell.number_format = "General"
    cell.font = _CALIBRI_BOLD if bold else _CALIBRI
    if align_center:
        cell.alignment = _CENTER
    elif align_left:
        cell.alignment = _LEFT
    cell.value = value
    cell.data_type = "s"


def _set_number_cell(
    sheet: Worksheet,
    row: int,
    column: int,
    value: int | float | None,
    *,
    bold: bool = False,
    align_center: bool = False,
    number_format: str = "General",
) -> None:
    cell = sheet.cell(row=row, column=column)
    cell.number_format = number_format
    cell.font = _CALIBRI_BOLD if bold else _CALIBRI
    if align_center:
        cell.alignment = _CENTER
    if value is None or isinstance(value, bool):
        cell.value = None
        return
    if isinstance(value, int):
        cell.value = int(value)
    elif isinstance(value, float):
        if value.is_integer() and abs(value) < 2**53:
            cell.value = int(value)
        else:
            cell.value = float(value)
    else:
        raise TypeError(f"Expected a number, got {type(value).__name__}")


def _write_contents(sheet: Worksheet, rows: Sequence[ContentRow]) -> int | float:
    sheet.sheet_view.showGridLines = True
    _set_text_cell(sheet, 1, 1, "Box Number", bold=True, align_center=True)
    _set_text_cell(sheet, 1, 2, "UPC", bold=True, align_center=True)
    _set_text_cell(sheet, 1, 3, "Quantity", bold=True, align_center=True)

    total_qty: int | float = 0
    for offset, row in enumerate(rows):
        excel_row = _LINE_START_ROW + offset
        _set_number_cell(sheet, excel_row, 1, row.box_number, align_center=True)
        _set_text_cell(sheet, excel_row, 2, row.upc, align_center=True)
        _set_number_cell(
            sheet,
            excel_row,
            3,
            row.qty,
            align_center=True,
            number_format=_QTY_NUMBER_FORMAT,
        )
        total_qty += row.qty

    boxes = sorted({row.box_number for row in rows})
    counts: dict[tuple[str, int], int | float] = {}
    upcs: set[str] = set()
    for row in rows:
        upcs.add(row.upc)
        key = (row.upc, row.box_number)
        counts[key] = counts.get(key, 0) + row.qty

    sorted_upcs = sorted(upcs)
    grand_total_col = PIVOT_START_COL + 1 + len(boxes)

    _set_text_cell(sheet, 1, PIVOT_START_COL, "Sum of Quantity")
    _set_text_cell(sheet, 1, PIVOT_START_COL + 1, "Column Labels")
    _set_text_cell(sheet, 2, PIVOT_START_COL, "Row Labels")
    for offset, box in enumerate(boxes):
        _set_number_cell(sheet, 2, PIVOT_START_COL + 1 + offset, box)
    _set_text_cell(sheet, 2, grand_total_col, "Grand Total")

    column_totals: list[int | float] = [0] * len(boxes)
    current_row = 3
    for upc in sorted_upcs:
        _set_text_cell(sheet, current_row, PIVOT_START_COL, upc, align_left=True)
        row_total: int | float = 0
        for offset, box in enumerate(boxes):
            qty = counts.get((upc, box), 0)
            if qty:
                _set_number_cell(
                    sheet,
                    current_row,
                    PIVOT_START_COL + 1 + offset,
                    qty,
                    number_format=_QTY_NUMBER_FORMAT,
                )
                row_total += qty
                column_totals[offset] += qty
        _set_number_cell(
            sheet,
            current_row,
            grand_total_col,
            row_total,
            number_format=_QTY_NUMBER_FORMAT,
        )
        current_row += 1

    _set_text_cell(sheet, current_row, PIVOT_START_COL, "Grand Total", align_left=True)
    for offset, qty in enumerate(column_totals):
        _set_number_cell(
            sheet,
            current_row,
            PIVOT_START_COL + 1 + offset,
            qty,
            number_format=_QTY_NUMBER_FORMAT,
        )
    _set_number_cell(
        sheet,
        current_row,
        grand_total_col,
        total_qty,
        number_format=_QTY_NUMBER_FORMAT,
    )

    sheet.column_dimensions["A"].width = 11.44
    sheet.column_dimensions["B"].width = 13.66
    sheet.column_dimensions["C"].width = 8.33
    sheet.column_dimensions[get_column_letter(PIVOT_START_COL)].width = 14.89
    sheet.column_dimensions[get_column_letter(PIVOT_START_COL + 1)].width = 15.55
    for column in range(PIVOT_START_COL + 2, grand_total_col):
        sheet.column_dimensions[get_column_letter(column)].width = 3.0
    sheet.column_dimensions[get_column_letter(grand_total_col)].width = 10.78
    return total_qty


def _number_format_for_dim(value: int | float | None, *, weight: bool = False) -> str:
    if value is None:
        return "General"
    if weight or isinstance(value, float):
        return _WEIGHT_NUMBER_FORMAT
    return _DIM_INT_NUMBER_FORMAT


def _write_dimensions(
    sheet: Worksheet,
    shipment_id: str,
    dimensions: Sequence[CartonDimension],
) -> None:
    sheet.sheet_view.showGridLines = True
    sheet.merge_cells("A1:G1")
    _set_text_cell(sheet, 1, 1, "Carton Dimensions", bold=True)
    sheet["A1"].font = Font(name="Arial", size=12, bold=True)

    headers = ("Order", "Carton", "Weight", "Length", "Width", "Height")
    for column, header in enumerate(headers, start=1):
        _set_text_cell(sheet, 2, column, header, bold=True)

    if not dimensions:
        sheet.column_dimensions["A"].width = 20.55
        sheet.column_dimensions["B"].width = 8.33
        return

    first_row = 3
    last_row = 2 + len(dimensions)
    if last_row > first_row:
        sheet.merge_cells(start_row=first_row, start_column=1, end_row=last_row, end_column=1)

    for offset, dim in enumerate(dimensions):
        row = first_row + offset
        if offset == 0:
            _set_text_cell(sheet, row, 1, shipment_id, align_left=True)
        _set_number_cell(sheet, row, 2, dim.box_number)
        _set_number_cell(
            sheet,
            row,
            3,
            dim.weight,
            number_format=_number_format_for_dim(dim.weight, weight=True),
        )
        _set_number_cell(
            sheet,
            row,
            4,
            dim.length,
            number_format=_number_format_for_dim(dim.length),
        )
        _set_number_cell(
            sheet,
            row,
            5,
            dim.width,
            number_format=_number_format_for_dim(dim.width),
        )
        _set_number_cell(
            sheet,
            row,
            6,
            dim.height,
            number_format=_number_format_for_dim(dim.height),
        )

    sheet.column_dimensions["A"].width = 20.55
    sheet.column_dimensions["B"].width = 8.33
    sheet.column_dimensions["C"].width = 10.0
    sheet.column_dimensions["D"].width = 10.0
    sheet.column_dimensions["E"].width = 10.0
    sheet.column_dimensions["F"].width = 10.0


def build_output_workbook(parsed: ParsedCcl) -> bytes:
    workbook = Workbook()
    contents = workbook.active
    contents.title = CONTENTS_SHEET
    dimensions = workbook.create_sheet(DIMENSIONS_SHEET)
    _write_contents(contents, parsed.rows)
    _write_dimensions(dimensions, parsed.shipment_id, parsed.dimensions)
    dimensions.sheet_view.tabSelected = False
    contents.sheet_view.tabSelected = True
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def generate_fba_box_contents_dnk(
    content: bytes,
    filename: str | None = None,
) -> FbaBoxContentsDnkResult:
    _ = filename
    parsed = parse_ccl(content)
    file_bytes = build_output_workbook(parsed)
    total_qty: int | float = 0
    for row in parsed.rows:
        total_qty += row.qty
    upc_count = len({row.upc for row in parsed.rows})
    box_count = len({row.box_number for row in parsed.rows})
    return FbaBoxContentsDnkResult(
        file_bytes=file_bytes,
        filename=sanitize_download_filename(parsed.shipment_id),
        row_count=len(parsed.rows),
        box_count=box_count,
        upc_count=upc_count,
        total_qty=total_qty,
        shipment_id=parsed.shipment_id,
    )
