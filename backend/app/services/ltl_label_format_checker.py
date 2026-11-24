"""LTL Label Format Checker — validate Amazon FBA *LTL box label* PDFs and their box order.

An LTL shipment is downloaded from Seller Central as **one PDF with one page per box**
(no UPS page). Every page is a 4.25 x 6 in (306 x 432 pt) Amazon box label:

* "PLEASE LEAVE THIS LABEL UNCOVERED" across the top, then the "FBA" title (and, on some
  shipments, a white-on-black "Mixed" badge at the top-right)
* Ship From / Ship To blocks, the black shipment-name / Created bar
* the Code 128 Box ID barcode with the Box ID under it, the PDF417 code at the right
* the contents block — "Mixed SKUs", or "Single SKU" + SKU + "Qty N" — ending with the
  box tag: ``P1 - B7`` or ``FBA19WBXZVZZ - B7``

The "B" number on the box tag is the box number. In a correctly ordered PDF the pages run
B1, B2, B3, ... in page order; this module flags every page where that is not the case.

The reference layout comes from real LTL label PDFs (FBA19WTTW2CG — correct order, and
FBA19WBXZVZZ — wrong order). Generic helpers (text extraction, Code 128 decoding, Excel
styling) are shared with :mod:`app.services.label_format_checker`.
"""
from __future__ import annotations

import base64
import io
import re
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import PurePosixPath
from typing import Any, Optional

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font

from app.services import label_format_checker as lfc
from app.services.label_format_checker import (
    FAIL,
    FILE_FAIL,
    FILE_PASS,
    FILE_REVIEW,
    PASS,
    REFERENCE_SHIP_FROM,
    WARN,
    Check,
    decode_code128_widths,
)

# --------------------------------------------------------------------------- limits
MAX_UPLOAD_BYTES = lfc.MAX_UPLOAD_BYTES
MAX_PDF_BYTES = lfc.MAX_PDF_BYTES
MAX_PDF_FILES = lfc.MAX_PDF_FILES
MAX_ZIP_UNCOMPRESSED_BYTES = lfc.MAX_ZIP_UNCOMPRESSED_BYTES
# LTL shipments carry many boxes in one PDF (one page each).
MAX_PAGES_PER_PDF = 600
THUMBNAIL_DPI = lfc.THUMBNAIL_DPI
MAX_THUMBNAIL_PAGES = 6
THUMBNAIL_ALL_LIMIT = 80

# --------------------------------------------------------------------------- reference format
PAGE_W = 306.0
PAGE_H = 432.0
PAGE_TOL = 2.0

_BOX_ID_RE = re.compile(r"^(FBA[0-9A-Z]{9})U(\d{6})$")
_BOX_TAG_RE = re.compile(r"^(?:P(\d+)|(FBA[0-9A-Z]{9})) - B(\d+)$")
_QTY_RE = re.compile(r"^Qty (\d+)$")
_CREATED_RE = re.compile(
    r"^Created: (\d{4})/(\d{2})/(\d{2}) (\d{2}):(\d{2}) ([A-Z]{2,5}) \(([+-]\d{2})\)$"
)
_CITY_STATE_ZIP_RE = re.compile(r"^.+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$")
_FILENAME_RE = re.compile(r"^(FBA[0-9A-Z]{9})(?:[-_ ].*)?$", re.IGNORECASE)
_NOTICE_TEXT = "PLEASE LEAVE THIS LABEL UNCOVERED"

# Vector shapes every LTL box label carries: (kind, (x0, y0, x1, y1), tolerance, description)
_EXPECTED_SHAPES = [
    ("f", (15.3, 89.0, 152.0, 95.0), 2.5, "black bar - shipment name"),
    ("f", (152.0, 89.0, 288.7, 95.0), 2.5, "black bar - created stamp"),
    ("s", (15.3, 189.7, 204.0, 189.7), 2.5, "rule under the Box ID"),
    ("f", (20.8, 100.0, 198.4, 175.0), 4.0, "Code 128 barcode block"),
]
# The header rule is one full-width line, or two halves split at x=152.
_HEADER_RULE_FULL = (15.3, 35.0, 288.7, 35.0)
_HEADER_RULE_HALVES = ((15.3, 35.0, 152.0, 35.0), (152.0, 35.0, 288.7, 35.0))
_MIXED_BADGE_RECT = (246.7, 20.2, 286.7, 34.1)
_BARCODE_CENTER_X = (20.8 + 198.4) / 2.0


class LtlLabelFormatCheckerError(Exception):
    """Raised for unusable uploads (wrong type, empty, too large, no PDFs)."""


# =========================================================================== data model
@dataclass
class LtlBox:
    index: int  # 1-based page / box position inside the PDF
    page: int
    checks: list[Check] = field(default_factory=list)
    fields: dict[str, Any] = field(default_factory=dict)

    @property
    def status(self) -> str:
        statuses = {c.status for c in self.checks}
        if FAIL in statuses:
            return FAIL
        if WARN in statuses:
            return WARN
        return PASS

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "page": self.page,
            "status": self.status,
            "fields": self.fields,
            "checks": [c.to_dict() for c in self.checks],
        }


@dataclass
class BoxOrder:
    status: str = PASS
    mode: str = "sequence"  # "sequence" (B1, B2, ...) | "pack_group" (restarts per pack group)
    expected_start: int = 1
    entries: list[dict[str, Any]] = field(default_factory=list)
    missing: list[int] = field(default_factory=list)
    duplicates: list[int] = field(default_factory=list)
    unreadable_pages: list[int] = field(default_factory=list)

    @property
    def out_of_order(self) -> int:
        return sum(1 for e in self.entries if e["ok"] is False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "mode": self.mode,
            "expected_start": self.expected_start,
            "out_of_order": self.out_of_order,
            "missing": self.missing,
            "duplicates": self.duplicates,
            "unreadable_pages": self.unreadable_pages,
            "entries": self.entries,
        }


@dataclass
class LtlFileResult:
    name: str
    path: str
    size_bytes: int
    page_count: int = 0
    checks: list[Check] = field(default_factory=list)  # file-level checks
    boxes: list[LtlBox] = field(default_factory=list)
    box_order: Optional[BoxOrder] = None
    thumbnails: list[dict[str, Any]] = field(default_factory=list)

    @property
    def all_checks(self) -> list[Check]:
        out = list(self.checks)
        for box in self.boxes:
            out.extend(box.checks)
        return out

    @property
    def status(self) -> str:
        statuses = {c.status for c in self.all_checks}
        if FAIL in statuses:
            return FILE_FAIL
        if WARN in statuses:
            return FILE_REVIEW
        return FILE_PASS

    def to_dict(self) -> dict[str, Any]:
        first = self.boxes[0].fields if self.boxes else {}
        all_checks = self.all_checks
        return {
            "name": self.name,
            "path": self.path,
            "size_bytes": self.size_bytes,
            "page_count": self.page_count,
            "status": self.status,
            "box_count": len(self.boxes),
            "shipment_id": first.get("shipment_id", ""),
            "shipment_name": first.get("shipment_name", ""),
            "box_order": self.box_order.to_dict() if self.box_order else None,
            "checks": [c.to_dict() for c in self.checks],
            "boxes": [b.to_dict() for b in self.boxes],
            "thumbnails": self.thumbnails,
            "failed_checks": sum(1 for c in all_checks if c.status == FAIL),
            "warning_checks": sum(1 for c in all_checks if c.status == WARN),
            "total_checks": len(all_checks),
        }


