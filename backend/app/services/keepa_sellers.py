"""
Merge Keepa current_sellers with competitive offers (offerCSV / liveOffersOrder).

Keepa often returns a short current_sellers list while offers= includes more live
marketplace rows; we union both (dedupe identical sellerId+price only).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def last_list_price_cents_from_offer_csv(csv: Any) -> Optional[int]:
    """
    Latest price from Keepa offerCSV: triplets [time, price_cents, shipping_cents, ...].
    Total list+shipping cents matches keepa.convert_offer_history (values / 100 = dollars).
    """
    if not csv or not isinstance(csv, (list, tuple)):
        return None
    n = len(csv) // 3
    if n < 1:
        return None
    base = (n - 1) * 3
    try:
        price_part = int(csv[base + 1])
        ship_part = int(csv[base + 2])
        total = price_part + ship_part
    except (TypeError, ValueError, IndexError):
        return None
    if total <= 0:
        return None
    return total


def _offer_to_seller_row(offer: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Normalize a Keepa offers[] entry to current_sellers-like shape (price in cents)."""
    csv = offer.get("offerCSV") or offer.get("offerCsv")
    cents = last_list_price_cents_from_offer_csv(csv)
    if cents is None:
        return None

    sid = offer.get("sellerId")
    if sid is None:
        sid = offer.get("seller_id")

    # Leave empty when Keepa omits name so report code can resolve via seller_name_map.
    name = offer.get("sellerName") or offer.get("seller_name") or ""
    if isinstance(name, str):
        name = name.strip()
    else:
        name = str(name).strip() if name else ""

    is_fba = offer.get("isFBA", offer.get("is_fba", False))
    if isinstance(is_fba, (int, str)):
        is_fba = bool(int(is_fba)) if str(is_fba).isdigit() else bool(is_fba)

    cond = offer.get("condition", "New")
    if cond is not None and not isinstance(cond, str):
        cond = str(cond)

    return {
        "sellerId": sid,
        "sellerName": name,
        "price": cents,
        "isFBA": is_fba,
        "condition": cond or "New",
    }


def _row_dedupe_key(row: Dict[str, Any]) -> Optional[Tuple[str, int]]:
    sid = row.get("sellerId")
    if sid is None:
        sid = row.get("seller_id")
    price = row.get("price")
    if price is None:
        return None
    try:
        cents = int(float(price))
    except (TypeError, ValueError):
        return None
    return (str(sid) if sid is not None else "", cents)


def build_unified_seller_list(keepa_response: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Union current_sellers and live competitive offers.

    Deduplicates only exact (sellerId, price_cents) pairs so two different prices
    for the same seller remain two rows.
    """
    if not keepa_response or not isinstance(keepa_response, dict):
        return []

    products = keepa_response.get("products") or []
    if not products:
        return []

    product = products[0]
    seen: set[Tuple[str, int]] = set()
    out: List[Dict[str, Any]] = []

    for seller in product.get("current_sellers") or []:
        if not isinstance(seller, dict):
            continue
        key = _row_dedupe_key(seller)
        if key is None:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(seller)

    offers_list = product.get("offers") or []
    if not offers_list:
        return out

    live_order = product.get("liveOffersOrder") or product.get("live_offers_order")
    if not live_order:
        live_order = list(range(len(offers_list)))

    for idx in live_order:
        try:
            i = int(idx)
        except (TypeError, ValueError):
            continue
        if i < 0 or i >= len(offers_list):
            continue
        offer = offers_list[i]
        if not isinstance(offer, dict):
            continue
        row = _offer_to_seller_row(offer)
        if row is None:
            continue
        key = _row_dedupe_key(row)
        if key is None or key in seen:
            continue
        seen.add(key)
        out.append(row)

    return out
