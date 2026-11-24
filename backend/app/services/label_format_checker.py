"""Label Format Checker — validate Amazon FBA *box labels* (Thermal Printing - 4x6 inches).

Each box in an Amazon shipment is downloaded from Seller Central as a 2-page PDF:

* page 1 — the Amazon **box label** (vector text, Code 128 Box ID barcode, PDF417 image)
* page 2 — the **UPS label** (a single full-page raster image)

Both pages are 4.25 x 6 in (306 x 432 pt). This module checks an uploaded PDF (or a ZIP
of PDFs) against that exact format and returns a per-file / per-check result that the
frontend previews and the Excel report summarizes.

Nothing here talks to a database or to the network, and it needs no OCR engine: page 1
is validated from its text layer, geometry and barcode; page 2 (an image) is validated by
comparing its rendered structure to a template learned from real labels
(see ``backend/scripts/build_label_format_template.py``).
"""
from __future__ import annotations

import base64
import io
import logging
import re
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
from pathlib import Path, PurePosixPath
from typing import Any, Optional

import numpy as np
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- limits
MAX_UPLOAD_BYTES = 60 * 1024 * 1024
MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_PDF_FILES = 400
MAX_PAGES_PER_PDF = 60
MAX_ZIP_UNCOMPRESSED_BYTES = 400 * 1024 * 1024
THUMBNAIL_DPI = 72  # 1 px per PDF point: the 8 pt label text stays legible in the preview
MAX_THUMBNAIL_PAGES = 6
THUMBNAIL_ALL_LIMIT = 80

# --------------------------------------------------------------------------- statuses
PASS = "pass"
WARN = "warn"
FAIL = "fail"

FILE_PASS = "pass"
FILE_REVIEW = "review"
FILE_FAIL = "fail"

# --------------------------------------------------------------------------- reference format
# Amazon "Thermal Printing - 4x6 inches" => 306 x 432 pt (4.25 x 6 in).
PAGE_W = 306.0
PAGE_H = 432.0
PAGE_TOL = 2.0

# Reference ship-from (all sample labels). A different ship-from is a *review* item, not a
# format failure, so the tool stays usable for other vendors that use the same layout.
REFERENCE_SHIP_FROM = [
    "DANSKO",
    "10 Five Star Dr",
    "West Grove, PA 19390",
    "United States",
]

_BOX_ID_RE = re.compile(r"^FBA[0-9A-Z]{9}U\d{6}$")
_BOX_LINE_RE = re.compile(r"^Box (\d+) of (\d+) - (\d+(?:\.\d+)?)\s?lbs?$")
_CREATED_RE = re.compile(
    r"^Created: (\d{4})/(\d{2})/(\d{2}) (\d{2}):(\d{2}) ([A-Z]{2,5}) \(([+-]\d{2})\)$"
)
_CITY_STATE_ZIP_RE = re.compile(r"^.+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$")
_VIA_RE = re.compile(r"^([A-Z0-9]{3,5}) via ([A-Za-z]+)$")
_PACK_BOX_RE = re.compile(r"^P(\d+) - B(\d+)$")
_QTY_RE = re.compile(r"^Qty (\d+)$")
_FILENAME_RE = re.compile(r"^(FBA[0-9A-Z]{9})-(.+)$", re.IGNORECASE)
_FOOTER_TEXT = "PLEASE LEAVE THIS LABEL UNCOVERED"

# Expected vector shapes on the box label: (kind, (x0, y0, x1, y1), tolerance)
_EXPECTED_SHAPES = [
    ("f", (10.7, 75.0, 153.0, 81.0), 2.5),  # black strip - shipment name
    ("f", (153.0, 75.0, 295.3, 81.0), 2.5),  # black strip - created stamp
    ("s", (10.7, 21.0, 153.0, 21.0), 2.5),  # header rule left
    ("s", (153.0, 21.0, 295.3, 21.0), 2.5),  # header rule right
    ("s", (10.7, 175.7, 207.1, 175.7), 2.5),  # rule under the Box ID barcode
    ("f", (20.1, 86.0, 197.7, 161.0), 4.0),  # Code 128 barcode block
]
_BARCODE_CENTER_X = (20.1 + 197.7) / 2.0

# --------------------------------------------------------------------------- UPS page template
_TPL_DPI = 100
_TPL_SHAPE = (600, 425)  # rows, cols of a 306 x 432 pt page at 100 dpi
_TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "data" / "label_format_ups_template.npz"

# Regions (x0, y0, x1, y1 in template pixels) holding vendor / shipment-specific text on
# the UPS label. They are excluded from the template so only the fixed UPS structure
# (rules, black square, MaxiCode, barcode frames, datamatrix finders) is compared.
UPS_VARIABLE_ZONES = [
    (30, 5, 160, 48),  # ship-from
    (150, 5, 425, 48),  # weight / piece count / DWT
    (80, 50, 425, 88),  # ship-to
    (150, 113, 385, 147),  # routing text
    (50, 206, 375, 222),  # tracking number text
]
_STATIC_FREQ = 0.97
_ALLOWED_DILATE = 4
# Calibrated by leave-one-out validation on 73 real Amazon labels: genuine labels scored
# coverage >= 0.997, stray <= 0.004, ink 9.5-10.4%. Wrong layouts (shifted 3 px, flipped,
# rotated, the box page used as the UPS page, blank, all-black) scored coverage <= 0.82
# or stray >= 0.05. The limits below keep a wide margin on both sides.
UPS_MIN_COVERAGE = 0.92
UPS_MAX_STRAY = 0.03
UPS_INK_RANGE = (0.05, 0.20)


class LabelFormatCheckerError(Exception):
    """Raised for unusable uploads (wrong type, empty, too large, no PDFs)."""


