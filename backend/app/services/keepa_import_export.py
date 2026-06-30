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

Goal: produce a row for every UPC like the Keepa desktop export does — as few
blank cells as possible — while keeping token use far below the daily/express
runs. To do that we fetch in two tiers:

    Pass 1 (cheap, all UPCs): ``stats`` + ``buybox`` with ``offers=0`` (see
        ``KeepaClient.fetch_buybox_only``). Keepa returns the buy-box seller id
        and price directly in the product ``stats`` object, plus title/ASIN.
        Costs only a few tokens per UPC (no "6 tokens per 10 offers" surcharge).

    Pass 2 (enrich, only the UPCs still incomplete after pass 1): a moderate
        ``offers`` fetch (default 20) so Keepa returns live seller rows. This
        recovers buy-box seller name/price via the same fallbacks the daily runs
        use (``CSVGenerator.extract_keepa_product_data``): match the buy-box
        seller id against live sellers, else the Amazon/FBA seller, else the
        first seller; price falls back to the lowest live seller price. Pass 2
        runs only for the minority of UPCs a clean buy-box snapshot missed, so
        the extra offer tokens are paid for a small fraction of the list.

The buy-box seller *name* is resolved in this order with zero extra tokens where
possible: Keepa seller name from the response, else the cached ``seller_names``
table (seller id -> name), else the seller id alone.