@dataclass
class SkippedItem:
    name: str
    reason: str


@dataclass
class LtlCheckRun:
    source_name: str
    source_kind: str  # "pdf" | "zip" | "batch"
    files: list[LtlFileResult]
    skipped: list[SkippedItem]
    checked_at: datetime

    def summary(self) -> dict[str, Any]:
        return {
            "total": len(self.files),
            "passed": sum(1 for f in self.files if f.status == FILE_PASS),
            "review": sum(1 for f in self.files if f.status == FILE_REVIEW),
            "failed": sum(1 for f in self.files if f.status == FILE_FAIL),
            "skipped": len(self.skipped),
            "out_of_order": sum(
                1 for f in self.files if f.box_order is not None and f.box_order.status == FAIL
            ),
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_name": self.source_name,
            "source_kind": self.source_kind,
            "checked_at": self.checked_at.isoformat(timespec="seconds"),
            "summary": self.summary(),
            "files": [f.to_dict() for f in self.files],
            "skipped": [{"name": s.name, "reason": s.reason} for s in self.skipped],
        }


# =========================================================================== helpers
_near = lfc._near
_rect_close = lfc._rect_close
_Line = lfc._Line
_text_lines = lfc._text_lines


def _decode_barcode(drawings) -> tuple[Optional[str], Optional[tuple[float, float, float, float]]]:
    """Find the Code 128 bar block under the header bar and decode it."""
    for dr in drawings:
        if dr.get("type") != "f":
            continue
        rect = dr["rect"]
        if rect.width < 100 or rect.y0 < 96 or rect.y0 > 112:
            continue
        bars = sorted(
            (it[1] for it in dr.get("items", []) if it[0] == "re" and it[1].height > 40 and it[1].width > 0.2),
            key=lambda r: r.x0,
        )
        if len(bars) < 10:
            continue
        widths: list[float] = []
        for i, bar in enumerate(bars):
            widths.append(bar.width)
            if i + 1 < len(bars):
                widths.append(bars[i + 1].x0 - bar.x1)
        return decode_code128_widths(widths), (rect.x0, rect.y0, rect.x1, rect.y1)
    return None, None


def _check_page_size(page, page_no: int) -> Check:
    w, h = page.rect.width, page.rect.height
    rotation = page.rotation
    ok = _near(w, PAGE_W, PAGE_TOL) and _near(h, PAGE_H, PAGE_TOL) and rotation == 0
    detail = f"{w / 72:.2f} x {h / 72:.2f} in ({w:.0f} x {h:.0f} pt)"
    if rotation:
        detail += f", rotated {rotation}°"
    label = "Page size (4x6 in, portrait)"
    if ok:
        return Check("box.size", label, PASS, detail, page_no)
    return Check(
        "box.size",
        label,
        FAIL,
        f"{detail} — expected 4.25 x 6.00 in (306 x 432 pt) portrait, as printed by "
        "Thermal Printing - 4x6 inches",
        page_no,
    )