# =========================================================================== data model
@dataclass
class Check:
    id: str
    label: str
    status: str
    detail: str = ""
    page: Optional[int] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "status": self.status,
            "detail": self.detail,
            "page": self.page,
        }


@dataclass
class BoxResult:
    index: int  # 1-based box position inside the PDF
    box_page: int
    ups_page: Optional[int]
    checks: list[Check] = field(default_factory=list)
    fields: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "box_page": self.box_page,
            "ups_page": self.ups_page,
            "fields": self.fields,
            "checks": [c.to_dict() for c in self.checks],
        }


@dataclass
class FileResult:
    name: str
    path: str
    size_bytes: int
    page_count: int = 0
    checks: list[Check] = field(default_factory=list)  # file-level checks
    boxes: list[BoxResult] = field(default_factory=list)
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
        return {
            "name": self.name,
            "path": self.path,
            "size_bytes": self.size_bytes,
            "page_count": self.page_count,
            "status": self.status,
            "box_count": len(self.boxes),
            "box_id": first.get("box_id", ""),
            "shipment_name": first.get("shipment_name", ""),
            "checks": [c.to_dict() for c in self.checks],
            "boxes": [b.to_dict() for b in self.boxes],
            "thumbnails": self.thumbnails,
            "failed_checks": sum(1 for c in self.all_checks if c.status == FAIL),
            "warning_checks": sum(1 for c in self.all_checks if c.status == WARN),
            "total_checks": len(self.all_checks),
        }


@dataclass
class SkippedItem:
    name: str
    reason: str


@dataclass
class CheckRun:
    source_name: str
    source_kind: str  # "pdf" | "zip" | "batch"
    files: list[FileResult]
    skipped: list[SkippedItem]
    checked_at: datetime

    def summary(self) -> dict[str, Any]:
        return {
            "total": len(self.files),
            "passed": sum(1 for f in self.files if f.status == FILE_PASS),
            "review": sum(1 for f in self.files if f.status == FILE_REVIEW),
            "failed": sum(1 for f in self.files if f.status == FILE_FAIL),
            "skipped": len(self.skipped),
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
def _near(value: float, target: float, tol: float) -> bool:
    return abs(value - target) <= tol


def _fmt_weight(w: float) -> str:
    return f"{w:g}"


@dataclass
class _Line:
    x0: float
    y0: float
    x1: float
    y1: float
    size: float
    text: str
    used: bool = False


def _text_lines(page) -> list[_Line]:
    lines: list[_Line] = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for ln in block.get("lines", []):
            spans = ln.get("spans", [])
            text = "".join(s.get("text", "") for s in spans).strip()
            if not text:
                continue
            x0, y0, x1, y1 = ln["bbox"]
            lines.append(_Line(x0, y0, x1, y1, float(spans[0].get("size", 0.0)), text))
    lines.sort(key=lambda l: (round(l.y0), l.x0))
    return lines


def _rect_close(rect, target, tol: float) -> bool:
    return all(abs(a - b) <= tol for a, b in zip((rect[0], rect[1], rect[2], rect[3]), target))


def _dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """Binary dilation with a square element (separable, numpy only)."""
    if radius <= 0:
        return mask
    h, w = mask.shape
    rows = mask.copy()
    for d in range(1, radius + 1):
        rows[d:, :] |= mask[: h - d, :]
        rows[: h - d, :] |= mask[d:, :]
    both = rows.copy()
    for d in range(1, radius + 1):
        both[:, d:] |= rows[:, : w - d]
        both[:, : w - d] |= rows[:, d:]
    return both


def _zone_mask(shape: tuple[int, int], zones) -> np.ndarray:
    m = np.zeros(shape, dtype=bool)
    for x0, y0, x1, y1 in zones:
        m[y0:y1, x0:x1] = True
    return m


# =========================================================================== Code 128 decoding
_CODE128_PATTERNS = (
    "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 "
    "221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 "
    "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 "
    "212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 "
    "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 "
    "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 "
    "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 "
    "112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 "
    "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 "
    "214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 "
    "114131 311141 411131 211412 211214 211232 2331112"
).split()
_CODE128_LOOKUP = {p: i for i, p in enumerate(_CODE128_PATTERNS)}
_START_A, _START_B, _START_C, _STOP = 103, 104, 105, 106


def decode_code128_widths(widths: list[float]) -> Optional[str]:
    """Decode a Code 128 symbol from alternating bar/space widths (bar first, bar last)."""
    if len(widths) < 6 * 3 + 7 or (len(widths) - 7) % 6 != 0:
        return None
    module = min(widths)
    if module <= 0:
        return None
    mods = [max(1, int(round(w / module))) for w in widths]
    symbols: list[int] = []
    for i in range(0, len(mods) - 7, 6):
        code = _CODE128_LOOKUP.get("".join(str(m) for m in mods[i : i + 6]))
        if code is None:
            return None
        symbols.append(code)
    if _CODE128_LOOKUP.get("".join(str(m) for m in mods[-7:])) != _STOP:
        return None
    start, check, data = symbols[0], symbols[-1], symbols[1:-1]
    if start not in (_START_A, _START_B, _START_C):
        return None
    total = start
    for pos, val in enumerate(data, start=1):
        total += pos * val
    if total % 103 != check:
        return None
    code_set = {_START_A: "A", _START_B: "B", _START_C: "C"}[start]
    out: list[str] = []
    for val in data:
        if val == 99:
            code_set = "C"
        elif val == 100:
            code_set = "B"
        elif val == 101:
            code_set = "A"
        elif val >= 102:
            continue  # FNC / shift - not used on box labels
        elif code_set == "C":
            out.append(f"{val:02d}")
        elif code_set == "B":
            out.append(chr(val + 32))
        else:
            out.append(chr(val + 32) if val < 64 else chr(val - 64))
    return "".join(out)


def _decode_barcode_from_drawings(drawings) -> tuple[Optional[str], Optional[tuple[float, float, float, float]]]:
    """Find the Code 128 bar block on the box label and decode it."""
    for dr in drawings:
        if dr.get("type") != "f":
            continue
        rect = dr["rect"]
        if rect.width < 100 or rect.y0 < 80 or rect.y0 > 100:
            continue
        bars = sorted(
            # Real bars only: tall and non-degenerate (the path also holds zero-width rects).
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


# =========================================================================== UPS template
def render_page_mask(page, dpi: int = _TPL_DPI) -> np.ndarray:
    """Render a page to a boolean ink mask (True = dark pixel)."""
    import fitz  # PyMuPDF

    scale = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY, alpha=False)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, : pix.width]
    return arr < 128