There is no MAP comparison here — this is a pure Keepa report export. This module
does not touch the scheduler, batch jobs, the import-upload pipeline, or any
shared run state; it only reads the UPC list provided by the caller and calls
Keepa. ``CSVGenerator.extract_keepa_product_data`` is used purely as a read-only
extraction helper.
"""
from __future__ import annotations

import logging
from io import BytesIO
from typing import Any, Dict, List, Optional

from openpyxl import Workbook

from app.services.csv_generator import CSVGenerator
from app.services.keepa_client import MultiKeyKeepaClient

logger = logging.getLogger(__name__)

# Offer count used by the pass-2 enrichment fetch for UPCs a clean buy-box
# snapshot did not fully resolve. 20 is Keepa's minimum when requesting offers
# and is enough to recover the buy-box seller/price via the daily-run fallbacks.
_ENRICH_OFFERS_LIMIT = 20

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


def _extract_buybox_fields(
    keepa_data: Optional[Dict[str, Any]],
    seller_name_map: Dict[str, str],
) -> Dict[str, Any]:
    """Extract the buy-box winner from a Keepa response.

    Reuses ``CSVGenerator.extract_keepa_product_data`` so we get the same
    buy-box resolution the daily runs use: buy-box price/seller from ``stats``,
    then live-seller fallbacks when offers are present (pass 2). The seller
    display name is then resolved Keepa-name -> cached ``seller_names`` map ->
    seller id, so a cached name fills in even when Keepa omits it.
    """
    if not keepa_data or not isinstance(keepa_data, dict):
        return {}

    fields = CSVGenerator.extract_keepa_product_data(keepa_data) or {}
    if not fields:
        return {}

    asin = str(fields.get("asin") or "").strip()
    title = str(fields.get("title") or "").strip()
    seller_id = _normalize_seller_id(fields.get("buy_box_seller_id"))

    seller_name = (fields.get("buy_box_seller_name") or "").strip()
    if seller_name.lower() == "unknown":
        seller_name = ""
    if not seller_name and seller_id:
        seller_name = seller_name_map.get(seller_id, "")

    price = fields.get("buy_box_price")
    try:
        price = float(price) if price is not None else None
        if price is not None and price <= 0:
            price = None
    except (TypeError, ValueError):
        price = None

    return {
        "asin": asin,
        "title": title,
        "buy_box_seller_id": seller_id,
        "buy_box_seller_name": seller_name,
        "buy_box_price": price,
    }


def _completeness_score(fields: Optional[Dict[str, Any]]) -> int:
    """Count how many desktop-export fields are present (higher == more filled)."""
    if not fields:
        return 0
    score = 0
    if fields.get("title"):
        score += 1
    if fields.get("asin"):
        score += 1
    if fields.get("buy_box_price") is not None:
        score += 1
    if fields.get("buy_box_seller_id"):
        score += 1
    if fields.get("buy_box_seller_name"):
        score += 1
    return score


def _is_complete(fields: Optional[Dict[str, Any]]) -> bool:
    """A row is "complete" when it has the core desktop-export buy-box fields.

    We require title, ASIN, a buy-box price, and a buy-box seller id. The seller
    *name* is not required for completeness because it can be filled from the
    cached map and should not, on its own, force a costly pass-2 offers fetch.
    """
    if not fields:
        return False
    return bool(
        fields.get("title")
        and fields.get("asin")
        and fields.get("buy_box_price") is not None
        and fields.get("buy_box_seller_id")
    )


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


async def _run_buybox_pass(
    upcs: List[str],
    name_map: Dict[str, str],
    results: Dict[str, Dict[str, Any]],
) -> None:
    """Pass 1: cheap buy-box-only fetch (offers=0) for every UPC."""
    if not upcs:
        return

    multi_client = MultiKeyKeepaClient()
    items = [{"upc": u} for u in upcs]

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

    await multi_client.process_items_parallel(
        items=items, process_fn=process_fn, offers_limit=0
    )


async def _run_enrich_pass(
    upcs: List[str],
    name_map: Dict[str, str],
    results: Dict[str, Dict[str, Any]],
    offers_limit: int,
) -> None:
    """Pass 2: enrich still-incomplete UPCs with a moderate ``offers`` fetch.

    Only keeps the enriched result when it is at least as filled as the pass-1
    result, so a transient pass-2 failure never overwrites good pass-1 data.
    """
    if not upcs or offers_limit <= 0:
        return

    logger.info(
        "Keepa Import File: enriching %d incomplete UPC(s) with offers=%d",
        len(upcs),
        offers_limit,
    )

    multi_client = MultiKeyKeepaClient()
    items = [{"upc": u} for u in upcs]

    async def process_fn(keepa_client, item) -> bool:
        upc = str(item.get("upc") or "").strip()
        if not upc:
            return False
        try:
            keepa_data = await keepa_client.fetch_product_data(upc)
        except Exception as exc:  # defensive: keep the pass-1 row on failure
            logger.warning("Keepa enrich fetch failed for UPC %s: %s", upc, exc)
            return True

        enriched = _extract_buybox_fields(keepa_data, name_map)
        if _completeness_score(enriched) >= _completeness_score(results.get(upc)):
            results[upc] = enriched
        return True

    await multi_client.process_items_parallel(
        items=items, process_fn=process_fn, offers_limit=offers_limit
    )


async def _fetch_fields_for_upcs(
    upcs: List[str],
    seller_name_map: Optional[Dict[str, str]] = None,
    enrich_offers_limit: int = _ENRICH_OFFERS_LIMIT,
) -> Dict[str, Dict[str, Any]]:
    """Fetch buy-box data per UPC using a cheap pass then an enrich pass.

    Pass 1 hits every UPC with the lean buy-box-only request. Pass 2 re-fetches
    only the UPCs still missing core fields, using a moderate ``offers`` count so
    Keepa's live-seller fallbacks can fill the gaps (closer to the desktop
    export) without paying offer tokens for the whole list. Creates its own
    multi-key client per pass so it never alters shared run state; workers are
    asyncio tasks on a single thread, so dict writes are safe.
    """
    results: Dict[str, Dict[str, Any]] = {}
    name_map = seller_name_map or {}

    await _run_buybox_pass(upcs, name_map, results)

    incomplete = [u for u in upcs if not _is_complete(results.get(u))]
    await _run_enrich_pass(incomplete, name_map, results, enrich_offers_limit)

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
    enrich_offers_limit: int = _ENRICH_OFFERS_LIMIT,
) -> bytes:
    """Fetch buy-box data for ``upcs`` and return an Import Mode-ready .xlsx file.

    ``seller_name_map`` (seller id -> name) fills in the buy-box seller display
    name without spending Keepa tokens. ``enrich_offers_limit`` controls the
    pass-2 offers fetch for UPCs a clean buy-box snapshot missed; set 0 to skip
    enrichment entirely (cheapest, but more blanks).
    """
    fields_by_upc = await _fetch_fields_for_upcs(
        upcs, seller_name_map, enrich_offers_limit=enrich_offers_limit
    )
    return build_workbook_bytes(upcs, fields_by_upc, include_header=include_header)
