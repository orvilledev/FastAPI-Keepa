"""Shared FBA Output / AMZ-manifest parse and reconcile helpers.

Used by FBA Box Contents DNK and NFA/SMW Tool2 compare flows to:
  - Parse Output (``Box Contents`` + ``Dimensions``) and Amazon
    ``Box packing information`` upload templates
  - Remap Output UPCs to Old SKUs via the Old SKUs catalog
  - Force Box Contents quantities to match the AMZ expected totals without
    emptying any box (Seller Central drops empty boxes)
"""
from __future__ import annotations

import io
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Mapping, Sequence

from openpyxl import load_workbook

_MAX_UPLOAD_BYTES = 15 * 1024 * 1024
_SKU_SUFFIX_RE = re.compile(r"-FNSKU$", re.IGNORECASE)
_QTY_EPSILON = 0.0001

BOX_CONTENTS_SHEET = "Box Contents"
DIMENSIONS_SHEET = "Dimensions"

# Seller Central drops boxes with no units, which would shrink the box count.
MIN_UNITS_PER_BOX = 1

NOT_IN_AMZ_REASON = "Not expected in AMZ upload"
SURPLUS_REASON = "Surplus vs AMZ expected quantity"
MISSING_UPC_REASON = "UPC absent from Output"
SHORTFALL_REASON = "Short vs AMZ expected quantity"
SEEDED_BOX_REASON = "Seeded to keep the box from emptying"
RELOCATED_REASON = "Moved to keep another box from emptying"


class FbaUploadCompareError(ValueError):
    """Raised for user-correctable input problems."""


@dataclass(frozen=True)
class ContentRow:
    identifier: str
    box_number: int
    qty: int | float
    remapped: bool = False
    added: bool = False


@dataclass
class _WorkRow:
    """Mutable Box Contents row used while reconciling against the AMZ file."""

    identifier: str
    box_number: int
    qty: int | float
    remapped: bool = False
    added: bool = False


@dataclass(frozen=True)
class DimensionRow:
    weight: str
    length: int | float | None
    width: int | float | None
    height: int | float | None


@dataclass(frozen=True)
class AmzSkuRow:
    sku_id: str
    expected_qty: int | float
    product_title: str = ""


@dataclass(frozen=True)
class AdjustmentRow:
    """One unit movement applied while reconciling the Output to the AMZ file."""

    identifier: str
    box_number: int
    qty: int | float
    reason: str = ""


@dataclass
class Reconciliation:
    rows: list[ContentRow] = field(default_factory=list)
    box_numbers: list[int] = field(default_factory=list)
    last_box: int = 0
    added: list[AdjustmentRow] = field(default_factory=list)
    removed: list[AdjustmentRow] = field(default_factory=list)


@dataclass
class ParsedOutput:
    rows: list[ContentRow] = field(default_factory=list)
    dimensions: list[DimensionRow] = field(default_factory=list)
    shipment_hint: str = ""


@dataclass
class ParsedAmz:
    skus: list[AmzSkuRow] = field(default_factory=list)
    shipment_id: str = ""
    total_box_count: int | None = None


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


def _weight_as_text(value: object) -> str:
    """Preserve Output weight text (including leading spaces) when present."""
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return ""
        if value.is_integer() and abs(value) < 2**53:
            return str(int(value))
        return format(value, ".15g")
    return str(value)


def _as_number(value: object) -> int | float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        if value.is_integer() and abs(value) < 2**53:
            return int(value)
        return float(value)
    text = _cell_text(value).replace(",", "")
    if not text:
        return None
    try:
        num = float(text)
    except ValueError:
        return None
    if not math.isfinite(num):
        return None
    if num.is_integer() and abs(num) < 2**53:
        return int(num)
    return num


def _as_qty(value: object) -> int | float:
    num = _as_number(value)
    if num is None:
        return 0
    return num


def _normalize_sku_id(value: object) -> str:
    text = _cell_text(value)
    if not text:
        return ""
    return _SKU_SUFFIX_RE.sub("", text).strip()