def build_ups_template(masks: list[np.ndarray]) -> dict[str, np.ndarray]:
    """Learn the fixed UPS structure from known-good page-2 ink masks."""
    if not masks:
        raise ValueError("At least one mask is required to build a template.")
    freq = np.mean(np.stack(masks).astype(np.float32), axis=0)
    ignore = _zone_mask(_TPL_SHAPE, UPS_VARIABLE_ZONES)
    static = (freq >= _STATIC_FREQ) & ~ignore
    allowed = _dilate(freq > 0, _ALLOWED_DILATE) | ignore
    return {"static": static, "allowed": allowed}


def save_ups_template(path: Path, template: dict[str, np.ndarray]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        shape=np.array(template["static"].shape),
        static=np.packbits(template["static"]),
        allowed=np.packbits(template["allowed"]),
    )


@lru_cache(maxsize=1)
def _load_ups_template() -> Optional[dict[str, np.ndarray]]:
    if not _TEMPLATE_PATH.exists():
        logger.error("Label Format Checker: UPS template missing at %s", _TEMPLATE_PATH)
        return None
    with np.load(_TEMPLATE_PATH) as data:
        shape = tuple(int(v) for v in data["shape"])
        count = shape[0] * shape[1]
        return {
            "static": np.unpackbits(data["static"])[:count].reshape(shape).astype(bool),
            "allowed": np.unpackbits(data["allowed"])[:count].reshape(shape).astype(bool),
        }


def ups_metrics(mask: np.ndarray, template: dict[str, np.ndarray]) -> dict[str, float]:
    static, allowed = template["static"], template["allowed"]
    covered = (static & _dilate(mask, 1)).sum() / max(int(static.sum()), 1)
    ink = int(mask.sum())
    stray = int((mask & ~allowed).sum()) / max(ink, 1)
    return {"coverage": float(covered), "stray": float(stray), "ink": ink / mask.size}


# =========================================================================== page checks
def _check_page_size(page, label: str, check_id: str, page_no: int) -> Check:
    w, h = page.rect.width, page.rect.height
    rotation = page.rotation
    ok = _near(w, PAGE_W, PAGE_TOL) and _near(h, PAGE_H, PAGE_TOL) and rotation == 0
    detail = f"{w / 72:.2f} x {h / 72:.2f} in ({w:.0f} x {h:.0f} pt)"
    if rotation:
        detail += f", rotated {rotation}°"
    if ok:
        return Check(check_id, label, PASS, detail, page_no)
    return Check(
        check_id,
        label,
        FAIL,
        f"{detail} — expected 4.25 x 6.00 in (306 x 432 pt) portrait, as printed by "
        "Thermal Printing - 4x6 inches",
        page_no,
    )