# =========================================================================== page check
def _analyze_box_label(page, page_no: int, box: LtlBox) -> None:
    """Validate one LTL box label page; appends checks to ``box``."""
    checks = box.checks
    fields = box.fields
    checks.append(_check_page_size(page, page_no))

    lines = _text_lines(page)
    if not lines:
        checks.append(
            Check(
                "box.text",
                "Box label text layer",
                FAIL,
                "No text found on the page. Every page must be Amazon's original vector box label, "
                "not a scan, screenshot, carrier label or re-rasterized print.",
                page_no,
            )
        )
        return
    checks.append(Check("box.text", "Box label text layer", PASS, f"{len(lines)} text lines", page_no))

    def claim(line: _Line) -> _Line:
        line.used = True
        return line

    # ---- top notice
    notice = next((l for l in lines if l.text == _NOTICE_TEXT), None)
    if notice is None:
        checks.append(
            Check("box.notice", "'PLEASE LEAVE THIS LABEL UNCOVERED' at the top", FAIL, "Notice text missing.", page_no)
        )
    else:
        claim(notice)
        if _near(notice.x0, 72, 5) and _near(notice.y0, 5.4, 4) and _near(notice.size, 8, 1):
            checks.append(
                Check("box.notice", "'PLEASE LEAVE THIS LABEL UNCOVERED' at the top", PASS, "Present", page_no)
            )
        else:
            checks.append(
                Check(
                    "box.notice",
                    "'PLEASE LEAVE THIS LABEL UNCOVERED' at the top",
                    FAIL,
                    f"Notice is misplaced (x={notice.x0:.0f}, y={notice.y0:.0f}); the LTL label prints it "
                    "across the top of the page.",
                    page_no,
                )
            )

    # ---- FBA title + optional "Mixed" badge
    title = next((l for l in lines if l.text == "FBA" and l.x0 < 60 and l.y0 < 30), None)
    badge = next((l for l in lines if l.text == "Mixed" and l.x0 > 200 and l.y0 < 30), None)
    problems: list[str] = []
    if title is None:
        problems.append("'FBA' title missing at top-left")
    else:
        claim(title)
        if not (_near(title.x0, 17.3, 4) and _near(title.y0, 15.9, 4) and _near(title.size, 15, 1.5)):
            problems.append(
                f"'FBA' title misplaced/resized (x={title.x0:.0f}, y={title.y0:.0f}, {title.size:.1f}pt)"
            )
    fields["mixed_badge"] = badge is not None
    if badge is not None:
        claim(badge)
        if not (_near(badge.x0, 246.7, 5) and _near(badge.y0, 14.9, 4) and _near(badge.size, 15, 1.5)):
            problems.append(f"'Mixed' badge misplaced/resized (x={badge.x0:.0f}, y={badge.y0:.0f})")
    if problems:
        checks.append(Check("box.title", "'FBA' title", FAIL, "; ".join(problems), page_no))
    else:
        checks.append(
            Check("box.title", "'FBA' title", PASS, "FBA · Mixed badge" if badge else "FBA", page_no)
        )

    # ---- SHIP FROM / SHIP TO headings
    from_hdr = next((l for l in lines if l.text == "SHIP FROM:" and l.x0 < 150 and l.y0 < 44), None)
    to_hdr = next((l for l in lines if l.text == "SHIP TO:" and l.x0 > 100 and l.y0 < 44), None)
    if from_hdr:
        claim(from_hdr)
    if to_hdr:
        claim(to_hdr)

    # ---- ship from block
    from_lines = [l for l in lines if l.x0 < 150 and 43 <= l.y0 < 86 and l.size >= 7 and not l.used]
    problems = []
    if from_hdr is None or not (_near(from_hdr.x0, 17.3, 3) and _near(from_hdr.y0, 37.4, 3)):
        problems.append("'SHIP FROM:' heading missing or misplaced")
    if not 4 <= len(from_lines) <= 5:
        problems.append(f"expected 4-5 address lines, found {len(from_lines)}")
    else:
        for i, l in enumerate(from_lines):
            claim(l)
            if not (_near(l.x0, 17.3, 3) and _near(l.y0, 45.4 + 8 * i, 3)):
                problems.append(f"line {i + 1} ('{l.text}') is misaligned")
        if not _CITY_STATE_ZIP_RE.match(from_lines[-2].text):
            problems.append(f"'{from_lines[-2].text}' is not 'City, ST ZIP'")
        if from_lines[-1].text != "United States":
            problems.append(f"last line is '{from_lines[-1].text}', expected 'United States'")
    from_text = [l.text for l in from_lines]
    fields["ship_from"] = ", ".join(from_text)
    if problems:
        checks.append(Check("box.ship_from", "Ship From block", FAIL, "; ".join(problems), page_no))
    elif [t.lower() for t in from_text] != [t.lower() for t in REFERENCE_SHIP_FROM]:
        checks.append(
            Check(
                "box.ship_from",
                "Ship From block",
                WARN,
                f"Layout is correct, but Ship From is '{', '.join(from_text)}' — "
                f"the reference labels ship from '{', '.join(REFERENCE_SHIP_FROM)}'.",
                page_no,
            )
        )
    else:
        checks.append(Check("box.ship_from", "Ship From block", PASS, ", ".join(from_text), page_no))

    # ---- ship to block
    to_lines = [l for l in lines if l.x0 >= 150 and 43 <= l.y0 < 86 and l.size >= 7 and not l.used]
    problems = []
    if to_hdr is None or not (_near(to_hdr.x0, 154, 3) and _near(to_hdr.y0, 37.4, 3)):
        problems.append("'SHIP TO:' heading missing or misplaced")
    if not 4 <= len(to_lines) <= 6:
        problems.append(f"expected 4-6 address lines, found {len(to_lines)}")
    else:
        for i, l in enumerate(to_lines):
            claim(l)
            if not (_near(l.x0, 154, 3) and _near(l.y0, 45.4 + 8 * i, 3)):
                problems.append(f"line {i + 1} ('{l.text}') is misaligned")
        if not to_lines[0].text.startswith("FBA:"):
            problems.append(f"first line is '{to_lines[0].text}', expected 'FBA: <name>'")
        if not _CITY_STATE_ZIP_RE.match(to_lines[-2].text):
            problems.append(f"'{to_lines[-2].text}' is not 'City, ST ZIP'")
        if to_lines[-1].text != "United States":
            problems.append(f"last line is '{to_lines[-1].text}', expected 'United States'")
    to_text = [l.text for l in to_lines]
    if to_text:
        fields["ship_to_name"] = to_text[0][4:].strip() if to_text[0].startswith("FBA:") else to_text[0]
        fields["ship_to_address"] = ", ".join(to_text[1:])
    if problems:
        checks.append(Check("box.ship_to", "Ship To block", FAIL, "; ".join(problems), page_no))
    else:
        checks.append(Check("box.ship_to", "Ship To block", PASS, ", ".join(to_text), page_no))

    # ---- black bar: shipment name + created stamp
    strip = [l for l in lines if l.size < 7 and 84 <= l.y0 <= 92]
    name_line = next((l for l in strip if l.x0 < 150), None)
    created_line = next((l for l in strip if l.x0 >= 150), None)
    problems = []
    if name_line is None:
        problems.append("shipment name missing in the black bar")
    else:
        claim(name_line)
        fields["shipment_name"] = name_line.text
        if not _near(name_line.x0, 16.3, 4):
            problems.append("shipment name is misplaced")
    if created_line is None:
        problems.append("'Created:' stamp missing in the black bar")
    else:
        claim(created_line)
        m = _CREATED_RE.match(created_line.text)
        if not m:
            problems.append(f"'{created_line.text}' is not 'Created: YYYY/MM/DD HH:MM TZ (-hh)'")
        else:
            try:
                year, month, day, hour, minute = (int(m.group(i)) for i in range(1, 6))
                datetime(year, month, day, hour, minute)
                fields["created"] = created_line.text[len("Created: ") :]
            except ValueError:
                problems.append(f"'{created_line.text}' is not a valid date/time")
        if not _near(created_line.x1, 287.7, 4):
            problems.append("'Created:' stamp is misplaced")
    if problems:
        checks.append(Check("box.strip", "Shipment name and Created bar", FAIL, "; ".join(problems), page_no))
    else:
        checks.append(
            Check(
                "box.strip",
                "Shipment name and Created bar",
                PASS,
                f"{fields.get('shipment_name', '')} · Created {fields.get('created', '')}",
                page_no,
            )
        )

    # ---- Box ID text
    id_line = next((l for l in lines if 168 <= l.y0 <= 181 and 40 <= l.x0 <= 175 and l.size >= 7 and not l.used), None)
    drawings = page.get_drawings()
    decoded, bar_rect = _decode_barcode(drawings)
    problems = []
    if id_line is None:
        problems.append("Box ID text missing under the barcode")
    else:
        claim(id_line)
        fields["box_id"] = id_line.text
        id_match = _BOX_ID_RE.match(id_line.text)
        if not id_match:
            problems.append(f"'{id_line.text}' is not an FBA Box ID (FBA + 9 characters + U + 6 digits)")
        else:
            fields["shipment_id"] = id_match.group(1)
        center = (id_line.x0 + id_line.x1) / 2.0
        target_center = (bar_rect[0] + bar_rect[2]) / 2.0 if bar_rect else _BARCODE_CENTER_X
        if not _near(center, target_center, 6) or not _near(id_line.y0, 174.4, 4):
            problems.append("Box ID text is not centered under the barcode")
    if problems:
        checks.append(Check("box.box_id", "Box ID text", FAIL, "; ".join(problems), page_no))
    else:
        checks.append(Check("box.box_id", "Box ID text", PASS, id_line.text, page_no))

    # ---- Code 128 barcode matches the text
    if bar_rect is None:
        checks.append(
            Check("box.barcode", "Box ID barcode (Code 128)", FAIL, "Barcode bars not found on the label.", page_no)
        )
    elif decoded is None:
        checks.append(
            Check(
                "box.barcode",
                "Box ID barcode (Code 128)",
                FAIL,
                "Barcode could not be decoded as a valid Code 128 symbol.",
                page_no,
            )
        )
    elif id_line is not None and decoded != id_line.text:
        checks.append(
            Check(
                "box.barcode",
                "Box ID barcode (Code 128)",
                FAIL,
                f"Barcode encodes '{decoded}' but the printed Box ID is '{id_line.text}'.",
                page_no,
            )
        )
    else:
        checks.append(Check("box.barcode", "Box ID barcode (Code 128)", PASS, f"Decodes to {decoded}", page_no))

    # ---- PDF417 image at the right
    images = page.get_image_info()
    problems = []
    if len(images) != 1:
        problems.append(f"expected exactly 1 image (the 2D barcode), found {len(images)}")
    else:
        x0, y0, x1, y1 = images[0]["bbox"]
        if not (214 <= x0 <= 236 and x1 <= 285 and _near(y0, 100, 3) and _near(y1, 220.4, 3)):
            problems.append(
                f"2D barcode is misplaced (x {x0:.0f}-{x1:.0f}, y {y0:.0f}-{y1:.0f}); expected the right-hand column"
            )
    if problems:
        checks.append(Check("box.pdf417", "2D barcode (PDF417) at right", FAIL, "; ".join(problems), page_no))
    else:
        checks.append(Check("box.pdf417", "2D barcode (PDF417) at right", PASS, "Present and aligned", page_no))

    # ---- contents block (Mixed SKUs / Single SKU) + box tag
    content = [l for l in lines if l.x0 >= 100 and 186 <= l.y0 <= 232 and l.size >= 6.5 and not l.used]
    content.sort(key=lambda l: l.y0)
    problems = []
    kind = ""
    if not content:
        problems.append("contents block (Mixed SKUs / Single SKU) missing")
    else:
        for l in content:
            claim(l)
            if not _near(l.x1, 202, 6):
                problems.append(f"'{l.text}' is not right-aligned at the usual position")
        kind = content[0].text
        tag = _BOX_TAG_RE.match(content[-1].text)
        if kind == "Mixed SKUs":
            if len(content) != 2:
                problems.append("'Mixed SKUs' should be followed only by the box tag (e.g. 'P1 - B1')")
        elif kind == "Single SKU":
            qty = _QTY_RE.match(content[-2].text) if len(content) >= 4 else None
            if len(content) < 4 or not qty:
                problems.append("'Single SKU' block should list SKU, 'Qty N' and the box tag")
            elif int(qty.group(1)) < 1:
                problems.append("'Single SKU' quantity must be at least 1")
            else:
                fields["sku"] = " ".join(l.text for l in content[1:-2])
                fields["qty"] = int(qty.group(1))
        else:
            problems.append(f"'{kind}' is neither 'Mixed SKUs' nor 'Single SKU'")
        if not tag:
            problems.append(
                f"'{content[-1].text}' is not a box tag like 'P1 - B1' or '<shipment ID> - B1'"
            )
        else:
            number = int(tag.group(3))
            fields["box_tag"] = content[-1].text
            fields["pack_group"] = f"P{tag.group(1)}" if tag.group(1) else tag.group(2)
            fields["box_number"] = number
            if number < 1:
                problems.append(f"box number in '{content[-1].text}' must be at least B1")
            shipment_id = fields.get("shipment_id")
            if tag.group(2) and shipment_id and tag.group(2) != shipment_id:
                problems.append(
                    f"box tag shipment '{tag.group(2)}' does not match the Box ID shipment '{shipment_id}'"
                )
        if kind in ("Mixed SKUs", "Single SKU"):
            fields["contents"] = kind
    if problems:
        checks.append(Check("box.contents", "Contents and box tag", FAIL, "; ".join(problems), page_no))
    else:
        suffix = f" — SKU {fields['sku']}, Qty {fields['qty']}" if kind == "Single SKU" else ""
        checks.append(
            Check("box.contents", "Contents and box tag", PASS, f"{kind}{suffix} · {fields.get('box_tag', '')}", page_no)
        )

    # ---- header bars and rules
    problems = []
    remaining = [(dr.get("type"), dr["rect"]) for dr in drawings]

    def take(kind_: str, target, tol: float) -> bool:
        hit = next((s for s in remaining if s[0] == kind_ and _rect_close(s[1], target, tol)), None)
        if hit is None:
            return False
        remaining.remove(hit)
        return True

    for kind_, target, tol, what in _EXPECTED_SHAPES:
        if not take(kind_, target, tol):
            problems.append(f"missing {what}")
    if not take("s", _HEADER_RULE_FULL, 2.5):
        halves = [take("s", half, 2.5) for half in _HEADER_RULE_HALVES]
        if not all(halves):
            problems.append("missing header rule under the 'FBA' title")
    if badge is not None and not take("f", _MIXED_BADGE_RECT, 2.5):
        problems.append("missing black background behind the 'Mixed' badge")
    if problems:
        checks.append(Check("box.graphics", "Header bars and divider rules", FAIL, "; ".join(problems), page_no))
    else:
        checks.append(Check("box.graphics", "Header bars and divider rules", PASS, "All present and aligned", page_no))

    # ---- nothing unexpected
    extras = [l.text for l in lines if not l.used]
    extra_text = f"unexpected text: {'; '.join(extras[:4])}" if extras else ""
    extra_shapes = f"{len(remaining)} unexpected graphic element(s)" if remaining else ""
    if extras or remaining:
        checks.append(
            Check(
                "box.extra",
                "No unexpected content on box label",
                WARN,
                " · ".join(x for x in (extra_text, extra_shapes) if x),
                page_no,
            )
        )
    else:
        checks.append(Check("box.extra", "No unexpected content on box label", PASS, "Clean", page_no))


