"""QBOID M2 dimensioner: parse the device's upload and convert its units.

The M2 posts one JSON "dimensioning record" per saved scan (see QBOID's Perceptor
API). Lengths are millimetres and weight is grams. This module is deliberately free
of web and database code so the rules are easy to test:

* ``parse_scan_payload`` turns the raw request body into a ``ParsedScan``.
* ``present_scan`` adds inches / pounds to a stored row for the UI.
* ``api_key_matches`` checks the shared secret the device sends.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

MM_PER_INCH = 25.4
GRAMS_PER_POUND = 453.59237

# Photos are optional on the device (off by default) and are ignored here, but the
# request still has to be read in full so the device gets its 200 reply. This only
# stops an absurd body from filling memory.
MAX_BODY_BYTES = 25 * 1024 * 1024

# A parcel or pallet is never 100 m long or 100 tonnes. Anything beyond these is a
# device fault, so the field is treated as "not measured" instead of stored.
_MAX_DIMENSION_MM = 100_000
_MAX_WEIGHT_G = 100_000_000

_MAX_DEVICE_LEN = 64
_MAX_BARCODE_LEN = 128
_MAX_SHAPE_LEN = 32
_MAX_NOTE_LEN = 1000
_MAX_ATTRIBUTES = 25
_MAX_ATTRIBUTE_LEN = 100

_TIMESTAMP_FORMAT = "%Y/%m/%d %H:%M:%S"
# Postgres text cannot hold NUL, and the other C0 controls are never legitimate in
# a barcode or note. Newline, carriage return and tab are kept.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


class DimensionerPayloadError(ValueError):
    """The request body is not a dimensioning record at all."""


class DimensionerTestInputError(ValueError):
    """A camera test scan had a value that cannot be stored."""


# Shown in the Device column so a webcam trial is obvious next to a real M2 scan.
CAMERA_TEST_DEVICE = "camera-test"


@dataclass(frozen=True)
class ParsedScan:
    device: str
    barcode: str
    length_mm: int | None
    width_mm: int | None
    height_mm: int | None
    weight_g: int | None
    shape: str
    note: str
    attributes: dict[str, str] = field(default_factory=dict)
    scanned_at: datetime | None = None
    dedupe_key: str = ""

    def to_row(self) -> dict[str, Any]:
        """Column values for ``dimensioner_scans`` (``received_at`` is DB-defaulted)."""
        return {
            "dedupe_key": self.dedupe_key,
            "device": self.device,
            "barcode": self.barcode,
            "length_mm": self.length_mm,
            "width_mm": self.width_mm,
            "height_mm": self.height_mm,
            "weight_g": self.weight_g,
            "shape": self.shape,
            "note": self.note,
            "attributes": self.attributes,
            "scanned_at": self.scanned_at.isoformat() if self.scanned_at else None,
        }


# ---------------------------------------------------------------------------
# Field cleaning
# ---------------------------------------------------------------------------


def _clean_text(value: Any, max_len: int) -> str:
    if value is None or isinstance(value, (dict, list)):
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    text = value if isinstance(value, str) else str(value)
    return _CONTROL_CHARS.sub("", text).strip()[:max_len]


def _positive_int(value: Any, maximum: int) -> int | None:
    """A positive whole number, or None for missing / ``-1`` / zero / nonsense."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        try:
            value = float(value.strip())
        except ValueError:
            return None
    if not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    rounded = int(round(number))
    if rounded <= 0 or rounded > maximum:
        return None
    return rounded


