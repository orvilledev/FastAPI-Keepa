"""
Tracking Extractor service.

Extracts shipment IDs (text) and UPS tracking numbers (OCR) from a multi-page
shipping-label PDF that follows a strict odd/even structure:

  - Odd pages (1, 3, 5, ...): text-based FBA shipment label
      contains shipment ID like ``FBADNKLA42426`` and FBA box code
      like ``FBA19CJK2PJLU000001``.
  - Even pages (2, 4, 6, ...): image-based UPS shipping label, OCR is
      required to read ``TRACKING #: 1Z...``.

Each odd page is paired with the immediately following even page to produce
a single output row. If only one side of the pair is recoverable, the row
is still emitted with ``status="needs_review"`` so it is never silently lost.
"""
from __future__ import annotations

import io
import logging
import os
import re
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)


# Optional explicit path to the Tesseract binary. Useful on Windows where the
# installer doesn't always add tesseract to PATH (e.g. the UB Mannheim build
# installs to ``C:\Program Files\Tesseract-OCR\tesseract.exe``).
TESSERACT_CMD_ENV = "TESSERACT_CMD"


# ---------------------------------------------------------------------------
# Regex / validators
# ---------------------------------------------------------------------------

# Shipment ID examples seen in the wild: FBADNKLA42426, FBADN2942426-5.
# Use a permissive prefix while still anchoring on FBA + at least 6 alnum.
_SHIPMENT_ID_RE = re.compile(r"\b(FBA[A-Z0-9]{6,}(?:-\d+)?)\b")

# Amazon FBA per-box code: e.g. FBA19CJK2PJLU000001
_BOX_CODE_RE = re.compile(r"\bFBA[A-Z0-9]{8,}U\d{4,}\b")

# UPS tracking line in OCR text. Tolerant to OCR noise (extra spaces, ``:``,
# hash variations) but anchored on the literal ``TRACKING`` keyword.
_UPS_TRACKING_LINE_RE = re.compile(
    r"TRACKING\s*#?\s*:?\s*([A-Z0-9 ]{10,40})",
    re.IGNORECASE,
)

# Generic UPS pattern fallback (1Z + 16 alphanumeric).
_UPS_GENERIC_RE = re.compile(r"\b1Z[0-9A-Z ]{14,25}\b", re.IGNORECASE)


def _normalize_alnum_upper(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def _is_valid_ups_tracking(num: str) -> bool:
    return bool(re.fullmatch(r"1Z[0-9A-Z]{16}", num or ""))


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class ScannedRow:
    """One CSV row corresponding to one (odd, even) page pair."""

    source_file: str
    odd_page: Optional[int]
    even_page: Optional[int]
    vendor: str = ""
    shipment_id: str = ""
    box_code: str = ""
    tracking_number: str = ""
    tracking_number_raw: str = ""
    carrier: str = ""
    status: str = "ok"
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "source_file": self.source_file,
            "odd_page": self.odd_page,
            "even_page": self.even_page,
            "vendor": self.vendor,
            "shipment_id": self.shipment_id,
            "box_code": self.box_code,
            "tracking_number": self.tracking_number,
            "tracking_number_raw": self.tracking_number_raw,
            "carrier": self.carrier,
            "status": self.status,
            "notes": "; ".join(self.notes) if self.notes else "",
        }


# ---------------------------------------------------------------------------
# Page parsing helpers
# ---------------------------------------------------------------------------

def _extract_shipment_id_from_text(text: str) -> Optional[str]:
    if not text:
        return None
    # Prefer the form near "Created:" if present (line layout in our samples).
    for line in text.splitlines():
        m = _SHIPMENT_ID_RE.search(line)
        if not m:
            continue
        candidate = m.group(1)
        # Skip the long box-code form (FBA19...U000001), we want the shipment id.
        if _BOX_CODE_RE.fullmatch(candidate):
            continue
        return candidate
    # Fallback: any FBA shipment id anywhere in the text.
    for m in _SHIPMENT_ID_RE.finditer(text):
        candidate = m.group(1)
        if _BOX_CODE_RE.fullmatch(candidate):
            continue
        return candidate
    return None


def _extract_box_code_from_text(text: str) -> Optional[str]:
    if not text:
        return None
    m = _BOX_CODE_RE.search(text)
    return m.group(0) if m else None


def _extract_vendor_from_text(text: str) -> Optional[str]:
    """Vendor is the first non-empty line after ``SHIP FROM:``."""
    if not text:
        return None
    lines = [ln.strip() for ln in text.splitlines()]
    for idx, line in enumerate(lines):
        if line.upper().startswith("SHIP FROM"):
            for follow in lines[idx + 1 : idx + 4]:
                if follow:
                    return follow
            break
    return None


def _extract_tracking_from_ocr_text(text: str) -> Optional[tuple[str, str]]:
    """Return (raw, normalized) UPS tracking number, or None."""
    if not text:
        return None

    # Pass 1: explicit ``TRACKING #:`` label.
    for line in text.splitlines():
        m = _UPS_TRACKING_LINE_RE.search(line)
        if not m:
            continue
        raw = m.group(1).strip()
        norm = _normalize_alnum_upper(raw)
        if _is_valid_ups_tracking(norm):
            return raw, norm

    # Pass 2: generic 1Z scan over the whole page text.
    for m in _UPS_GENERIC_RE.finditer(text):
        raw = m.group(0).strip()
        norm = _normalize_alnum_upper(raw)
        if _is_valid_ups_tracking(norm):
            return raw, norm

    return None