def _analyze_box_label(page, page_no: int, box: BoxResult) -> None:
    """Validate page 1 of a box (the Amazon box label); appends checks to ``box``."""
    checks = box.checks
    fields = box.fields
    size_check = _check_page_size(page, "Box label page size (4x6 in, portrait)", "box.size", page_no)
    checks.append(size_check)

    lines = _text_lines(page)
    if not lines:
        checks.append(
            Check(
                "box.text",
                "Box label text layer",
                FAIL,
                "No text found on the page. The box label must be Amazon's original vector PDF, "
                "not a scan, screenshot or re-rasterized print.",
                page_no,
            )
        )
        return
    checks.append(Check("box.text", "Box label text layer", PASS, f"{len(lines)} text lines", page_no))

    def claim(line: _Line) -> _Line:
        line.used = True
        return line

    # ---- title + "Box N of M - Xlb"
    title = next((l for l in lines if l.text == "FBA" and l.x0 < 60 and l.y0 < 12), None)
    box_line = next((l for l in lines if l.x0 > 100 and l.y0 < 12 and l.text.startswith("Box ")), None)
    problems: list[str] = []
    if title is None:
        problems.append("'FBA' title missing at top-left")
    else:
        claim(title)
        if not (_near(title.x0, 13, 4) and _near(title.y0, 2, 4) and _near(title.size, 15, 1.5)):
            problems.append(f"'FBA' title misplaced/resized (x={title.x0:.0f}, y={title.y0:.0f}, {title.size:.1f}pt)")
    if box_line is None:
        problems.append("'Box N of M - Xlb' line missing at top-right")
    else:
        claim(box_line)
        m = _BOX_LINE_RE.match(box_line.text)
        if not m:
            problems.append(f"Box line '{box_line.text}' is not 'Box N of M - Xlb'")
        else:
            n, total, weight = int(m.group(1)), int(m.group(2)), float(m.group(3))
            fields.update(box_number=n, box_total=total, weight_lb=weight)
            if n < 1 or total < 1 or n > total:
                problems.append(f"Box numbering '{box_line.text}' is invalid")
            if weight <= 0:
                problems.append("Box weight must be greater than 0 lb")
        if not (_near(box_line.x1, 293, 4) and _near(box_line.y0, 2, 4) and _near(box_line.size, 14.6, 1.5)):
            problems.append(
                f"Box line misplaced/resized (right edge={box_line.x1:.0f}, y={box_line.y0:.0f}, {box_line.size:.1f}pt)"
            )
    if problems:
        checks.append(Check("box.title", "Title and 'Box N of M - Xlb'", FAIL, "; ".join(problems), page_no))
    elif fields.get("weight_lb", 0) > 50:
        checks.append(
            Check(
                "box.title",
                "Title and 'Box N of M - Xlb'",
                WARN,
                f"{box_line.text} — weight is over Amazon's 50 lb box limit",
                page_no,
            )
        )
    else:
        checks.append(Check("box.title", "Title and 'Box N of M - Xlb'", PASS, box_line.text, page_no))

    # ---- SHIP FROM / SHIP TO labels
    from_hdr = next((l for l in lines if l.text == "SHIP FROM:" and l.x0 < 150 and l.y0 < 30), None)
    to_hdr = next((l for l in lines if l.text == "SHIP TO:" and l.x0 > 100 and l.y0 < 30), None)
    if from_hdr:
        claim(from_hdr)
    if to_hdr:
        claim(to_hdr)

    # ---- ship from block
    from_lines = [l for l in lines if l.x0 < 150 and 28 <= l.y0 < 72 and l.size >= 7]
    problems = []
    if from_hdr is None or not (_near(from_hdr.x0, 13, 3) and _near(from_hdr.y0, 23, 3)):
        problems.append("'SHIP FROM:' heading missing or misplaced")
    if not 4 <= len(from_lines) <= 5:
        problems.append(f"expected 4-5 address lines, found {len(from_lines)}")
    else:
        for i, l in enumerate(from_lines):
            claim(l)
            if not (_near(l.x0, 13, 3) and _near(l.y0, 31 + 8 * i, 3)):
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
    to_lines = [l for l in lines if l.x0 >= 150 and 28 <= l.y0 < 72 and l.size >= 7]
    problems = []
    if to_hdr is None or not (_near(to_hdr.x0, 155, 3) and _near(to_hdr.y0, 23, 3)):
        problems.append("'SHIP TO:' heading missing or misplaced")
    if not 4 <= len(to_lines) <= 6:
        problems.append(f"expected 4-6 address lines, found {len(to_lines)}")
    else:
        for i, l in enumerate(to_lines):
            claim(l)
            if not (_near(l.x0, 155, 3) and _near(l.y0, 31 + 8 * i, 3)):
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
        for t in to_text[1:3]:
            via = _VIA_RE.match(t)
            if via:
                fields["fulfillment_center"] = via.group(1)
                fields["carrier_note"] = t
                break
    if problems:
        checks.append(Check("box.ship_to", "Ship To block", FAIL, "; ".join(problems), page_no))
    else:
        checks.append(Check("box.ship_to", "Ship To block", PASS, ", ".join(to_text), page_no))

    # ---- strip: shipment name + created stamp
    strip = [l for l in lines if l.size < 7 and 70 <= l.y0 <= 78]
    name_line = next((l for l in strip if l.x0 < 150), None)
    created_line = next((l for l in strip if l.x0 >= 150), None)
    problems = []
    if name_line is None:
        problems.append("shipment name missing in the black bar")
    else:
        claim(name_line)
        fields["shipment_name"] = name_line.text
        if not _near(name_line.x0, 12, 4):
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
        if not _near(created_line.x1, 294, 4):
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
    id_line = next((l for l in lines if 155 <= l.y0 <= 166 and 55 <= l.x0 <= 170 and l.size >= 7), None)
    drawings = page.get_drawings()
    decoded, bar_rect = _decode_barcode_from_drawings(drawings)
    problems = []
    if id_line is None:
        problems.append("Box ID text missing under the barcode")
    else:
        claim(id_line)
        fields["box_id"] = id_line.text
        if not _BOX_ID_RE.match(id_line.text):
            problems.append(f"'{id_line.text}' is not an FBA Box ID (FBA + 9 characters + U + 6 digits)")
        center = (id_line.x0 + id_line.x1) / 2.0
        target_center = (bar_rect[0] + bar_rect[2]) / 2.0 if bar_rect else _BARCODE_CENTER_X
        if not _near(center, target_center, 6) or not _near(id_line.y0, 160, 4):
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
        checks.append(
            Check("box.barcode", "Box ID barcode (Code 128)", PASS, f"Decodes to {decoded}", page_no)
        )

    # ---- PDF417 image at the right
    images = page.get_image_info()
    problems = []
    if len(images) != 1:
        problems.append(f"expected exactly 1 image (the 2D barcode), found {len(images)}")
    else:
        x0, y0, x1, y1 = images[0]["bbox"]
        if not (220 <= x0 <= 240 and x1 <= 283 and _near(y0, 86, 3) and _near(y1, 206, 3)):
            problems.append(
                f"2D barcode is misplaced (x {x0:.0f}-{x1:.0f}, y {y0:.0f}-{y1:.0f}); expected the right-hand column"
            )
    if problems:
        checks.append(Check("box.pdf417", "2D barcode (PDF417) at right", FAIL, "; ".join(problems), page_no))
    else:
        checks.append(Check("box.pdf417", "2D barcode (PDF417) at right", PASS, "Present and aligned", page_no))

    # ---- contents block (Mixed SKUs / Single SKU) + pack group
    content = [l for l in lines if l.x0 >= 150 and 172 <= l.y0 <= 215 and l.size >= 6.5]
    content.sort(key=lambda l: l.y0)
    problems = []
    kind = ""
    if not content:
        problems.append("contents block (Mixed SKUs / Single SKU) missing")
    else:
        for l in content:
            claim(l)
            if not _near(l.x1, 205, 6):
                problems.append(f"'{l.text}' is not right-aligned at the usual position")
        kind = content[0].text
        pack = _PACK_BOX_RE.match(content[-1].text)
        if kind == "Mixed SKUs":
            if len(content) != 2:
                problems.append("'Mixed SKUs' block should be followed only by the pack group (e.g. 'P1 - B1')")
        elif kind == "Single SKU":
            # Single SKU block: "Single SKU", <SKU line(s)>, "Qty N", "P# - B#"
            qty = _QTY_RE.match(content[-2].text) if len(content) >= 4 else None
            if len(content) < 4 or not qty:
                problems.append("'Single SKU' block should list SKU, 'Qty N' and the pack group")
            elif int(qty.group(1)) < 1:
                problems.append("'Single SKU' quantity must be at least 1")
            else:
                fields["sku"] = " ".join(l.text for l in content[1:-2])
                fields["qty"] = int(qty.group(1))
        else:
            problems.append(f"'{kind}' is neither 'Mixed SKUs' nor 'Single SKU'")
        if not pack:
            problems.append(f"'{content[-1].text}' is not a pack group like 'P1 - B1'")
        else:
            fields["pack_group_box"] = content[-1].text
        if kind in ("Mixed SKUs", "Single SKU"):
            fields["contents"] = kind
    if problems:
        checks.append(Check("box.contents", "Contents and pack group", FAIL, "; ".join(problems), page_no))
    else:
        suffix = f" — SKU {fields['sku']}, Qty {fields['qty']}" if kind == "Single SKU" else ""
        checks.append(
            Check(
                "box.contents",
                "Contents and pack group",
                PASS,
                f"{kind}{suffix} · {fields.get('pack_group_box', '')}",
                page_no,
            )
        )

    # ---- footer text
    footer = next((l for l in lines if l.text == _FOOTER_TEXT), None)
    if footer is None:
        checks.append(
            Check("box.footer", "'PLEASE LEAVE THIS LABEL UNCOVERED'", FAIL, "Footer text missing.", page_no)
        )
    else:
        claim(footer)
        if _near(footer.x0, 73, 5) and _near(footer.y0, 217, 4) and _near(footer.size, 8, 1):
            checks.append(Check("box.footer", "'PLEASE LEAVE THIS LABEL UNCOVERED'", PASS, "Present", page_no))
        else:
            checks.append(
                Check(
                    "box.footer",
                    "'PLEASE LEAVE THIS LABEL UNCOVERED'",
                    FAIL,
                    f"Footer is misplaced (x={footer.x0:.0f}, y={footer.y0:.0f}).",
                    page_no,
                )
            )

    # ---- header bars and rules
    problems = []
    shapes = [(dr.get("type"), dr["rect"]) for dr in drawings]
    remaining = list(shapes)
    for kind_, target, tol in _EXPECTED_SHAPES:
        hit = next((s for s in remaining if s[0] == kind_ and _rect_close(s[1], target, tol)), None)
        if hit is None:
            problems.append(f"missing {'bar' if kind_ == 'f' else 'rule'} near x={target[0]:.0f}, y={target[1]:.0f}")
        else:
            remaining.remove(hit)
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


