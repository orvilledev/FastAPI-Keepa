"""NFA and SMW Tool — ``Dimensions`` sheet layout and zero-value suggestions.

Shared by the NFA and SMW Output (``fba_box_contents_tool2``) and the Corrected
workbook (``fba_box_contents_tool2_compare``).

Layout::

    Box Number | Weight | Length | Width | Height | Zero Correction

``Zero Correction`` only exists when at least one carton had a zero value
(typically ``Weight`` = ``0.00``). For those cartons a suggested value is filled
in from the most similar carton that has a real value, the row is highlighted
yellow, and the column explains why that value was chosen (same item / quantity
as Box N, closest carton size, average of several similar boxes, ...).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, replace
from typing import Any, Iterable, Mapping, Sequence

from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.worksheet import Worksheet

BASE_HEADERS = ("Box Number", "Weight", "Length", "Width", "Height")
REASON_HEADER = "Zero Correction"

_CALIBRI = Font(name="Calibri", size=11)
_CENTER = Alignment(horizontal="center")
_YELLOW = PatternFill(start_color="FFFFFF00", end_color="FFFFFF00", fill_type="solid")

_DIM_FIELDS = ("length", "width", "height")
_FIELD_LABELS = {"weight": "Weight", "length": "Length", "width": "Width", "height": "Height"}
_WEIGHT_STEP = 0.05
_MAX_REASON_WIDTH = 110.0


@dataclass(frozen=True)
class DimensionLine:
    """One carton row of the Dimensions sheet."""

    box_number: int
    weight: str
    length: int | float | None
    width: int | float | None
    height: int | float | None
    reason: str = ""


# ---------------------------------------------------------------------------
# Value helpers
# ---------------------------------------------------------------------------


def _to_float(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = str(value).strip().replace(",", "")
        if not text:
            return None
        try:
            number = float(text)
        except ValueError:
            return None
    return number if math.isfinite(number) else None


def _is_zero(value: float | None) -> bool:
    return value is not None and abs(value) < 1e-9


def _clean_number(value: float) -> int | float:
    rounded = round(value, 2)
    if float(rounded).is_integer():
        return int(rounded)
    return rounded


def _plain_number(value: float) -> int | float:
    """Keep the original precision; only drop a trailing ``.0``."""
    if float(value).is_integer() and abs(value) < 2**53:
        return int(value)
    return value


def _fmt(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def weight_text(value: float) -> str:
    """Weight as the leading-space text used across the NFA and SMW Output."""
    return f" {value:.2f}"


def _cell_weight_text(value: object) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, str):
        return value
    number = _to_float(value)
    return "" if number is None else weight_text(number)


def _line_value(line: DimensionLine, field: str) -> float | None:
    if field == "weight":
        return _to_float(line.weight)
    return _to_float(getattr(line, field))


def zero_fields(line: DimensionLine) -> tuple[str, ...]:
    """Fields (weight/length/width/height) that are exactly zero on this carton."""
    return tuple(f for f in ("weight", *_DIM_FIELDS) if _is_zero(_line_value(line, f)))


# ---------------------------------------------------------------------------
# Similarity
# ---------------------------------------------------------------------------


def _units(items: Mapping[str, float]) -> float:
    return float(sum(items.values()))


def _overlap(a: Mapping[str, float], b: Mapping[str, float]) -> float:
    """Weighted Jaccard of two carton contents (1.0 = identical UPCs and qty)."""
    keys = set(a) | set(b)
    union = sum(max(a.get(k, 0.0), b.get(k, 0.0)) for k in keys)
    if union <= 0:
        return 0.0
    return sum(min(a.get(k, 0.0), b.get(k, 0.0)) for k in keys) / union


def _unit_closeness(target_units: float, other_units: float) -> float:
    top = max(target_units, other_units)
    if top <= 0:
        return 1.0
    return 1.0 - abs(target_units - other_units) / top


def _dim_gap(target: DimensionLine, other: DimensionLine, skip: Iterable[str]) -> float | None:
    """Relative L/W/H difference using only dimensions both cartons have."""
    skipped = set(skip)
    diff = 0.0
    base = 0.0
    for field in _DIM_FIELDS:
        if field in skipped:
            continue
        a = _line_value(target, field)
        b = _line_value(other, field)
        if a is None or b is None or a <= 0 or b <= 0:
            continue
        diff += abs(a - b)
        base += a
    if base <= 0:
        return None
    return diff / base


def _dim_closeness(gap: float | None) -> float:
    if gap is None:
        return 0.5
    return max(0.0, 1.0 - 5.0 * gap)


@dataclass(frozen=True)
class _Scored:
    line: DimensionLine
    items: Mapping[str, float]
    overlap: float
    unit_close: float
    gap: float | None
    score: float


def _size_text(line: DimensionLine) -> str:
    parts = [_line_value(line, f) for f in _DIM_FIELDS]
    if any(p is None or p <= 0 for p in parts):
        return ""
    return "x".join(_fmt(p) for p in parts if p is not None)


def _size_note(gap: float | None, line: DimensionLine) -> str:
    size = _size_text(line)
    if gap is None or not size:
        return ""
    if gap <= 0.03:
        return f"nearly identical carton size ({size})"
    if gap <= 0.10:
        return f"similar carton size ({size})"
    return f"different carton size ({size})"


def _describe_contents(items: Mapping[str, float]) -> str:
    if len(items) == 1:
        upc, qty = next(iter(items.items()))
        return f"UPC {upc} x{_fmt(qty)}"
    return f"{len(items)} items, {_fmt(_units(items))} units"


def _box_list(boxes: Sequence[int]) -> str:
    labels = [str(b) for b in boxes]
    if len(labels) == 1:
        return f"Box {labels[0]}"
    return "Boxes " + ", ".join(labels[:-1]) + f" and {labels[-1]}"


def _round_weight(value: float) -> float:
    return round(round(value / _WEIGHT_STEP) * _WEIGHT_STEP, 2)


def _suggest_for(
    target: DimensionLine,
    target_items: Mapping[str, float],
    targets: tuple[str, ...],
    candidates: Sequence[tuple[DimensionLine, Mapping[str, float]]],
) -> tuple[dict[str, float], str]:
    """Return ``({field: value}, reason)`` for one carton's zero fields."""
    prefix = "" if targets == ("weight",) else ", ".join(_FIELD_LABELS[f] for f in targets) + ": "

    usable = [
        (line, items)
        for line, items in candidates
        if line.box_number != target.box_number
        and all((_line_value(line, f) or 0) > 0 for f in targets)
    ]
    if not usable:
        names = " / ".join(_FIELD_LABELS[f].lower() for f in targets)
        return {}, (
            f"{prefix}No other carton has a usable {names} to compare against — "
            "enter it manually."
        )

    target_units = _units(target_items)
    scored: list[_Scored] = []
    for line, items in usable:
        overlap = _overlap(target_items, items)
        unit_close = _unit_closeness(target_units, _units(items))
        gap = _dim_gap(target, line, skip=targets)
        score = 0.4 * overlap + 0.3 * unit_close + 0.3 * _dim_closeness(gap)
        scored.append(_Scored(line, items, overlap, unit_close, gap, score))
    scored.sort(key=lambda s: (-s.score, abs(s.line.box_number - target.box_number), s.line.box_number))
    best = scored[0]

    # 1) Identical contents — copy from the closest-sized identical carton.
    if best.overlap >= 0.999:
        identical = [s for s in scored if s.overlap >= 0.999]
        values = {f: float(_line_value(best.line, f) or 0) for f in targets}
        if len(target_items) == 1:
            lead = f"Same item and qty as Box {best.line.box_number} ({_describe_contents(target_items)})"
        else:
            lead = f"Same contents as Box {best.line.box_number} ({_describe_contents(target_items)})"
        size = _size_text(best.line)
        if len(identical) > 1:
            lead += f"; closest in size of {len(identical)} identical boxes"
            note = f"({size})" if size else ""
            reason = f"{prefix}{lead}" + (f" {note}" if note else "")
        else:
            note = _size_note(best.gap, best.line)
            reason = f"{prefix}{lead}" + (f"; {note}" if note else "")
        return values, reason

    # 2) Mostly matching contents — copy from the best match.
    if best.overlap >= 0.4:
        values = {f: float(_line_value(best.line, f) or 0) for f in targets}
        shared = sorted(set(target_items) & set(best.items))
        shared_text = f"UPC {shared[0]}" if len(shared) == 1 else f"{len(shared)} UPCs"
        best_units = _units(best.items)
        if abs(best_units - target_units) < 1e-9:
            units_text = f"same total units ({_fmt(target_units)})"
        else:
            units_text = f"similar total units ({_fmt(target_units)} vs {_fmt(best_units)})"
        note = _size_note(best.gap, best.line)
        reason = f"{prefix}Shares {shared_text} with Box {best.line.box_number}; {units_text}"
        reason += f"; {note}" if note else ""
        return values, reason

    # 3) No comparable contents — average the most alike cartons (by units, then size).
    ranked = sorted(
        scored,
        key=lambda s: (
            -(0.6 * s.unit_close + 0.4 * _dim_closeness(s.gap)),
            abs(s.line.box_number - target.box_number),
            s.line.box_number,
        ),
    )
    top = sorted(ranked[:3], key=lambda s: s.line.box_number)
    values: dict[str, float] = {}
    scaled = False
    for field in targets:
        samples: list[float] = []
        for s in top:
            raw = float(_line_value(s.line, field) or 0)
            other_units = _units(s.items)
            if field == "weight" and other_units > 0 and target_units > 0:
                ratio = target_units / other_units
                if abs(ratio - 1.0) > 1e-9:
                    scaled = True
                raw *= ratio
            samples.append(raw)
        mean = sum(samples) / len(samples)
        values[field] = _round_weight(mean) if field == "weight" else round(mean, 2)

    boxes = [s.line.box_number for s in top]
    size = _size_text(target)
    size_text = f"closest carton size to {size}" if size else "closest carton size"
    if scaled and "weight" in targets:
        units_text = f"weight scaled to this box's {_fmt(target_units)} units"
    elif target_units > 0:
        units_text = f"same {_fmt(target_units)} units"
    else:
        units_text = ""
    detail = size_text + (f", {units_text}" if units_text else "")
    reason = f"{prefix}No identical carton to copy; average of {_box_list(boxes)} ({detail})"
    return values, reason


