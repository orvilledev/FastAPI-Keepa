"""Keepa Import Export tool (standalone, read-only).

Fetches live Keepa product data for a set of UPCs and builds an Excel file that
matches the Keepa desktop export layout consumed by Import Mode. Only the six
columns Import Mode reads are populated, placed at their fixed Excel positions:

    A (1)  = Imported by Code            -> UPC
    C (3)  = Title                       -> product title
    F (6)  = Buy Box: Buy Box Seller     -> "<seller name> / <seller id>"
    H (8)  = Buy Box: Current            -> buy box price (dollars)
    L (12) = ASIN                        -> product ASIN
    U (21) = URL: Amazon                 -> Amazon product link

This module is deliberately isolated: it does not touch the scheduler, batch
jobs, the import-upload pipeline, or any shared run state. It only reads the
UPC list provided by the caller and calls Keepa. Buy-box field extraction
reuses ``CSVGenerator.extract_keepa_product_data`` as a read-only helper.
"""
from __future__ import annotations

import logging
from io import BytesIO
from typing import Any, Dict, List

from openpyxl import Workbook

from app.services.csv_generator import CSVGenerator
from app.services.keepa_client import MultiKeyKeepaClient

logger = logging.getLogger(__name__)

# Fixed Keepa export schema expected by Import Mode (1-based Excel columns).
_COLUMN_HEADERS: Dict[int, str] = {
    1: "Imported by Code",
    3: "Title",
    6: "Buy Box: Buy Box Seller",
    8: "Buy Box: Current",
    12: "ASIN",
    21: "URL: Amazon",
}
_MAX_COLUMN = 21


def _format_seller_cell(name: str, seller_id: str) -> str:
    """Match the Keepa export form ``<seller name> / <seller id>``."""
    name = (name or "").strip()
    seller_id = (seller_id or "").strip()
    if name and seller_id:
        return f"{name} / {seller_id}"
    return name or seller_id


def _build_row_values(upc: str, fields: Dict[str, Any]) -> Dict[int, str]:
    """Map extracted Keepa fields to fixed Import Mode column positions."""
    asin = str(fields.get("asin") or "").strip()
    title = str(fields.get("title") or "").strip()
    seller_cell = _format_seller_cell(
        fields.get("buy_box_seller_name") or "",
        fields.get("buy_box_seller_id") or "",
    )

    price = fields.get("buy_box_price")
    try:
        price_cell = f"{float(price):.2f}" if price is not None else ""
    except (TypeError, ValueError):
        price_cell = ""

    link = str(fields.get("amazon_link") or "").strip()
    if not link and asin:
        link = f"https://www.amazon.com/dp/{asin}?psc=1"

    return {
        1: str(upc),
        3: title,
        6: seller_cell,
        8: price_cell,
        12: asin,
        21: link,
    }


async def _fetch_fields_for_upcs(upcs: List[str]) -> Dict[str, Dict[str, Any]]:
    """Fetch + extract buy-box fields per UPC using rotating Keepa keys.

    Uses the same multi-key client the daily API runs use, but creates its own
    client instance per call so it never alters shared run state. Results are
    collected into a dict keyed by UPC (workers are asyncio tasks on a single
    thread, so dict writes are safe).
    """
    results: Dict[str, Dict[str, Any]] = {}
    items = [{"upc": u} for u in upcs]

    multi_client = MultiKeyKeepaClient()

    async def process_fn(keepa_client, item) -> bool:
        upc = str(item.get("upc") or "").strip()
        if not upc:
            return False
        try:
            keepa_data = await keepa_client.fetch_product_data(upc)
        except Exception as exc:  # defensive: never fail the whole file for one UPC
            logger.warning("Keepa fetch failed for UPC %s: %s", upc, exc)
            keepa_data = None

        fields = CSVGenerator.extract_keepa_product_data(keepa_data) if keepa_data else {}
        results[upc] = fields or {}
        return True

    await multi_client.process_items_parallel(items=items, process_fn=process_fn)
    return results


def build_workbook_bytes(
    upcs: List[str],
    fields_by_upc: Dict[str, Dict[str, Any]],
    include_header: bool = True,
) -> bytes:
    """Render the Keepa-format Excel workbook to bytes."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Keepa Export"

    if include_header:
        for col in range(1, _MAX_COLUMN + 1):
            ws.cell(row=1, column=col, value=_COLUMN_HEADERS.get(col, ""))

    start_row = 2 if include_header else 1
    for offset, upc in enumerate(upcs):
        row_idx = start_row + offset
        values = _build_row_values(upc, fields_by_upc.get(upc, {}))
        for col, val in values.items():
            ws.cell(row=row_idx, column=col, value=val)

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()


async def generate_keepa_import_file(upcs: List[str], include_header: bool = True) -> bytes:
    """Fetch Keepa data for ``upcs`` and return an Import Mode-ready .xlsx file."""
    fields_by_upc = await _fetch_fields_for_upcs(upcs)
    return build_workbook_bytes(upcs, fields_by_upc, include_header=include_header)