# ---------------------------------------------------------------------------
# PDF + OCR (lazy imports so module import never fails when OCR isn't ready)
# ---------------------------------------------------------------------------

def _open_pdf(pdf_bytes: bytes):
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise RuntimeError(
            "PyMuPDF is required for PDF parsing. Install with `pip install PyMuPDF`."
        ) from exc
    return fitz.open(stream=pdf_bytes, filetype="pdf")


def _render_page_to_png_bytes(doc, page_index: int, dpi: int = 300) -> bytes:
    page = doc[page_index]
    # 72 dpi is the PDF default; scale matrix = dpi / 72.
    import fitz  # PyMuPDF (already imported via _open_pdf)

    matrix = fitz.Matrix(dpi / 72.0, dpi / 72.0)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    return pix.tobytes("png")


def _ocr_image_bytes_tesseract(png_bytes: bytes) -> str:
    """Run Tesseract OCR on an image; preprocess for stronger label OCR."""
    try:
        import pytesseract
        from PIL import Image, ImageOps
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise RuntimeError(
            "OCR dependencies missing. Install `pytesseract` and `Pillow`, "
            "and ensure the Tesseract binary is on PATH."
        ) from exc

    custom_cmd = (os.getenv(TESSERACT_CMD_ENV) or "").strip()
    if custom_cmd:
        pytesseract.pytesseract.tesseract_cmd = custom_cmd

    img = Image.open(io.BytesIO(png_bytes))
    # Grayscale + autocontrast helps barcode-adjacent text on white labels.
    img = ImageOps.grayscale(img)
    img = ImageOps.autocontrast(img)

    # PSM 6: assume a uniform block of text (ideal for label rows).
    config = "--psm 6"
    try:
        return pytesseract.image_to_string(img, config=config) or ""
    except pytesseract.TesseractNotFoundError as exc:
        raise RuntimeError(
            "Tesseract is not installed or not on PATH. Install Tesseract OCR "
            "and ensure `tesseract` is callable from the shell."
        ) from exc


def _ocr_image_bytes(png_bytes: bytes) -> str:
    return _ocr_image_bytes_tesseract(png_bytes)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_pairs_from_pdf(pdf_bytes: bytes, source_file: str = "") -> List[ScannedRow]:
    """
    Process a PDF in (odd, even) page pairs and return one row per pair.

    The PDF is expected to alternate:
      - odd page: text-based FBA shipment label (shipment_id, box_code, vendor)
      - even page: image-based UPS shipping label (tracking_number)

    Errors during OCR for one pair never abort the whole file; instead the
    row is emitted with ``status="needs_review"`` and a note describing why.
    """
    doc = _open_pdf(pdf_bytes)
    page_count = doc.page_count
    rows: List[ScannedRow] = []

    try:
        for odd_idx in range(0, page_count, 2):
            even_idx = odd_idx + 1 if odd_idx + 1 < page_count else None

            odd_text = doc[odd_idx].get_text() or ""
            shipment_id = _extract_shipment_id_from_text(odd_text) or ""
            box_code = _extract_box_code_from_text(odd_text) or ""
            vendor = _extract_vendor_from_text(odd_text) or ""

            row = ScannedRow(
                source_file=source_file,
                odd_page=odd_idx + 1,
                even_page=(even_idx + 1) if even_idx is not None else None,
                vendor=vendor,
                shipment_id=shipment_id,
                box_code=box_code,
                carrier="UPS" if even_idx is not None else "",
            )

            tracking_pair: Optional[tuple[str, str]] = None
            if even_idx is not None:
                even_page_text_layer = doc[even_idx].get_text() or ""
                tracking_pair = _extract_tracking_from_ocr_text(even_page_text_layer)

                if tracking_pair is None:
                    try:
                        png_bytes = _render_page_to_png_bytes(doc, even_idx, dpi=300)
                        ocr_text = _ocr_image_bytes(png_bytes)
                        tracking_pair = _extract_tracking_from_ocr_text(ocr_text)
                        if tracking_pair is None:
                            row.notes.append("OCR completed but no UPS 1Z number was found.")
                    except RuntimeError as ocr_err:
                        row.notes.append(f"OCR unavailable: {ocr_err}")
                    except Exception as ocr_err:  # pragma: no cover - defensive
                        logger.exception("OCR failure on page %s", even_idx + 1)
                        row.notes.append(f"OCR failed: {ocr_err}")

            if tracking_pair is not None:
                raw, norm = tracking_pair
                row.tracking_number_raw = raw
                row.tracking_number = norm

            if not row.shipment_id and not row.tracking_number:
                row.status = "needs_review"
                row.notes.append("Neither shipment id nor tracking number was found.")
            elif not row.shipment_id:
                row.status = "needs_review"
                row.notes.append("Missing shipment id from odd page.")
            elif not row.tracking_number:
                row.status = "needs_review"
                if not row.notes:
                    row.notes.append("Missing tracking number from even page.")

            rows.append(row)
    finally:
        doc.close()

    return rows


def rows_to_csv_bytes(rows: List[ScannedRow]) -> bytes:
    """Render extracted rows to a UTF-8 CSV byte string."""
    import csv

    buf = io.StringIO()
    writer = csv.DictWriter(
        buf,
        fieldnames=[
            "source_file",
            "odd_page",
            "even_page",
            "vendor",
            "shipment_id",
            "box_code",
            "tracking_number",
            "tracking_number_raw",
            "carrier",
            "status",
            "notes",
        ],
        extrasaction="ignore",
    )
    writer.writeheader()
    for row in rows:
        writer.writerow(row.to_dict())
    return buf.getvalue().encode("utf-8-sig")