def apply_zero_corrections(
    lines: Sequence[DimensionLine],
    items_by_box: Mapping[int, Mapping[str, float]],
) -> tuple[list[DimensionLine], int]:
    """Fill zero values with suggestions and explain them.

    Cartons that already carry a ``Zero Correction`` reason (from an earlier run)
    are kept as they are and never used as a reference. Returns the new lines and
    the number of cartons that received a new suggestion.
    """
    references = [
        (line, items_by_box.get(line.box_number, {}))
        for line in lines
        if not line.reason
    ]
    result: list[DimensionLine] = []
    corrected = 0
    for line in lines:
        targets = () if line.reason else zero_fields(line)
        if not targets:
            result.append(line)
            continue
        values, reason = _suggest_for(line, items_by_box.get(line.box_number, {}), targets, references)
        updates: dict[str, Any] = {"reason": reason}
        for field, value in values.items():
            if field == "weight":
                updates["weight"] = weight_text(value)
            else:
                updates[field] = _clean_number(value)
        result.append(replace(line, **updates))
        corrected += 1
    return result, corrected


def build_items_by_box(rows: Iterable[tuple[str, int, float]]) -> dict[int, dict[str, float]]:
    """``(upc, box_number, qty)`` rows → ``{box: {upc: qty}}`` (zero qty ignored)."""
    items: dict[int, dict[str, float]] = {}
    for upc, box, qty in rows:
        if not upc or not qty or qty <= 0:
            continue
        bucket = items.setdefault(int(box), {})
        bucket[upc] = bucket.get(upc, 0.0) + float(qty)
    return items