def parse_output_workbook(content: bytes) -> ParsedOutput:
    if len(content) > _MAX_UPLOAD_BYTES:
        raise FbaUploadCompareError("Output file is too large (max 15 MB).")
    try:
        workbook = load_workbook(io.BytesIO(content), data_only=True)
    except Exception as exc:
        raise FbaUploadCompareError("Could not read the Output Excel file.") from exc

    if BOX_CONTENTS_SHEET not in workbook.sheetnames:
        raise FbaUploadCompareError(
            f'Output file must include a "{BOX_CONTENTS_SHEET}" sheet.'
        )

    sheet = workbook[BOX_CONTENTS_SHEET]
    header_upc = _cell_text(sheet.cell(1, 1).value).lower()
    header_box = _cell_text(sheet.cell(1, 2).value).lower()
    header_qty = _cell_text(sheet.cell(1, 3).value).lower()
    if header_upc != "upc" or "box" not in header_box or header_qty not in ("qty", "quantity"):
        raise FbaUploadCompareError(
            'Output "Box Contents" must have columns UPC, Box Number, QTY.'
        )

    rows: list[ContentRow] = []
    for r in range(2, sheet.max_row + 1):
        upc = _cell_text(sheet.cell(r, 1).value)
        box = _as_number(sheet.cell(r, 2).value)
        qty_raw = sheet.cell(r, 3).value
        if not upc and box is None and qty_raw is None:
            continue
        if not upc:
            continue
        if box is None:
            raise FbaUploadCompareError(f"Output row {r} is missing a Box Number.")
        box_number = int(box)
        rows.append(ContentRow(identifier=upc, box_number=box_number, qty=_as_qty(qty_raw)))

    if not rows:
        raise FbaUploadCompareError("Output file has no Box Contents rows.")

    dimensions: list[DimensionRow] = []
    if DIMENSIONS_SHEET in workbook.sheetnames:
        dim = workbook[DIMENSIONS_SHEET]
        # NFA and SMW Output: "Box Number" leads, then Weight/Length/Width/Height.
        offset = 1 if _cell_text(dim.cell(1, 1).value).lower() == "box number" else 0
        for r in range(2, dim.max_row + 1):
            weight = _weight_as_text(dim.cell(r, 1 + offset).value)
            length = _as_number(dim.cell(r, 2 + offset).value)
            width = _as_number(dim.cell(r, 3 + offset).value)
            height = _as_number(dim.cell(r, 4 + offset).value)
            if not weight.strip() and length is None and width is None and height is None:
                continue
            dimensions.append(
                DimensionRow(weight=weight, length=length, width=width, height=height)
            )

    return ParsedOutput(rows=rows, dimensions=dimensions)