def _clean_attributes(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    cleaned: dict[str, str] = {}
    for key, raw in value.items():
        if len(cleaned) >= _MAX_ATTRIBUTES:
            break
        name = _clean_text(key, _MAX_ATTRIBUTE_LEN)
        if name:
            cleaned[name] = _clean_text(raw, _MAX_ATTRIBUTE_LEN)
    return cleaned


def _parse_timestamp(value: Any) -> datetime | None:
    """The device sends ``yyyy/MM/dd HH:mm:ss`` in UTC."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value.strip(), _TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _dedupe_key(
    device: str,
    timestamp_raw: str,
    barcode: str,
    length_mm: int | None,
    width_mm: int | None,
    height_mm: int | None,
    weight_g: int | None,
) -> str:
    """Same record re-sent by the device -> same key. No device time -> never deduped."""
    if not timestamp_raw:
        return f"nots:{uuid.uuid4().hex}"
    parts = [device, timestamp_raw, barcode, length_mm, width_mm, height_mm, weight_g]
    joined = "\x1f".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse_scan_payload(raw: bytes) -> ParsedScan | None:
    """Parse the body the M2 posts.

    Raises ``DimensionerPayloadError`` when the body is not a JSON object. Returns
    ``None`` for a valid object that carries no measurement, weight or barcode, so
    the caller can acknowledge it without storing an empty row.
    """
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise DimensionerPayloadError("Body is not valid JSON.") from exc
    if not isinstance(data, dict):
        raise DimensionerPayloadError("Body must be a JSON object.")

    device = _clean_text(data.get("device"), _MAX_DEVICE_LEN)
    barcode = _clean_text(data.get("barcode"), _MAX_BARCODE_LEN)
    length_mm = _positive_int(data.get("l"), _MAX_DIMENSION_MM)
    width_mm = _positive_int(data.get("w"), _MAX_DIMENSION_MM)
    height_mm = _positive_int(data.get("h"), _MAX_DIMENSION_MM)
    weight_g = _positive_int(data.get("weight"), _MAX_WEIGHT_G)

    if not (barcode or weight_g or length_mm or width_mm or height_mm):
        return None

    timestamp_raw = data.get("timestamp")
    timestamp_text = timestamp_raw.strip() if isinstance(timestamp_raw, str) else ""
    scanned_at = _parse_timestamp(timestamp_raw)

    return ParsedScan(
        device=device,
        barcode=barcode,
        length_mm=length_mm,
        width_mm=width_mm,
        height_mm=height_mm,
        weight_g=weight_g,
        shape=_clean_text(data.get("shape"), _MAX_SHAPE_LEN),
        note=_clean_text(data.get("note"), _MAX_NOTE_LEN),
        attributes=_clean_attributes(data.get("attributes")),
        scanned_at=scanned_at,
        dedupe_key=_dedupe_key(
            device, timestamp_text, barcode, length_mm, width_mm, height_mm, weight_g
        ),
    )


def mm_to_inches(value_mm: int | float | None) -> float | None:
    if value_mm is None:
        return None
    return round(float(value_mm) / MM_PER_INCH, 2)


def grams_to_pounds(value_g: int | float | None) -> float | None:
    if value_g is None:
        return None
    return round(float(value_g) / GRAMS_PER_POUND, 2)


def present_scan(row: dict[str, Any]) -> dict[str, Any]:
    """A stored row as the UI needs it: raw mm / g plus inches / pounds."""
    length_mm = row.get("length_mm")
    width_mm = row.get("width_mm")
    height_mm = row.get("height_mm")
    weight_g = row.get("weight_g")
    attributes = row.get("attributes")
    return {
        "id": str(row.get("id") or ""),
        "device": row.get("device") or "",
        "barcode": row.get("barcode") or "",
        "length_mm": length_mm,
        "width_mm": width_mm,
        "height_mm": height_mm,
        "weight_g": weight_g,
        "length_in": mm_to_inches(length_mm),
        "width_in": mm_to_inches(width_mm),
        "height_in": mm_to_inches(height_mm),
        "weight_lb": grams_to_pounds(weight_g),
        "shape": row.get("shape") or "",
        "note": row.get("note") or "",
        "attributes": attributes if isinstance(attributes, dict) else {},
        "scanned_at": row.get("scanned_at"),
        "received_at": row.get("received_at"),
    }


def _stored_measure(value: Any, *, per_unit: float, maximum: int, label: str) -> int | None:
    """Inches or pounds from the test form, as the millimetres or grams the table stores."""
    if value is None:
        return None
    if isinstance(value, bool) or isinstance(value, (dict, list)):
        raise DimensionerTestInputError(f"{label} must be a number.")
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            value = float(text)
        except ValueError as exc:
            raise DimensionerTestInputError(f"{label} must be a number.") from exc
    if not isinstance(value, (int, float)):
        raise DimensionerTestInputError(f"{label} must be a number.")
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise DimensionerTestInputError(f"{label} must be greater than zero.")
    stored = int(round(number * per_unit))
    if stored <= 0 or stored > maximum:
        raise DimensionerTestInputError(f"{label} is outside the range this page can store.")
    return stored


def build_camera_test_scan(
    *,
    barcode: Any,
    length_in: Any = None,
    width_in: Any = None,
    height_in: Any = None,
    weight_lb: Any = None,
) -> ParsedScan:
    """One practice scan from the Dimensioner page's camera.

    The laptop camera only supplies the barcode. Sizes and weight are whatever the
    tester typed, converted into the same millimetres and grams an M2 would send.
    Each call is its own row, so scanning the same product twice is kept twice.
    """
    cleaned = _clean_text(barcode, _MAX_BARCODE_LEN + 1)
    if not cleaned:
        raise DimensionerTestInputError("Scan or type a barcode first.")
    if len(cleaned) > _MAX_BARCODE_LEN:
        raise DimensionerTestInputError("That barcode is too long.")

    length_mm = _stored_measure(length_in, per_unit=MM_PER_INCH, maximum=_MAX_DIMENSION_MM, label="Length")
    width_mm = _stored_measure(width_in, per_unit=MM_PER_INCH, maximum=_MAX_DIMENSION_MM, label="Width")
    height_mm = _stored_measure(height_in, per_unit=MM_PER_INCH, maximum=_MAX_DIMENSION_MM, label="Height")
    weight_g = _stored_measure(weight_lb, per_unit=GRAMS_PER_POUND, maximum=_MAX_WEIGHT_G, label="Weight")

    return ParsedScan(
        device=CAMERA_TEST_DEVICE,
        barcode=cleaned,
        length_mm=length_mm,
        width_mm=width_mm,
        height_mm=height_mm,
        weight_g=weight_g,
        shape="",
        note="Camera test",
        attributes={},
        scanned_at=datetime.now(timezone.utc),
        dedupe_key=f"nots:{uuid.uuid4().hex}",
    )


def api_key_matches(authorization_header: str | None, configured_key: str | None) -> bool:
    """True when the header carries the configured key, bare or as ``Bearer <key>``.

    The M2 sends whatever text is typed into its "Authorization header" setting, so
    both forms are accepted. An unset key never matches: the receiver stays off.
    """
    expected = (configured_key or "").strip()
    if not expected or not authorization_header:
        return False
    provided = authorization_header.strip()
    if provided.lower().startswith("bearer "):
        provided = provided[7:].strip()
    return hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))