# =========================================================================== box order ("B")
def _mismatches(found: list[Optional[int]], expected: list[int]) -> int:
    return sum(1 for f, e in zip(found, expected) if f is not None and f != e)


def evaluate_box_order(boxes: list[LtlBox]) -> BoxOrder:
    """Check that the box tags run B1, B2, B3, ... in page order.

    If no page is B1 (the PDF looks like a later part of a shipment split across files), the
    expected run starts at the lowest B number instead, and an otherwise correct order is
    reported for review rather than passed. When a shipment has several pack groups
    (P1, P2, ...) and the numbering restarts at B1 in every group, that is also in order.
    """
    order = BoxOrder()
    if not boxes:
        return order
    found = [b.fields.get("box_number") for b in boxes]
    groups = [b.fields.get("pack_group") for b in boxes]
    readable = [n for n in found if n is not None]
    start = min(readable) if readable and min(readable) > 1 else 1

    sequential = [start + i for i in range(len(boxes))]
    seen: Counter = Counter()
    per_group: list[int] = []
    for g in groups:
        seen[g] += 1
        per_group.append(seen[g])

    distinct_groups = {g for g in groups if g}
    expected, mode = sequential, "sequence"
    if _mismatches(found, sequential) and len(distinct_groups) > 1:
        if _mismatches(found, per_group) < _mismatches(found, sequential):
            expected, mode = per_group, "pack_group"
    order.mode = mode
    order.expected_start = start if mode == "sequence" else 1

    for box, num, exp, grp in zip(boxes, found, expected, groups):
        ok = None if num is None else num == exp
        box.fields["expected_box_number"] = exp
        order.entries.append(
            {
                "page": box.page,
                "box_id": box.fields.get("box_id", ""),
                "box_tag": box.fields.get("box_tag", ""),
                "pack_group": grp or "",
                "found": num,
                "expected": exp,
                "ok": ok,
            }
        )

    if mode == "sequence":
        found_counts = Counter(n for n in found if n is not None)
        order.duplicates = sorted(n for n, c in found_counts.items() if c > 1)
        if not any(n is None for n in found):
            order.missing = sorted(set(sequential) - set(found_counts))
    else:
        dup: set[int] = set()
        for g in distinct_groups:
            counts = Counter(n for n, gg in zip(found, groups) if gg == g and n is not None)
            dup.update(n for n, c in counts.items() if c > 1)
        order.duplicates = sorted(dup)
    order.unreadable_pages = [b.page for b, n in zip(boxes, found) if n is None]

    if order.out_of_order or order.duplicates or order.missing:
        order.status = FAIL
    elif order.unreadable_pages or order.expected_start > 1:
        order.status = WARN
    return order