def parse_amz_upload(content: bytes) -> ParsedAmz:
    if len(content) > _MAX_UPLOAD_BYTES:
        raise FbaUploadCompareError("AMZ upload file is too large (max 15 MB).")
    try:
        workbook = load_workbook(io.BytesIO(content), data_only=True)
    except Exception as exc:
        raise FbaUploadCompareError("Could not read the AMZ upload Excel file.") from exc

    sheet_name = None
    for name in workbook.sheetnames:
        if name.strip().lower() == "box packing information":
            sheet_name = name
            break
    if sheet_name is None:
        raise FbaUploadCompareError(
            'AMZ upload file must include a "Box packing information" sheet.'
        )

    sheet = workbook[sheet_name]
    shipment_id = ""
    total_box_count: int | None = None
    for r in range(1, min(6, sheet.max_row + 1)):
        a = _cell_text(sheet.cell(r, 1).value)
        if a.lower().startswith("shipment:"):
            shipment_id = a.split(":", 1)[1].strip() or _cell_text(sheet.cell(r, 2).value)
        # Total box count sits near column M (13) on Amazon templates
        for c in range(1, min(20, sheet.max_column + 1)):
            label = _cell_text(sheet.cell(r, c).value).lower()
            if "total box count" in label:
                for look in range(c + 1, min(c + 6, sheet.max_column + 1)):
                    num = _as_number(sheet.cell(r, look).value)
                    if num is not None:
                        total_box_count = int(num)
                        break

    # Find header row with SKU / Expected quantity
    header_row = None
    sku_col = expected_col = title_col = None
    for r in range(1, min(12, sheet.max_row + 1)):
        labels = {
            c: _cell_text(sheet.cell(r, c).value).lower()
            for c in range(1, min(20, sheet.max_column + 1))
        }
        sku_candidates = [c for c, v in labels.items() if v == "sku"]
        exp_candidates = [
            c for c, v in labels.items() if v in ("expected quantity", "expected qty")
        ]
        title_candidates = [
            c for c, v in labels.items() if "product title" in v or v == "title"
        ]
        if sku_candidates and exp_candidates:
            header_row = r
            sku_col = sku_candidates[0]
            expected_col = exp_candidates[0]
            title_col = title_candidates[0] if title_candidates else None
            break

    if header_row is None or sku_col is None or expected_col is None:
        raise FbaUploadCompareError(
            'AMZ "Box packing information" must include SKU and Expected quantity columns.'
        )

    skus: list[AmzSkuRow] = []
    for r in range(header_row + 1, sheet.max_row + 1):
        raw_sku = _cell_text(sheet.cell(r, sku_col).value)
        if not raw_sku:
            continue
        lower = raw_sku.lower()
        if lower.startswith("box ") or lower.startswith("name of box") or lower.startswith("box weight"):
            break
        sku_id = _normalize_sku_id(raw_sku)
        if not sku_id:
            continue
        title = _cell_text(sheet.cell(r, title_col).value) if title_col else ""
        skus.append(
            AmzSkuRow(
                sku_id=sku_id,
                expected_qty=_as_qty(sheet.cell(r, expected_col).value),
                product_title=title,
            )
        )

    if not skus:
        raise FbaUploadCompareError("AMZ upload file has no SKU rows.")

    return ParsedAmz(
        skus=skus,
        shipment_id=shipment_id,
        total_box_count=total_box_count,
    )


def build_upc_to_old_sku_map(
    catalog_rows: Sequence[Mapping[str, object]],
    *,
    amz_ids: set[str] | None = None,
) -> dict[str, str]:
    """Map UPC Code → Old SKU, preferring real Old SKUs used in the AMZ file.

    The catalog often stores both an identity row (``old_sku == upc_code``) and a
    true Old SKU row (e.g. ``9990262``) for the same UPC. Identity rows must not
    win the mapping or remaps and yellow highlights break.
    """
    amz_ids = amz_ids or set()
    candidates: dict[str, list[str]] = defaultdict(list)
    for row in catalog_rows:
        upc = _cell_text(row.get("upc_code"))
        old = _cell_text(row.get("old_sku"))
        if not upc or not old:
            continue
        if old not in candidates[upc]:
            candidates[upc].append(old)

    mapping: dict[str, str] = {}
    for upc, olds in candidates.items():
        in_amz = [old for old in olds if old != upc and old in amz_ids]
        if in_amz:
            mapping[upc] = in_amz[0]
            continue
        non_identity = [old for old in olds if old != upc]
        if non_identity:
            mapping[upc] = non_identity[0]
    return mapping


def apply_old_sku_remaps(
    output: ParsedOutput,
    amz: ParsedAmz,
    upc_to_old_sku: Mapping[str, str],
) -> list[ContentRow]:
    """Replace Output UPCs with Old SKUs when those Old SKUs appear in AMZ."""
    amz_ids = {row.sku_id for row in amz.skus}
    remapped_rows: list[ContentRow] = []
    for row in output.rows:
        old_sku = upc_to_old_sku.get(row.identifier)
        if old_sku and old_sku in amz_ids and old_sku != row.identifier:
            remapped_rows.append(
                ContentRow(
                    identifier=old_sku,
                    box_number=row.box_number,
                    qty=row.qty,
                    remapped=True,
                )
            )
        else:
            remapped_rows.append(row)
    return remapped_rows