# ---------------------------------------------------------------------------
# Sheet IO
# ---------------------------------------------------------------------------


def _norm(value: object) -> str:
    return " ".join(str(value).split()).lower() if value is not None else ""


def parse_dimension_lines(sheet: Worksheet) -> list[DimensionLine]:
    """Read a Dimensions sheet in either the new (Box Number) or the old layout."""
    header = [_norm(c.value) for c in sheet[1]] if sheet.max_row >= 1 else []
    has_box = bool(header) and header[0] == "box number"
    offset = 1 if has_box else 0
    reason_col = next((i for i, h in enumerate(header) if h == _norm(REASON_HEADER)), None)

    lines: list[DimensionLine] = []
    for r in range(2, sheet.max_row + 1):
        weight = _cell_weight_text(sheet.cell(r, offset + 1).value)
        length = _to_float(sheet.cell(r, offset + 2).value)
        width = _to_float(sheet.cell(r, offset + 3).value)
        height = _to_float(sheet.cell(r, offset + 4).value)
        reason_raw = sheet.cell(r, reason_col + 1).value if reason_col is not None else None
        reason = "" if reason_raw is None else str(reason_raw).strip()
        if not weight.strip() and length is None and width is None and height is None:
            continue
        box = _to_float(sheet.cell(r, 1).value) if has_box else None
        lines.append(
            DimensionLine(
                box_number=int(box) if box is not None else r - 1,
                weight=weight,
                length=None if length is None else _plain_number(length),
                width=None if width is None else _plain_number(width),
                height=None if height is None else _plain_number(height),
                reason=reason,
            )
        )
    return lines