def _analyze_ups_label(page, page_no: int, box: BoxResult) -> None:
    """Validate page 2 of a box (the UPS shipping label image)."""
    checks = box.checks
    size_check = _check_page_size(page, "UPS label page size (4x6 in, portrait)", "ups.size", page_no)
    checks.append(size_check)

    text = page.get_text().strip()
    images = page.get_image_info()
    drawings = page.get_drawings()
    problems = []
    if text:
        problems.append("page contains text (the UPS label should be a single image)")
    if len(drawings) > 0:
        problems.append(f"page contains {len(drawings)} vector element(s)")
    if len(images) != 1:
        problems.append(f"expected 1 full-page image, found {len(images)}")
    else:
        info = images[0]
        x0, y0, x1, y1 = info["bbox"]
        iw, ih = info.get("width", 0), info.get("height", 0)
        if iw <= 0 or ih <= 0 or abs((iw / ih) - (2 / 3)) > 0.015:
            problems.append(f"image is {iw} x {ih} px; expected a 2:3 (4x6) image")
        if not (_near(x0, 31, 5) and _near(y0, 5, 5) and _near(x1, 275, 5) and _near(y1, 371, 5)):
            problems.append(
                f"image is misplaced/scaled (x {x0:.0f}-{x1:.0f}, y {y0:.0f}-{y1:.0f}); expected x 31-275, y 5-371"
            )
        else:
            box.fields["ups_image_px"] = f"{iw} x {ih}"
    if problems:
        checks.append(Check("ups.image", "UPS label is one full-page image", FAIL, "; ".join(problems), page_no))
    else:
        checks.append(
            Check("ups.image", "UPS label is one full-page image", PASS, f"{box.fields.get('ups_image_px', '')} px image", page_no)
        )

    # ---- structural template comparison
    if size_check.status != PASS:
        checks.append(
            Check(
                "ups.layout",
                "UPS label layout matches Amazon/UPS format",
                FAIL,
                "Not compared because the page size is wrong.",
                page_no,
            )
        )
        return
    template = _load_ups_template()
    if template is None:
        checks.append(
            Check(
                "ups.layout",
                "UPS label layout matches Amazon/UPS format",
                WARN,
                "Layout template is not installed on the server, so the UPS image layout was not compared.",
                page_no,
            )
        )
        return
    mask = render_page_mask(page)
    if mask.shape != template["static"].shape:
        checks.append(
            Check("ups.layout", "UPS label layout matches Amazon/UPS format", FAIL, "Unexpected page raster size.", page_no)
        )
        return
    m = ups_metrics(mask, template)
    problems = []
    if m["coverage"] < UPS_MIN_COVERAGE:
        problems.append(
            f"only {m['coverage'] * 100:.0f}% of the fixed UPS elements (rules, black square, MaxiCode, "
            f"barcode frames) were found (need {UPS_MIN_COVERAGE * 100:.0f}%+)"
        )
    if m["stray"] > UPS_MAX_STRAY:
        problems.append(f"{m['stray'] * 100:.0f}% of the printed ink is outside the normal label areas")
    if not UPS_INK_RANGE[0] <= m["ink"] <= UPS_INK_RANGE[1]:
        problems.append(f"print density {m['ink'] * 100:.1f}% is outside the normal range")
    box.fields["ups_match"] = round(m["coverage"] * 100, 1)
    if problems:
        checks.append(
            Check("ups.layout", "UPS label layout matches Amazon/UPS format", FAIL, "; ".join(problems), page_no)
        )
    else:
        checks.append(
            Check(
                "ups.layout",
                "UPS label layout matches Amazon/UPS format",
                PASS,
                f"{m['coverage'] * 100:.0f}% structural match",
                page_no,
            )
        )