def _order_checks(result: LtlFileResult) -> None:
    order = result.box_order
    if order is None:
        return
    for box, entry in zip(result.boxes, order.entries):
        exp = entry["expected"]
        if entry["found"] is None:
            box.checks.append(
                Check("box.order", "Box order (B number)", WARN, "The box tag B number could not be read.", box.page)
            )
        elif entry["ok"]:
            box.checks.append(
                Check("box.order", "Box order (B number)", PASS, f"B{entry['found']} — in position", box.page)
            )
        else:
            box.checks.append(
                Check(
                    "box.order",
                    "Box order (B number)",
                    FAIL,
                    f"Page {box.page} shows B{entry['found']}, but this position should be B{exp}.",
                    box.page,
                )
            )

    n = len(order.entries)
    label = "Box order — B1, B2, B3, … in page order"
    if order.status != FAIL and not order.unreadable_pages:
        first = order.entries[0]["expected"]
        last = order.entries[-1]["expected"]
        if order.mode == "pack_group":
            detail = f"All {n} boxes in order (numbered from B1 within each pack group)"
        elif n == 1:
            detail = f"B{first}"
        else:
            detail = f"B{first} to B{last} in order ({n} boxes)"
        if order.expected_start > 1:
            detail += (
                f" — but there is no B1: the boxes start at B{order.expected_start}. That is only correct "
                "if this PDF is a later part of a shipment split across several files."
            )
        result.checks.append(Check("file.box_order", label, order.status, detail))
        return

    parts: list[str] = []
    wrong = [e for e in order.entries if e["ok"] is False]
    if wrong:
        examples = ", ".join(f"page {e['page']} shows B{e['found']} (expected B{e['expected']})" for e in wrong[:5])
        more = f", and {len(wrong) - 5} more" if len(wrong) > 5 else ""
        parts.append(f"{len(wrong)} of {n} boxes are out of order: {examples}{more}")
    if order.duplicates:
        parts.append("repeated: " + ", ".join(f"B{d}" for d in order.duplicates[:10]))
    if order.missing:
        parts.append("missing: " + ", ".join(f"B{m}" for m in order.missing[:10]))
    if order.unreadable_pages:
        parts.append("B number unreadable on page(s) " + ", ".join(str(p) for p in order.unreadable_pages[:10]))
    if order.status == FAIL and order.entries and order.entries[0]["ok"] is False:
        parts.insert(0, f"starts with B{order.entries[0]['found']} instead of B{order.entries[0]['expected']}")
    result.checks.append(Check("file.box_order", label, order.status, "; ".join(parts)))


# =========================================================================== file-level checks
def _consistency_check(result: LtlFileResult) -> Optional[Check]:
    if len(result.boxes) < 2:
        return None
    problems: list[str] = []
    for key, what in (
        ("shipment_id", "shipment ID"),
        ("shipment_name", "shipment name"),
        ("ship_to_address", "ship-to address"),
        ("created", "Created stamp"),
    ):
        values = {b.fields.get(key) for b in result.boxes if b.fields.get(key)}
        if len(values) > 1:
            problems.append(f"{len(values)} different {what}s")
    badges = {b.fields.get("mixed_badge") for b in result.boxes if "mixed_badge" in b.fields}
    if len(badges) > 1:
        problems.append("the 'Mixed' badge is on some pages but not others")
    tag_styles = {
        "pack group" if str(b.fields["pack_group"]).startswith("P") else "shipment ID"
        for b in result.boxes
        if b.fields.get("pack_group")
    }
    if len(tag_styles) > 1:
        problems.append("box tags mix 'P# - B#' and '<shipment ID> - B#'")
    label = "All pages belong to one shipment"
    if problems:
        return Check(
            "file.consistency",
            label,
            WARN,
            "; ".join(problems) + " — labels from another shipment may be mixed into this PDF.",
        )
    return Check("file.consistency", label, PASS, f"{len(result.boxes)} pages, one shipment")


def _filename_check(name: str, result: LtlFileResult) -> Optional[Check]:
    m = _FILENAME_RE.match(PurePosixPath(name).stem)
    shipment_id = next((b.fields.get("shipment_id") for b in result.boxes if b.fields.get("shipment_id")), None)
    if not m or not shipment_id:
        return None
    if m.group(1).upper() != shipment_id:
        return Check(
            "file.filename",
            "Filename matches the label",
            WARN,
            f"filename shipment ID {m.group(1).upper()} ≠ label shipment ID {shipment_id}",
        )
    return Check("file.filename", "Filename matches the label", PASS, f"Shipment ID {shipment_id} agrees")


def _thumbnail_png(page) -> str:
    import fitz  # PyMuPDF

    scale = THUMBNAIL_DPI / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY, alpha=False)
    return "data:image/png;base64," + base64.b64encode(pix.tobytes("png")).decode("ascii")


def _thumbnail_pages(result: LtlFileResult) -> list[int]:
    """Pages to preview: problem pages first (in page order), then the first pages."""
    flagged = [b.page for b in result.boxes if b.status != PASS]
    chosen = flagged[:MAX_THUMBNAIL_PAGES]
    for b in result.boxes:
        if len(chosen) >= MAX_THUMBNAIL_PAGES:
            break
        if b.page not in chosen:
            chosen.append(b.page)
    return sorted(chosen)


def _render_thumbnails(doc, result: LtlFileResult) -> None:
    by_page = {b.page: b for b in result.boxes}
    result.thumbnails = []
    for page_no in _thumbnail_pages(result):
        box = by_page[page_no]
        result.thumbnails.append(
            {
                "page": page_no,
                "box_tag": box.fields.get("box_tag", ""),
                "status": box.status,
                "src": _thumbnail_png(doc[page_no - 1]),
            }
        )