def write_dimension_lines(sheet: Worksheet, lines: Sequence[DimensionLine]) -> None:
    """Write the ``Box Number | Weight | Length | Width | Height [| Zero Correction]`` sheet."""
    sheet.sheet_view.showGridLines = True
    has_reason = any(line.reason for line in lines)
    headers = BASE_HEADERS + ((REASON_HEADER,) if has_reason else ())
    for column, header in enumerate(headers, start=1):
        cell = sheet.cell(row=1, column=column, value=header)
        cell.font = _CALIBRI
        cell.number_format = "General"
        cell.data_type = "s"
        if column == 1:
            cell.alignment = _CENTER

    for row, line in enumerate(lines, start=2):
        fill = _YELLOW if line.reason else None

        box = sheet.cell(row=row, column=1, value=int(line.box_number))
        box.font = _CALIBRI
        box.number_format = "General"
        box.alignment = _CENTER

        weight = sheet.cell(row=row, column=2)
        weight.font = _CALIBRI
        weight.number_format = "General"
        if line.weight:
            weight.value = str(line.weight)
            weight.data_type = "s"

        for column, number in ((3, line.length), (4, line.width), (5, line.height)):
            cell = sheet.cell(row=row, column=column)
            cell.font = _CALIBRI
            cell.number_format = "General"
            if number is not None and not isinstance(number, bool):
                cell.value = _plain_number(float(number))

        if has_reason:
            reason = sheet.cell(row=row, column=6)
            reason.font = _CALIBRI
            reason.number_format = "General"
            if line.reason:
                reason.value = line.reason
                reason.data_type = "s"

        if fill is not None:
            for column in range(2, len(headers) + 1):
                sheet.cell(row=row, column=column).fill = fill

    sheet.column_dimensions["A"].width = 12.0
    for letter in ("B", "C", "D", "E"):
        sheet.column_dimensions[letter].width = 10.0
    if has_reason:
        longest = max((len(line.reason) for line in lines), default=len(REASON_HEADER))
        sheet.column_dimensions["F"].width = min(max(longest + 2, 16.0), _MAX_REASON_WIDTH)
