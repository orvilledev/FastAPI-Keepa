"""Keepa Import Export tool (standalone, read-only).

Fetches the live Keepa **buy-box winner** for a set of UPCs and builds an Excel
file that matches the Keepa desktop export layout consumed by Import Mode. Only
the six columns Import Mode reads are populated, placed at their fixed Excel
positions:

    A (1)  = Imported by Code            -> UPC
    C (3)  = Title                       -> product title
    F (6)  = Buy Box: Buy Box Seller     -> "<seller name> / <seller id>"
    H (8)  = Buy Box: Current            -> buy box price (dollars)
    L (12) = ASIN                        -> product ASIN
    U (21) = URL: Amazon                 -> Amazon product link

Only the buy-box winner is fetched. We call Keepa with ``stats`` + ``buybox``
and ``offers=0`` (see ``KeepaClient.fetch_buybox_only``), so Keepa returns the
buy-box seller id and price directly in the product ``stats`` object without the
per-offer list. This is far cheaper than the offers-based fetch the daily/express
jobs use (no "6 tokens per 10 offers" surcharge) and does not scan competing
sellers. There is no MAP comparison here — this is a pure Keepa report export.

The buy-box seller *name* is resolved from the cached ``seller_names`` table
(seller id -> name) with zero extra Keepa tokens. When a name is not cached, the
seller id alone is written.

This module is deliberately isolated: it does not touch the scheduler, batch
jobs, the import-upload pipeline, or any shared run state. It only reads the
UPC list provided by the caller and calls Keepa.
"""
from __future__ import annotations

import logging
from io import BytesIO
from typing import Any, Dict, List, Optional

from openpyxl import Workbook

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


def _normalize_seller_id(sid: Any) -> str:
    if sid is None:
        return ""
    return str(sid).strip()


def _buybox_price_dollars(stats: Dict[str, Any]) -> Optional[float]:
    """Buy-box price (dollars) from the Keepa stats object. Keepa stores cents."""
    raw = stats.get("buyBoxPrice")
    if raw is None:
        raw = stats.get("buyBoxPriceNew")
    if raw is None:
        return None
    try:
        cents = float(raw)
    except (TypeError, ValueError):
        return None
    if cents <= 0:
        return None
    return cents / 100.0


def _extract_buybox_fields(
    keepa_data: Optional[Dict[str, Any]],
    seller_name_map: Dict[str, str],
) -> Dict[str, Any]:
    """Pull only the buy-box winner from a Keepa buy-box-only response.

    Reads the buy-box seller id and price from ``product.stats`` (populated by
    the ``buybox`` request flag) and resolves the seller display name from the
    cached ``seller_names`` map. No marketplace offers are inspected.
    """
    if not keepa_data or not isinstance(keepa_data, dict):
        return {}

    products = keepa_data.get("products") or []
    if not products:
        return {}

    product = products[0]
    stats = product.get("stats") or {}

    seller_id = _normalize_seller_id(stats.get("buyBoxSellerId"))
    seller_name = seller_name_map.get(seller_id, "") if seller_id else ""

    return {
        "asin": str(product.get("asin") or "").strip(),
        "title": str(product.get("title") or "").strip(),
        "buy_box_seller_id": seller_id,
        "buy_box_seller_name": seller_name,
        "buy_box_price": _buybox_price_dollars(stats),
    }


def _build_row_values(upc: str, fields: Dict[str, Any]) -> Dict[int, str]:
    """Map extracted buy-box fields to fixed Import Mode column positions."""
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

    link = f"https://www.amazon.com/dp/{asin}?psc=1" if asin else ""

    return {
        1: str(upc),
        3: title,
        6: seller_cell,
        8: price_cell,
        12: asin,
        21: link,
    }


async def _fetch_fields_for_upcs(
    upcs: List[str],
    seller_name_map: Optional[Dict[str, str]] = None,
) -> Dict[str, Dict[str, Any]]:
    """Fetch the buy-box winner per UPC using rotating Keepa keys.

    Creates its own multi-key client per call so it never alters shared run
    state, and uses ``fetch_buybox_only`` (offers=0) so each UPC costs only a
    few tokens. Results are collected into a dict keyed by UPC (workers are
    asyncio tasks on a single thread, so dict writes are safe).
    """
    results: Dict[str, Dict[str, Any]] = {}
    name_map = seller_name_map or {}
    items = [{"upc": u} for u in upcs]

    multi_client = MultiKeyKeepaClient()

    async def process_fn(keepa_client, item) -> bool:
        upc = str(item.get("upc") or "").strip()
        if not upc:
            return False
        try:
            keepa_data = await keepa_client.fetch_buybox_only(upc)
        except Exception as exc:  # defensive: never fail the whole file for one UPC
            logger.warning("Keepa buy-box fetch failed for UPC %s: %s", upc, exc)
            keepa_data = None

        results[upc] = _extract_buybox_fields(keepa_data, name_map)
        return True

    # offers_limit=0 keeps the request lean (no offer surcharge) and lets the
    # client pace requests at its minimum delay.
    await multi_client.process_items_parallel(
        items=items, process_fn=process_fn, offers_limit=0
    )
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


async def generate_keepa_import_file(
    upcs: List[str],
    seller_name_map: Optional[Dict[str, str]] = None,
    include_header: bool = True,
) -> bytes:
    """Fetch buy-box data for ``upcs`` and return an Import Mode-ready .xlsx file.

    ``seller_name_map`` (seller id -> name) is used to fill in the buy-box seller
    display name without spending Keepa tokens. Pass an empty/None map to write
    seller ids only.
    """
    fields_by_upc = await _fetch_fields_for_upcs(upcs, seller_name_map)
    return build_workbook_bytes(upcs, fields_by_upc, include_header=include_header)