def check_pdf_bytes(name: str, raw: bytes, *, path: Optional[str] = None, thumbnails: bool = True) -> LtlFileResult:
    """Run every LTL format check and the box order check on one PDF."""
    import fitz  # PyMuPDF

    result = LtlFileResult(name=name, path=path or name, size_bytes=len(raw))
    try:
        doc = fitz.open(stream=raw, filetype="pdf")
    except Exception as exc:  # noqa: BLE001 — corrupt / not a PDF
        result.checks.append(Check("file.readable", "PDF can be opened", FAIL, f"Not a readable PDF ({exc})."))
        return result
    try:
        if doc.needs_pass or doc.is_encrypted:
            result.checks.append(Check("file.readable", "PDF can be opened", FAIL, "The PDF is password-protected."))
            return result
        result.page_count = doc.page_count
        result.checks.append(Check("file.readable", "PDF can be opened", PASS, f"{doc.page_count} page(s)"))
        if doc.page_count == 0:
            result.checks.append(Check("file.pages", "One box label per page", FAIL, "The PDF has no pages."))
            return result
        if doc.page_count > MAX_PAGES_PER_PDF:
            result.checks.append(
                Check(
                    "file.pages",
                    "One box label per page",
                    FAIL,
                    f"{doc.page_count} pages is more than the {MAX_PAGES_PER_PDF}-page limit; not analyzed.",
                )
            )
            return result
        result.checks.append(
            Check(
                "file.pages",
                "One box label per page",
                PASS,
                f"{doc.page_count} page{'s' if doc.page_count != 1 else ''} = "
                f"{doc.page_count} box{'es' if doc.page_count != 1 else ''}",
            )
        )

        for idx in range(doc.page_count):
            box = LtlBox(index=idx + 1, page=idx + 1)
            _analyze_box_label(doc[idx], idx + 1, box)
            result.boxes.append(box)

        result.box_order = evaluate_box_order(result.boxes)
        _order_checks(result)

        ids = [b.fields.get("box_id") for b in result.boxes if b.fields.get("box_id")]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            result.checks.append(
                Check(
                    "file.duplicate_box",
                    "Box IDs are unique in this PDF",
                    FAIL,
                    "Repeated Box ID(s): " + ", ".join(dupes[:5]),
                )
            )
        consistency = _consistency_check(result)
        if consistency is not None:
            result.checks.append(consistency)
        fname_check = _filename_check(name, result)
        if fname_check is not None:
            result.checks.append(fname_check)

        if thumbnails:
            _render_thumbnails(doc, result)
    finally:
        doc.close()
    return result


def add_thumbnails(result: LtlFileResult, raw: bytes) -> None:
    """Attach page previews to an already-checked file (used for large uploads)."""
    import fitz  # PyMuPDF

    try:
        doc = fitz.open(stream=raw, filetype="pdf")
    except Exception:  # noqa: BLE001 — unreadable PDFs have no preview
        return
    try:
        if not (doc.needs_pass or doc.is_encrypted) and result.boxes and doc.page_count == len(result.boxes):
            _render_thumbnails(doc, result)
    finally:
        doc.close()


# =========================================================================== reorder
_PACK_GROUP_RE = re.compile(r"^P(\d+)$")


@dataclass
class ReorderResult:
    pdf_bytes: bytes
    filename: str
    page_order: list[int]  # source page numbers (1-based) in their new order
    moved_pages: int
    first_box: Optional[int]
    last_box: Optional[int]
    missing: list[int]


def extract_pdf_from_upload(filename: str, raw: bytes, member: Optional[str] = None) -> tuple[str, bytes]:
    """Return ``(name, pdf_bytes)`` for an uploaded ``.pdf``, or for ``member`` of an uploaded ``.zip``."""
    name = (filename or "upload").strip() or "upload"
    if not raw:
        raise LtlLabelFormatCheckerError(f'"{name}" is empty.')
    if len(raw) > MAX_UPLOAD_BYTES:
        raise LtlLabelFormatCheckerError(f'"{name}" is too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).')
    lower = name.lower()
    if lower.endswith(".pdf"):
        if not raw.lstrip()[:5] == b"%PDF-":
            raise LtlLabelFormatCheckerError(f'"{name}" is not a PDF file.')
        return PurePosixPath(name.replace("\\", "/")).name, raw
    if lower.endswith(".zip"):
        if not member:
            raise LtlLabelFormatCheckerError(f'Choose which PDF inside "{name}" to reorder.')
        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile as exc:
            raise LtlLabelFormatCheckerError(f'"{name}" is not a valid ZIP file.') from exc
        with zf:
            info = next(
                (m for m in zf.infolist() if m.filename == member and not m.is_dir()),
                None,
            )
            if info is None or lfc._is_hidden_zip_member(info.filename) or not info.filename.lower().endswith(".pdf"):
                raise LtlLabelFormatCheckerError(f'"{member}" was not found in "{name}".')
            if info.file_size > MAX_PDF_BYTES:
                raise LtlLabelFormatCheckerError(
                    f'"{member}" is larger than {MAX_PDF_BYTES // (1024 * 1024)} MB.'
                )
            try:
                data = zf.read(info)
            except Exception as exc:  # noqa: BLE001 — encrypted / corrupt member
                raise LtlLabelFormatCheckerError(f'"{member}" could not be extracted ({exc}).') from exc
        if not data.lstrip()[:5] == b"%PDF-":
            raise LtlLabelFormatCheckerError(f'"{member}" is not a PDF file.')
        return PurePosixPath(info.filename.replace("\\", "/")).name, data
    raise LtlLabelFormatCheckerError(f'"{name}" is not supported. Upload a .pdf label file or a .zip of them.')


def reordered_filename(name: str) -> str:
    stem = PurePosixPath((name or "labels").replace("\\", "/")).stem or "labels"
    stem = re.sub(r'[\\/:*?"<>|\r\n]+', "_", stem).strip() or "labels"
    return f"{stem}-reordered.pdf"


def reorder_page_indices(order: BoxOrder) -> list[int]:
    """0-based source page indices in B-number order (pack group first when numbering restarts per group)."""
    first_seen: dict[str, int] = {}
    for idx, e in enumerate(order.entries):
        first_seen.setdefault(e["pack_group"], idx)

    def group_rank(group: str) -> tuple[int, int]:
        m = _PACK_GROUP_RE.match(group or "")
        return (0, int(m.group(1))) if m else (1, first_seen.get(group, 0))

    indexed = list(enumerate(order.entries))
    if order.mode == "pack_group":
        indexed.sort(key=lambda item: (group_rank(item[1]["pack_group"]), item[1]["found"], item[0]))
    else:
        indexed.sort(key=lambda item: (item[1]["found"], item[0]))
    return [idx for idx, _ in indexed]


def _page_signature(page) -> tuple:
    """Text, vector and image content of a page — used to prove a page was moved, not changed."""
    return (
        round(page.rect.width, 2),
        round(page.rect.height, 2),
        page.rotation,
        page.get_text("text"),
        len(page.get_drawings()),
        tuple(tuple(round(v, 2) for v in im["bbox"]) for im in page.get_image_info()),
    )