def reconcile_to_amz(
    rows: Sequence[ContentRow],
    amz: ParsedAmz,
    upc_to_old_sku: Mapping[str, str],
    *,
    preserve_rows: bool = False,
) -> Reconciliation:
    """Force Box Contents totals to equal the AMZ expected quantities.

    The AMZ upload is the source of truth, so anything it does not expect is
    removed and every shortfall is topped up in the last box.

    No box is allowed to end up empty, because Seller Central drops empty boxes
    and would shrink the shipment's box count. Surplus units therefore come off
    the highest box numbers first but never take a box below
    ``MIN_UNITS_PER_BOX``, and any box left empty by units the AMZ file does not
    expect is seeded from the units being added.

    With ``preserve_rows=True`` the Output rows stay as packed: zero-quantity
    lines are kept, and every added unit becomes its own row after the existing
    rows of its box instead of topping up a matching row.
    """
    targets: dict[str, int | float] = {}
    for sku in amz.skus:
        targets[sku.sku_id] = targets.get(sku.sku_id, 0) + sku.expected_qty

    old_to_upc = {old: upc for upc, old in upc_to_old_sku.items()}

    def resolve(identifier: str) -> str | None:
        if identifier in targets:
            return identifier
        old = upc_to_old_sku.get(identifier)
        if old and old in targets:
            return old
        upc = old_to_upc.get(identifier)
        if upc and upc in targets:
            return upc
        return None

    # Keep every original box: reconciling must not change the shipment's box
    # count, and the pivot has to line up with the AMZ boxes and Dimensions.
    box_numbers = sorted({row.box_number for row in rows})
    if not box_numbers:
        raise FbaUploadCompareError("Output file has no Box Contents rows.")
    last_box = box_numbers[-1]

    work: list[_WorkRow] = []
    grouped: dict[str, list[int]] = defaultdict(list)
    removed: list[AdjustmentRow] = []

    for row in rows:
        key = resolve(row.identifier)
        if key is None:
            removed.append(
                AdjustmentRow(
                    identifier=row.identifier,
                    box_number=row.box_number,
                    qty=row.qty,
                    reason=NOT_IN_AMZ_REASON,
                )
            )
            continue
        grouped[key].append(len(work))
        work.append(
            _WorkRow(
                identifier=key,
                box_number=row.box_number,
                qty=row.qty,
                remapped=row.remapped or key != row.identifier,
            )
        )

    box_totals: dict[int, int | float] = {box: 0 for box in box_numbers}
    for row in work:
        box_totals[row.box_number] += row.qty
    zero_rows = {id(row) for row in work if not row.qty} if preserve_rows else set()

    def take_from(index: int, take: int | float) -> None:
        work[index].qty -= take
        box_totals[work[index].box_number] -= take
        removed.append(
            AdjustmentRow(
                identifier=work[index].identifier,
                box_number=work[index].box_number,
                qty=take,
                reason=SURPLUS_REASON,
            )
        )

    shortfalls: dict[str, int | float] = {}
    for key in sorted(targets):
        indexes = grouped.get(key, [])
        current: int | float = 0
        for index in indexes:
            current += work[index].qty
        delta = targets[key] - current
        if abs(delta) <= _QTY_EPSILON:
            continue
        if delta > 0:
            shortfalls[key] = delta
            continue

        surplus = -delta
        # Trim the tail boxes first so the earlier boxes stay as packed, but
        # never take the units that are keeping a box alive.
        tail_first = sorted(indexes, key=lambda i: (work[i].box_number, i), reverse=True)
        for index in tail_first:
            if surplus <= _QTY_EPSILON:
                break
            spare = box_totals[work[index].box_number] - MIN_UNITS_PER_BOX
            take = min(surplus, work[index].qty, spare)
            if take <= 0:
                continue
            take_from(index, take)
            surplus -= take
        # Every box holding this UPC is already at its floor, so the surplus has
        # to come off anyway; the seeding pass below refills whatever empties.
        for index in tail_first:
            if surplus <= _QTY_EPSILON:
                break
            take = min(surplus, work[index].qty)
            if take <= 0:
                continue
            take_from(index, take)
            surplus -= take

    def is_kept(row: _WorkRow) -> bool:
        return bool(row.qty) or id(row) in zero_rows

    kept = [row for row in work if is_kept(row)]
    # Decide placements before mutating rows so added-unit audits stay accurate.
    placements: list[AdjustmentRow] = []

    def place(identifier: str, box: int, qty: int | float, reason: str) -> None:
        placements.append(
            AdjustmentRow(identifier=identifier, box_number=box, qty=qty, reason=reason)
        )
        box_totals[box] += qty

    shortfall_reasons = {
        key: SHORTFALL_REASON if grouped.get(key) else MISSING_UPC_REASON for key in shortfalls
    }
    for box in box_numbers:
        if box_totals[box] > _QTY_EPSILON:
            continue
        if box == last_box and shortfalls:
            # Whatever is left over is placed here below, so it fills itself.
            continue
        donor = max(
            (key for key, qty in shortfalls.items() if qty >= MIN_UNITS_PER_BOX),
            key=lambda key: (shortfalls[key], key),
            default=None,
        )
        if donor is not None:
            shortfalls[donor] -= MIN_UNITS_PER_BOX
            if shortfalls[donor] <= _QTY_EPSILON:
                del shortfalls[donor]
            place(donor, box, MIN_UNITS_PER_BOX, SEEDED_BOX_REASON)
            continue
        # Nothing is being added, so move a unit out of the fullest box instead.
        spare_rows = [
            row
            for row in kept
            if row.qty >= MIN_UNITS_PER_BOX
            and box_totals[row.box_number] - MIN_UNITS_PER_BOX >= MIN_UNITS_PER_BOX
        ]
        if not spare_rows:
            continue
        source = max(spare_rows, key=lambda row: (box_totals[row.box_number], row.qty))
        source.qty -= MIN_UNITS_PER_BOX
        box_totals[source.box_number] -= MIN_UNITS_PER_BOX
        removed.append(
            AdjustmentRow(
                identifier=source.identifier,
                box_number=source.box_number,
                qty=MIN_UNITS_PER_BOX,
                reason=RELOCATED_REASON,
            )
        )
        place(source.identifier, box, MIN_UNITS_PER_BOX, SEEDED_BOX_REASON)

    for key in sorted(shortfalls):
        place(key, last_box, shortfalls[key], shortfall_reasons[key])

    existing_rows = {(row.identifier, row.box_number): row for row in kept if row.qty}
    appended: list[_WorkRow] = []
    for placement in placements:
        slot = (placement.identifier, placement.box_number)
        existing = existing_rows.get(slot)
        if existing is not None and (not preserve_rows or existing.added):
            existing.qty += placement.qty
            existing.added = True
            continue
        new_row = _WorkRow(
            identifier=placement.identifier,
            box_number=placement.box_number,
            qty=placement.qty,
            added=True,
        )
        existing_rows[slot] = new_row
        appended.append(new_row)

    # Seeding can target any box, so re-sort to keep the Output's box ordering.
    rows_out = [row for row in kept if is_kept(row)] + appended
    sequence = {id(row): index for index, row in enumerate(rows_out)}
    rows_out.sort(key=lambda row: (row.box_number, sequence[id(row)]))

    return Reconciliation(
        rows=[
            ContentRow(
                identifier=row.identifier,
                box_number=row.box_number,
                qty=row.qty,
                remapped=row.remapped,
                added=row.added,
            )
            for row in rows_out
        ],
        box_numbers=box_numbers,
        last_box=last_box,
        added=placements,
        removed=removed,
    )
