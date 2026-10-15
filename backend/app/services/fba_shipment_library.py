"""Parse the official Amazon FBA shipment TSV.

Only the yellow template fields are kept:
Shipment ID, Merchant SKU, external-id, and Shipped.
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from io import StringIO

_UPC_PREFIX = re.compile(r"^UPC:\s*", re.IGNORECASE)


def strip_upc_label(value: str) -> str:
    """Drop a leading ``UPC:`` label so external-id stores the code only."""
    return _UPC_PREFIX.sub("", (value or "").strip()).strip()


STATUS_MISSING = "Missing Items"
STATUS_ACCOUNTED = "All Accounted"
STATUS_OVERAGE = "Overage"
STATUS_NOT_IN_LIST = "Not in the list"


def count_progress(shipped: int, counted: int) -> tuple[int, str]:
    """Missing is what is still left of Shipped. Status follows the scan total."""
    missing = max(0, shipped - counted)
    if counted > shipped:
        return missing, STATUS_OVERAGE
    if counted == shipped:
        return missing, STATUS_ACCOUNTED
    return missing, STATUS_MISSING


def choose_line_for_scan(matches: list[dict]) -> dict:
    """Add the scan to the first matching line that still has units left."""
    ordered = sorted(matches, key=lambda row: int(row.get("line_number") or 0))
    for row in ordered:
        if int(row.get("counted") or 0) < int(row.get("shipped") or 0):
            return row
    return ordered[0]


class FbaShipmentParseError(ValueError):
    """The file is not the official FBA shipment template."""


@dataclass(frozen=True)
class FbaShipmentLine:
    line_number: int
    merchant_sku: str
    external_id: str
    shipped: int


@dataclass(frozen=True)
class ParsedFbaShipment:
    shipment_id: str
    lines: list[FbaShipmentLine]

    @property
    def total_shipped(self) -> int:
        return sum(line.shipped for line in self.lines)


def _decode(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise FbaShipmentParseError("Could not read the file as text. Upload the official .tsv template.")


def _norm_header(value: str) -> str:
    return " ".join((value or "").strip().lower().replace("_", " ").replace("-", " ").split())


def _parse_shipped(raw: str, merchant_sku: str, row_number: int) -> int:
    text = (raw or "").strip().replace(",", "")
    if not text:
        raise FbaShipmentParseError(
            f"Row {row_number} ({merchant_sku}) is missing a Shipped quantity."
        )
    try:
        qty = int(text)
    except ValueError as exc:
        raise FbaShipmentParseError(
            f"Row {row_number} ({merchant_sku}) has a Shipped value that is not a whole number: {raw!r}."
        ) from exc
    if qty < 0:
        raise FbaShipmentParseError(
            f"Row {row_number} ({merchant_sku}) has a negative Shipped quantity."
        )
    return qty


def parse_fba_shipment_tsv(content: bytes) -> ParsedFbaShipment:
    """Read Shipment ID plus Merchant SKU, external-id, and Shipped from each item row."""
    if not content or not content.strip():
        raise FbaShipmentParseError("Uploaded file is empty.")

    text = _decode(content)
    if text.count("\t") < 3 and "Merchant SKU" not in text and "merchant sku" not in text.lower():
        raise FbaShipmentParseError(
            "This file does not look like the official FBA shipment .tsv. "
            "Upload the tab-separated template with Shipment ID, Merchant SKU, external-id, and Shipped."
        )

    rows = list(csv.reader(StringIO(text), delimiter="\t"))
    header_index = None
    columns: dict[str, int] = {}
    for index, row in enumerate(rows):
        normalized = [_norm_header(cell) for cell in row]
        if "merchant sku" in normalized and "shipped" in normalized and "external id" in normalized:
            header_index = index
            columns = {name: pos for pos, name in enumerate(normalized) if name}
            break

    if header_index is None:
        raise FbaShipmentParseError(
            "Could not find the item header row. The official template needs Merchant SKU, external-id, and Shipped."
        )

    shipment_id = ""
    for row in rows[:header_index]:
        if len(row) < 2:
            continue
        if _norm_header(row[0]) == "shipment id":
            shipment_id = (row[1] or "").strip()
            break
    if not shipment_id:
        raise FbaShipmentParseError("Shipment ID is missing from the top of the file.")

    sku_col = columns["merchant sku"]
    external_col = columns["external id"]
    shipped_col = columns["shipped"]
    width = max(sku_col, external_col, shipped_col)

    lines: list[FbaShipmentLine] = []
    for offset, row in enumerate(rows[header_index + 1 :], start=1):
        if not any((cell or "").strip() for cell in row):
            continue
        padded = list(row) + [""] * (width + 1 - len(row))
        merchant_sku = (padded[sku_col] or "").strip()
        if not merchant_sku:
            continue
        external_id = strip_upc_label(padded[external_col] or "")
        shipped = _parse_shipped(padded[shipped_col], merchant_sku, header_index + 1 + offset)
        lines.append(
            FbaShipmentLine(
                line_number=len(lines) + 1,
                merchant_sku=merchant_sku,
                external_id=external_id,
                shipped=shipped,
            )
        )

    if not lines:
        raise FbaShipmentParseError("The file has a Shipment ID but no item rows to store.")

    return ParsedFbaShipment(shipment_id=shipment_id, lines=lines)