def reorder_pdf_by_box_number(name: str, raw: bytes) -> ReorderResult:
    """Rearrange the pages of an LTL label PDF so the box tags run B1, B2, B3, ...

    Pages are only moved: every page keeps its original content objects, so nothing on any
    label changes. Refuses (``LtlLabelFormatCheckerError``) when the right order cannot be
    decided — a B number that cannot be read, or the same B number on two pages.
    """
    import fitz  # PyMuPDF

    result = check_pdf_bytes(name, raw, thumbnails=False)
    blocking = next((c for c in result.checks if c.id in ("file.readable", "file.pages") and c.status == FAIL), None)
    if blocking is not None:
        raise LtlLabelFormatCheckerError(f'"{name}" cannot be reordered: {blocking.detail}')
    order = result.box_order
    if order is None or not result.boxes:
        raise LtlLabelFormatCheckerError(f'"{name}" has no box label pages to reorder.')
    if order.unreadable_pages:
        raise LtlLabelFormatCheckerError(
            "Cannot reorder: the box tag B number could not be read on page(s) "
            + ", ".join(str(p) for p in order.unreadable_pages[:10])
            + ", so their position is unknown."
        )
    if order.duplicates:
        details = []
        for dup in order.duplicates[:5]:
            pages = [str(e["page"]) for e in order.entries if e["found"] == dup]
            details.append(f"B{dup} (pages {', '.join(pages)})")
        raise LtlLabelFormatCheckerError(
            "Cannot reorder: the same box number is on more than one page — "
            + "; ".join(details)
            + ". Remove the extra label first."
        )

    new_order = reorder_page_indices(order)

    src = fitz.open(stream=raw, filetype="pdf")
    try:
        if src.page_count != len(new_order):
            raise LtlLabelFormatCheckerError(f'"{name}" changed while it was being read; please try again.')
        expected = [_page_signature(src[i]) for i in new_order]
        src.select(new_order)
        pdf_bytes = src.tobytes()
    finally:
        src.close()

    out = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        if out.page_count != len(new_order) or any(
            _page_signature(out[i]) != expected[i] for i in range(out.page_count)
        ):
            raise LtlLabelFormatCheckerError("The reordered PDF did not match the original pages; nothing was produced.")
    finally:
        out.close()

    numbers = [order.entries[i]["found"] for i in new_order]
    return ReorderResult(
        pdf_bytes=pdf_bytes,
        filename=reordered_filename(name),
        page_order=[i + 1 for i in new_order],
        moved_pages=sum(1 for pos, idx in enumerate(new_order) if pos != idx),
        first_box=numbers[0] if numbers else None,
        last_box=numbers[-1] if numbers else None,
        missing=list(order.missing),
    )


# =========================================================================== uploads
def _check_one_upload(filename: str, raw: bytes) -> tuple[str, str, list[LtlFileResult], list[SkippedItem]]:
    """Validate one ``.pdf`` / ``.zip`` and return ``(name, kind, files, skipped)``."""
    name = (filename or "upload").strip() or "upload"
    lower = name.lower()
    if not raw:
        raise LtlLabelFormatCheckerError(f'"{name}" is empty.')
    if len(raw) > MAX_UPLOAD_BYTES:
        raise LtlLabelFormatCheckerError(f'"{name}" is too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).')

    files: list[LtlFileResult] = []
    skipped: list[SkippedItem] = []

    if lower.endswith(".pdf"):
        if not raw.lstrip()[:5] == b"%PDF-":
            raise LtlLabelFormatCheckerError(f'"{name}" is not a PDF file.')
        files.append(check_pdf_bytes(PurePosixPath(name.replace("\\", "/")).name, raw, path=name))
        return name, "pdf", files, skipped

    if lower.endswith(".zip"):
        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile as exc:
            raise LtlLabelFormatCheckerError(f'"{name}" is not a valid ZIP file.') from exc
        with zf:
            pdf_members = []
            for m in zf.infolist():
                if m.is_dir() or lfc._is_hidden_zip_member(m.filename):
                    continue
                if not m.filename.lower().endswith(".pdf"):
                    skipped.append(SkippedItem(m.filename, "Not a PDF — skipped."))
                    continue
                if m.file_size > MAX_PDF_BYTES:
                    skipped.append(
                        SkippedItem(m.filename, f"Larger than {MAX_PDF_BYTES // (1024 * 1024)} MB — skipped.")
                    )
                    continue
                if not PurePosixPath(m.filename.replace("\\", "/")).name:
                    continue
                pdf_members.append(m)
            if not pdf_members:
                raise LtlLabelFormatCheckerError(f'"{name}" does not contain any PDF files.')
            if len(pdf_members) > MAX_PDF_FILES:
                raise LtlLabelFormatCheckerError(
                    f'"{name}" has {len(pdf_members)} PDFs; the limit is {MAX_PDF_FILES} per upload.'
                )
            if sum(m.file_size for m in pdf_members) > MAX_ZIP_UNCOMPRESSED_BYTES:
                raise LtlLabelFormatCheckerError(f'"{name}" is too large once unzipped.')
            preview_all = len(pdf_members) <= THUMBNAIL_ALL_LIMIT
            for m in sorted(pdf_members, key=lambda x: x.filename.lower()):
                short = PurePosixPath(m.filename.replace("\\", "/")).name
                try:
                    data = zf.read(m)
                except Exception as exc:  # noqa: BLE001 — encrypted / corrupt member
                    skipped.append(SkippedItem(m.filename, f"Could not be extracted ({exc})."))
                    continue
                checked = check_pdf_bytes(short, data, path=m.filename, thumbnails=preview_all)
                if not preview_all and checked.status != FILE_PASS:
                    add_thumbnails(checked, data)
                files.append(checked)
        return name, "zip", files, skipped

    raise LtlLabelFormatCheckerError(
        f'"{name}" is not supported. Upload .pdf label files or .zip archives containing .pdf labels.'
    )


def _prefix_batch_paths(source_name: str, kind: str, files: list[LtlFileResult], skipped: list[SkippedItem]) -> None:
    for f in files:
        f.path = f"{source_name}/{f.path}" if kind == "zip" else source_name
    for item in skipped:
        item.name = f"{source_name}/{item.name}" if kind == "zip" else f"{source_name}: {item.name}"


def _flag_duplicate_box_ids(files: list[LtlFileResult]) -> None:
    seen: dict[str, str] = {}
    for f in files:
        repeated: list[str] = []
        for box in f.boxes:
            box_id = box.fields.get("box_id")
            if not box_id:
                continue
            if box_id in seen and seen[box_id] != f.path:
                repeated.append(f"{box_id} (also in {seen[box_id]})")
            else:
                seen.setdefault(box_id, f.path)
        if repeated:
            f.checks.append(
                Check(
                    "file.duplicate",
                    "Box IDs are unique across the upload",
                    WARN,
                    "; ".join(repeated[:3]) + (f"; and {len(repeated) - 3} more" if len(repeated) > 3 else ""),
                )
            )