# =========================================================================== file / zip level
def _normalize_name(value: str) -> str:
    return re.sub(r"[\s\-_]+", "", value or "").upper()


def _filename_check(name: str, box: Optional[BoxResult]) -> Optional[Check]:
    stem = PurePosixPath(name).stem
    m = _FILENAME_RE.match(stem)
    if not m or box is None:
        return None
    box_id = box.fields.get("box_id", "")
    shipment = box.fields.get("shipment_name", "")
    problems = []
    if box_id and not box_id.startswith(m.group(1).upper()):
        problems.append(f"filename shipment ID {m.group(1)} ≠ Box ID {box_id[:12]}")
    if shipment and _normalize_name(m.group(2)) != _normalize_name(shipment):
        problems.append(f"filename name '{m.group(2)}' ≠ label shipment name '{shipment}'")
    if problems:
        return Check("file.filename", "Filename matches the label", WARN, "; ".join(problems))
    return Check("file.filename", "Filename matches the label", PASS, "Shipment ID and name agree")


def _thumbnail_png(page) -> str:
    import fitz  # PyMuPDF

    scale = THUMBNAIL_DPI / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY, alpha=False)
    return "data:image/png;base64," + base64.b64encode(pix.tobytes("png")).decode("ascii")


def check_pdf_bytes(name: str, raw: bytes, *, path: Optional[str] = None, thumbnails: bool = True) -> FileResult:
    """Run every format check on one PDF."""
    import fitz  # PyMuPDF

    result = FileResult(name=name, path=path or name, size_bytes=len(raw))
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
            result.checks.append(Check("file.pages", "Box label + UPS label pages", FAIL, "The PDF has no pages."))
            return result
        if doc.page_count > MAX_PAGES_PER_PDF:
            result.checks.append(
                Check(
                    "file.pages",
                    "Box label + UPS label pages",
                    FAIL,
                    f"{doc.page_count} pages is more than the {MAX_PAGES_PER_PDF}-page limit; not analyzed.",
                )
            )
            return result

        pairs = doc.page_count // 2
        if doc.page_count % 2 == 0 and pairs == 1:
            result.checks.append(
                Check("file.pages", "Box label + UPS label pages", PASS, "2 pages: box label, then UPS label")
            )
        elif doc.page_count % 2 == 0:
            result.checks.append(
                Check(
                    "file.pages",
                    "Box label + UPS label pages",
                    PASS,
                    f"{doc.page_count} pages = {pairs} boxes (box label, then UPS label, for each)",
                )
            )
        else:
            result.checks.append(
                Check(
                    "file.pages",
                    "Box label + UPS label pages",
                    FAIL,
                    f"{doc.page_count} pages — every box needs exactly 2 pages (box label + UPS label), so the page "
                    "count must be even. A UPS label may be missing.",
                )
            )

        for idx in range((doc.page_count + 1) // 2):
            box_page_no = idx * 2 + 1
            ups_page_no = box_page_no + 1 if box_page_no + 1 <= doc.page_count else None
            box = BoxResult(index=idx + 1, box_page=box_page_no, ups_page=ups_page_no)
            _analyze_box_label(doc[box_page_no - 1], box_page_no, box)
            if ups_page_no is not None:
                _analyze_ups_label(doc[ups_page_no - 1], ups_page_no, box)
            else:
                box.checks.append(
                    Check("ups.missing", "UPS label page present", FAIL, "No UPS label page follows this box label.", None)
                )
            result.boxes.append(box)

        if len(result.boxes) > 1:
            totals = {b.fields.get("box_total") for b in result.boxes if b.fields.get("box_total")}
            numbers = [b.fields.get("box_number") for b in result.boxes]
            if len(totals) == 1 and numbers == list(range(1, len(result.boxes) + 1)) and totals == {len(result.boxes)}:
                result.checks.append(
                    Check("file.sequence", "Box numbering is sequential", PASS, f"Boxes 1 to {len(result.boxes)}")
                )
            else:
                result.checks.append(
                    Check(
                        "file.sequence",
                        "Box numbering is sequential",
                        WARN,
                        f"Box numbers read {numbers} of {sorted(t for t in totals)} for {len(result.boxes)} boxes in this PDF.",
                    )
                )
            ids = [b.fields.get("box_id") for b in result.boxes if b.fields.get("box_id")]
            if len(ids) != len(set(ids)):
                result.checks.append(
                    Check("file.duplicate_box", "Box IDs are unique in this PDF", FAIL, "The same Box ID appears twice.")
                )

        fname_check = _filename_check(name, result.boxes[0] if result.boxes else None)
        if fname_check is not None:
            result.checks.append(fname_check)

        if thumbnails:
            _render_thumbnails(doc, result)
    finally:
        doc.close()
    return result


def _render_thumbnails(doc, result: FileResult) -> None:
    result.thumbnails = []
    for b in result.boxes:
        for page_no in (b.box_page, b.ups_page):
            if page_no is None or len(result.thumbnails) >= MAX_THUMBNAIL_PAGES:
                continue
            result.thumbnails.append(
                {
                    "page": page_no,
                    "kind": "box" if page_no == b.box_page else "ups",
                    "src": _thumbnail_png(doc[page_no - 1]),
                }
            )


def add_thumbnails(result: FileResult, raw: bytes) -> None:
    """Attach page previews to an already-checked file (used for large uploads)."""
    import fitz  # PyMuPDF

    try:
        doc = fitz.open(stream=raw, filetype="pdf")
    except Exception:  # noqa: BLE001 — unreadable PDFs have no preview
        return
    try:
        if not (doc.needs_pass or doc.is_encrypted) and 0 < doc.page_count <= MAX_PAGES_PER_PDF:
            _render_thumbnails(doc, result)
    finally:
        doc.close()


def _is_hidden_zip_member(path: str) -> bool:
    parts = [p for p in path.replace("\\", "/").split("/") if p]
    return any(p.startswith("._") or p == "__MACOSX" or p == ".DS_Store" for p in parts)


def _check_one_upload(filename: str, raw: bytes) -> tuple[str, str, list[FileResult], list[SkippedItem]]:
    """Validate one ``.pdf`` / ``.zip`` and return ``(name, kind, files, skipped)``.

    Does not flag cross-file duplicate Box IDs — callers do that once on the full set.
    """
    name = (filename or "upload").strip() or "upload"
    lower = name.lower()
    if not raw:
        raise LabelFormatCheckerError(f'"{name}" is empty.')
    if len(raw) > MAX_UPLOAD_BYTES:
        raise LabelFormatCheckerError(
            f'"{name}" is too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).'
        )

    files: list[FileResult] = []
    skipped: list[SkippedItem] = []

    if lower.endswith(".pdf"):
        if not raw.lstrip()[:5] == b"%PDF-":
            raise LabelFormatCheckerError(f'"{name}" is not a PDF file.')
        files.append(check_pdf_bytes(PurePosixPath(name.replace("\\", "/")).name, raw, path=name))
        return name, "pdf", files, skipped

    if lower.endswith(".zip"):
        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile as exc:
            raise LabelFormatCheckerError(f'"{name}" is not a valid ZIP file.') from exc
        with zf:
            members = [m for m in zf.infolist() if not m.is_dir()]
            pdf_members = []
            for m in members:
                short = PurePosixPath(m.filename.replace("\\", "/")).name
                if _is_hidden_zip_member(m.filename):
                    continue
                if not m.filename.lower().endswith(".pdf"):
                    skipped.append(SkippedItem(m.filename, "Not a PDF — skipped."))
                    continue
                if m.file_size > MAX_PDF_BYTES:
                    skipped.append(
                        SkippedItem(m.filename, f"Larger than {MAX_PDF_BYTES // (1024 * 1024)} MB — skipped.")
                    )
                    continue
                if not short:
                    continue
                pdf_members.append(m)
            if not pdf_members:
                raise LabelFormatCheckerError(f'"{name}" does not contain any PDF files.')
            if len(pdf_members) > MAX_PDF_FILES:
                raise LabelFormatCheckerError(
                    f'"{name}" has {len(pdf_members)} PDFs; the limit is {MAX_PDF_FILES} per upload.'
                )
            if sum(m.file_size for m in pdf_members) > MAX_ZIP_UNCOMPRESSED_BYTES:
                raise LabelFormatCheckerError(f'"{name}" is too large once unzipped.')
            # Keep the response a sensible size: every file gets page previews up to
            # THUMBNAIL_ALL_LIMIT PDFs; beyond that only files that need attention do.
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

    raise LabelFormatCheckerError(
        f'"{name}" is not supported. Upload .pdf label files or .zip archives containing .pdf labels.'
    )


def _prefix_batch_paths(
    source_name: str, kind: str, files: list[FileResult], skipped: list[SkippedItem]
) -> None:
    """Make paths unique across a multi-file upload by prefixing with the source filename."""
    for f in files:
        if kind == "zip":
            f.path = f"{source_name}/{f.path}"
        else:
            f.path = source_name
    for item in skipped:
        item.name = f"{source_name}/{item.name}" if kind == "zip" else f"{source_name}: {item.name}"


def _trim_batch_thumbnails(files: list[FileResult]) -> None:
    """Drop page previews for passing files when the batch is large."""
    if len(files) <= THUMBNAIL_ALL_LIMIT:
        return
    for f in files:
        if f.status == FILE_PASS:
            f.thumbnails = []


def check_upload(filename: str, raw: bytes) -> CheckRun:
    """Check an uploaded ``.pdf`` or a ``.zip`` containing PDFs."""
    name, kind, files, skipped = _check_one_upload(filename, raw)
    _flag_duplicate_box_ids(files)
    return CheckRun(
        source_name=name,
        source_kind=kind,
        files=files,
        skipped=skipped,
        checked_at=datetime.now().replace(microsecond=0),
    )


def check_uploads(items: list[tuple[str, bytes]]) -> CheckRun:
    """Check one or more uploaded ``.pdf`` / ``.zip`` files as a single run."""
    if not items:
        raise LabelFormatCheckerError("No files were uploaded.")
    if len(items) == 1:
        return check_upload(items[0][0], items[0][1])

    total_bytes = sum(len(raw) for _, raw in items)
    if total_bytes > MAX_ZIP_UNCOMPRESSED_BYTES:
        raise LabelFormatCheckerError(
            f"The selected files are too large together "
            f"(max {MAX_ZIP_UNCOMPRESSED_BYTES // (1024 * 1024)} MB)."
        )

    all_files: list[FileResult] = []
    all_skipped: list[SkippedItem] = []
    names: list[str] = []

    for filename, raw in items:
        name, kind, files, skipped = _check_one_upload(filename, raw)
        _prefix_batch_paths(name, kind, files, skipped)
        names.append(name)
        all_files.extend(files)
        all_skipped.extend(skipped)

    if not all_files and not all_skipped:
        raise LabelFormatCheckerError("No PDF labels were found in the uploaded files.")
    if len(all_files) > MAX_PDF_FILES:
        raise LabelFormatCheckerError(
            f"The upload has {len(all_files)} PDFs; the limit is {MAX_PDF_FILES} per check."
        )

    _trim_batch_thumbnails(all_files)
    _flag_duplicate_box_ids(all_files)

    if len(names) <= 3:
        source_name = ", ".join(names)
    else:
        source_name = f"{names[0]} (+{len(names) - 1} more)"

    return CheckRun(
        source_name=source_name,
        source_kind="batch",
        files=all_files,
        skipped=all_skipped,
        checked_at=datetime.now().replace(microsecond=0),
    )


def _flag_duplicate_box_ids(files: list[FileResult]) -> None:
    seen: dict[str, str] = {}
    for f in files:
        for box in f.boxes:
            box_id = box.fields.get("box_id")
            if not box_id:
                continue
            if box_id in seen and seen[box_id] != f.path:
                f.checks.append(
                    Check(
                        "file.duplicate",
                        "Box ID is unique across the upload",
                        WARN,
                        f"{box_id} also appears in {seen[box_id]}.",
                    )
                )
            else:
                seen.setdefault(box_id, f.path)


# =========================================================================== Excel report
_STATUS_LABEL = {FILE_PASS: "PASS", FILE_REVIEW: "REVIEW", FILE_FAIL: "FAIL"}
_CHECK_STATUS_LABEL = {PASS: "PASS", WARN: "REVIEW", FAIL: "FAIL"}
_FILLS = {
    "PASS": PatternFill("solid", fgColor="C6EFCE"),
    "REVIEW": PatternFill("solid", fgColor="FFEB9C"),
    "FAIL": PatternFill("solid", fgColor="FFC7CE"),
}
_HEADER_FILL = PatternFill("solid", fgColor="404040")
_HEADER_FONT = Font(bold=True, color="FFFFFF")


def _write_table(ws, headers: list[str], rows: list[list[Any]], widths: list[int], status_col: Optional[int]) -> None:
    ws.append(headers)
    for cell in ws[1]:
        cell.fill = _HEADER_FILL
        cell.font = _HEADER_FONT
        cell.alignment = Alignment(vertical="center")
    for row in rows:
        ws.append(row)
    for i, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.number_format = "@" if isinstance(cell.value, str) else cell.number_format
            cell.alignment = Alignment(vertical="top", wrap_text=True)
        if status_col is not None:
            status_cell = row[status_col - 1]
            fill = _FILLS.get(str(status_cell.value))
            if fill:
                status_cell.fill = fill
                status_cell.font = Font(bold=True)
    if ws.max_row > 1:
        ws.auto_filter.ref = ws.dimensions


def build_report_xlsx(run: CheckRun) -> bytes:
    """Excel report: Summary, one row per PDF, one row per check."""
    wb = Workbook()
    summary = run.summary()

    ws = wb.active
    ws.title = "Summary"
    ws.append(["SPD Label Format Checker"])
    ws["A1"].font = Font(bold=True, size=14)
    ws.append([])
    rows = [
        ("Source", run.source_name),
        ("Checked at", run.checked_at.strftime("%Y-%m-%d %H:%M:%S")),
        ("Format checked against", "Amazon box label — Thermal Printing - 4x6 inches (box label page + UPS label page)"),
        ("PDFs checked", summary["total"]),
        ("Passed", summary["passed"]),
        ("Review (advisory notes)", summary["review"]),
        ("Failed", summary["failed"]),
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
        problems = [
            f"{c.label}: {c.detail}" for c in f.all_checks if c.status != PASS
        ]
        result_rows.append(
            [
                f.path,
                _STATUS_LABEL[f.status],
                f.page_count,
                len(f.boxes),
                first.get("box_id", ""),
                first.get("shipment_name", ""),
                f"Box {first['box_number']} of {first['box_total']}" if first.get("box_number") else "",
                _fmt_weight(first["weight_lb"]) + " lb" if first.get("weight_lb") is not None else "",
                first.get("ship_to_name", ""),
                first.get("fulfillment_center", ""),
                first.get("ship_to_address", ""),
                first.get("created", ""),
                first.get("contents", ""),
                first.get("pack_group_box", ""),
                "\n".join(problems),
            ]
        )
    _write_table(
        ws,
        [
            "File", "Status", "Pages", "Boxes", "Box ID", "Shipment name", "Box", "Weight",
            "Ship to", "FC", "Ship-to address", "Created", "Contents", "Pack group - box", "Issues",
        ],
        result_rows,
        [46, 10, 7, 7, 24, 22, 14, 10, 20, 8, 44, 26, 12, 14, 80],
        status_col=2,
    )

    ws = wb.create_sheet("Check details")
    detail_rows: list[list[Any]] = []
    for f in run.files:
        for c in f.checks:
            detail_rows.append([f.path, "", "File", c.label, _CHECK_STATUS_LABEL[c.status], c.detail])
        for b in f.boxes:
            for c in b.checks:
                where = f"Page {c.page}" if c.page else f"Box {b.index}"
                detail_rows.append([f.path, b.index, where, c.label, _CHECK_STATUS_LABEL[c.status], c.detail])
    _write_table(
        ws,
        ["File", "Box #", "Where", "Check", "Result", "Detail"],
        detail_rows,
        [46, 7, 12, 46, 10, 100],
        status_col=5,
    )

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def report_filename(run: CheckRun) -> str:
    stem = PurePosixPath(run.source_name.replace("\\", "/")).stem or "labels"
    stem = re.sub(r'[\\/:*?"<>|\r\n]+', "_", stem).strip() or "labels"
    return f"SPD Label Format Check - {stem}.xlsx"