def check_uploads(items: list[tuple[str, bytes]]) -> LtlCheckRun:
    """Check one or more uploaded ``.pdf`` / ``.zip`` files as a single run."""
    if not items:
        raise LtlLabelFormatCheckerError("No files were uploaded.")
    if len(items) == 1:
        name, kind, files, skipped = _check_one_upload(items[0][0], items[0][1])
        _flag_duplicate_box_ids(files)
        return LtlCheckRun(name, kind, files, skipped, datetime.now().replace(microsecond=0))

    if sum(len(raw) for _, raw in items) > MAX_ZIP_UNCOMPRESSED_BYTES:
        raise LtlLabelFormatCheckerError(
            f"The selected files are too large together (max {MAX_ZIP_UNCOMPRESSED_BYTES // (1024 * 1024)} MB)."
        )
    all_files: list[LtlFileResult] = []
    all_skipped: list[SkippedItem] = []
    names: list[str] = []
    for filename, raw in items:
        name, kind, files, skipped = _check_one_upload(filename, raw)
        _prefix_batch_paths(name, kind, files, skipped)
        names.append(name)
        all_files.extend(files)
        all_skipped.extend(skipped)
    if not all_files and not all_skipped:
        raise LtlLabelFormatCheckerError("No PDF labels were found in the uploaded files.")
    if len(all_files) > MAX_PDF_FILES:
        raise LtlLabelFormatCheckerError(f"The upload has {len(all_files)} PDFs; the limit is {MAX_PDF_FILES} per check.")
    if len(all_files) > THUMBNAIL_ALL_LIMIT:
        for f in all_files:
            if f.status == FILE_PASS:
                f.thumbnails = []
    _flag_duplicate_box_ids(all_files)
    source_name = ", ".join(names) if len(names) <= 3 else f"{names[0]} (+{len(names) - 1} more)"
    return LtlCheckRun(source_name, "batch", all_files, all_skipped, datetime.now().replace(microsecond=0))


# =========================================================================== Excel report
_STATUS_LABEL = {FILE_PASS: "PASS", FILE_REVIEW: "REVIEW", FILE_FAIL: "FAIL"}
_CHECK_STATUS_LABEL = {PASS: "PASS", WARN: "REVIEW", FAIL: "FAIL"}


def _order_label(order: Optional[BoxOrder]) -> str:
    if order is None:
        return ""
    if order.status == PASS:
        return "IN ORDER"
    if order.status == WARN:
        return "REVIEW"
    return "OUT OF ORDER"


def build_report_xlsx(run: LtlCheckRun) -> bytes:
    """Excel report: Summary, one row per PDF, one row per page (box order), one row per check."""
    wb = Workbook()
    summary = run.summary()

    ws = wb.active
    ws.title = "Summary"
    ws.append(["LTL Label Format Checker"])
    ws["A1"].font = Font(bold=True, size=14)
    ws.append([])
    rows = [
        ("Source", run.source_name),
        ("Checked at", run.checked_at.strftime("%Y-%m-%d %H:%M:%S")),
        (
            "Format checked against",
            "Amazon LTL box labels — one 4x6 in box label per page, box tags B1, B2, B3, … in page order",
        ),
        ("PDFs checked", summary["total"]),
        ("Passed", summary["passed"]),
        ("Review (advisory notes)", summary["review"]),
        ("Failed", summary["failed"]),
        ("PDFs with boxes out of order", summary["out_of_order"]),
        ("Skipped (not checked)", summary["skipped"]),
    ]
    for label, value in rows:
        ws.append([label, value])
    for r in range(3, 3 + len(rows)):
        ws.cell(row=r, column=1).font = Font(bold=True)
        ws.cell(row=r, column=2).alignment = Alignment(wrap_text=True, vertical="top", horizontal="left")
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 90
    if run.skipped:
        ws.append([])
        ws.append(["Skipped items"])
        ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
        for item in run.skipped:
            ws.append([item.name, item.reason])

    ws = wb.create_sheet("Results")
    result_rows: list[list[Any]] = []
    for f in run.files:
        first = f.boxes[0].fields if f.boxes else {}
        problems = [f"{c.label}: {c.detail}" for c in f.checks if c.status != PASS]
        failing_pages = [b.page for b in f.boxes if any(c.status != PASS and c.id != "box.order" for c in b.checks)]
        if failing_pages:
            problems.append(
                "Label format issues on page(s) "
                + ", ".join(str(p) for p in failing_pages[:20])
                + (" …" if len(failing_pages) > 20 else "")
                + " — see Check details"
            )
        result_rows.append(
            [
                f.path,
                _STATUS_LABEL[f.status],
                f.page_count,
                len(f.boxes),
                _order_label(f.box_order),
                f.box_order.out_of_order if f.box_order else "",
                first.get("shipment_id", ""),
                first.get("shipment_name", ""),
                first.get("ship_to_name", ""),
                first.get("ship_to_address", ""),
                first.get("created", ""),
                "\n".join(problems),
            ]
        )
    lfc._write_table(
        ws,
        [
            "File", "Status", "Pages", "Boxes", "Box order", "Boxes out of order", "Shipment ID",
            "Shipment name", "Ship to", "Ship-to address", "Created", "Issues",
        ],
        result_rows,
        [46, 10, 7, 7, 14, 10, 16, 30, 20, 44, 26, 90],
        status_col=2,
    )

    ws = wb.create_sheet("Box order")
    order_rows: list[list[Any]] = []
    for f in run.files:
        if f.box_order is None:
            continue
        for e in f.box_order.entries:
            result = "REVIEW" if e["ok"] is None else ("PASS" if e["ok"] else "FAIL")
            order_rows.append(
                [
                    f.path,
                    e["page"],
                    e["box_id"],
                    e["box_tag"],
                    f"B{e['found']}" if e["found"] is not None else "",
                    f"B{e['expected']}",
                    result,
                ]
            )
    lfc._write_table(
        ws,
        ["File", "Page", "Box ID", "Box tag", "Found", "Expected", "Result"],
        order_rows,
        [46, 7, 24, 24, 10, 10, 10],
        status_col=7,
    )

    ws = wb.create_sheet("Check details")
    detail_rows: list[list[Any]] = []
    for f in run.files:
        for c in f.checks:
            detail_rows.append([f.path, "", "File", c.label, _CHECK_STATUS_LABEL[c.status], c.detail])
        for b in f.boxes:
            for c in b.checks:
                detail_rows.append([f.path, b.page, f"Page {b.page}", c.label, _CHECK_STATUS_LABEL[c.status], c.detail])
    lfc._write_table(
        ws,
        ["File", "Page", "Where", "Check", "Result", "Detail"],
        detail_rows,
        [46, 7, 10, 46, 10, 100],
        status_col=5,
    )

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def report_filename(run: LtlCheckRun) -> str:
    stem = PurePosixPath(run.source_name.replace("\\", "/")).stem or "labels"
    stem = re.sub(r'[\\/:*?"<>|\r\n]+', "_", stem).strip() or "labels"
    return f"LTL Label Format Check - {stem}.xlsx"
