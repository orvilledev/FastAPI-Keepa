"""
Merge Keepa current_sellers with competitive offers (offerCSV / liveOffersOrder).

Keepa often returns a short current_sellers list while offers= includes more live
marketplace rows; we union both (dedupe identical sellerId+price only).

Offer-level "currently active" gates are applied only to entries from offers[]
(not current_sellers) so we don't pull in sellers who are not actually listing
the UPC right now (used/refurb, addon, scam, out of stock, stale). Gates are
permissive when Keepa omits the underlying field. See backend/app/config.py
for the per-gate toggles.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional, Tuple

from app.config import settings

logger = logging.getLogger(__name__)

# Keepa minute timestamps count minutes since 2011-01-01T00:00:00Z.
_KEEPA_EPOCH_UNIX_SECONDS = 1293840000

# Keepa condition codes: 0 = New. Anything else (used, refurb, collectible,
# unknown) cannot meaningfully violate New-product MAP and routinely produces
# false-positive "off-price" rows for non-listings.
_NEW_CONDITION_CODE = 0

# Boolean offer flags that disqualify an offer from off-price comparison.
_DISQUALIFYING_OFFER_FLAGS = ("isPreorder", "isAddonItem", "isScam")


def _now_keepa_minutes() -> int:
    """Current time expressed in Keepa minutes (minutes since Keepa epoch)."""
    return int((time.time() - _KEEPA_EPOCH_UNIX_SECONDS) // 60)


def _offer_condition_is_new(offer: Dict[str, Any]) -> bool:
    """Treat missing condition as New so offers without the field are not lost."""
    cond = offer.get("condition")
    if cond is None:
        return True
    if isinstance(cond, str):
        return cond.strip().lower() == "new"
    try:
        return int(cond) == _NEW_CONDITION_CODE
    except (TypeError, ValueError):
        return False


def _offer_has_disqualifying_flag(offer: Dict[str, Any]) -> bool:
    return any(bool(offer.get(flag)) for flag in _DISQUALIFYING_OFFER_FLAGS)


def _offer_stock_is_zero(offer: Dict[str, Any]) -> bool:
    """stockCSV is [keepaMinute, qty, ...] pairs; last qty == 0 means OOS."""
    stock = offer.get("stockCSV")
    if not isinstance(stock, (list, tuple)) or len(stock) < 2:
        return False
    try:
        return int(stock[-1]) == 0
    except (TypeError, ValueError):
        return False


def _offer_is_fresh(
    offer: Dict[str, Any],
    max_age_minutes: int,
    now_keepa_minutes: Optional[int] = None,
) -> bool:
    """Reject offers whose lastSeen is older than max_age_minutes."""
    if max_age_minutes <= 0:
        return True
    last_seen = offer.get("lastSeen")
    if last_seen is None:
        return True
    try:
        last_seen_int = int(last_seen)
    except (TypeError, ValueError):
        return True
    now = now_keepa_minutes if now_keepa_minutes is not None else _now_keepa_minutes()
    return last_seen_int >= (now - max_age_minutes)


def _offer_is_currently_active(
    offer: Dict[str, Any],
    *,
    require_new_condition: bool,
    drop_disqualifying_flags: bool,
    drop_zero_stock: bool,
    max_age_minutes: int,
    now_keepa_minutes: Optional[int] = None,
) -> bool:
    """Apply per-gate offer eligibility checks. Each gate is independently toggleable."""
    if require_new_condition and not _offer_condition_is_new(offer):
        return False
    if drop_disqualifying_flags and _offer_has_disqualifying_flag(offer):
        return False
    if drop_zero_stock and _offer_stock_is_zero(offer):
        return False
    if max_age_minutes > 0 and not _offer_is_fresh(offer, max_age_minutes, now_keepa_minutes):
        return False
    return True


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

    require_new_condition = bool(getattr(settings, "keepa_offer_require_new_condition", True))
    drop_disqualifying_flags = bool(getattr(settings, "keepa_offer_drop_disqualifying_flags", True))
    drop_zero_stock = bool(getattr(settings, "keepa_offer_drop_zero_stock", True))
    try:
        max_age_minutes = int(getattr(settings, "keepa_offer_max_age_minutes", 0) or 0)
    except (TypeError, ValueError):
        max_age_minutes = 0

    now_keepa = _now_keepa_minutes() if max_age_minutes > 0 else None

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
        if not _offer_is_currently_active(
            offer,
            require_new_condition=require_new_condition,
            drop_disqualifying_flags=drop_disqualifying_flags,
            drop_zero_stock=drop_zero_stock,
            max_age_minutes=max_age_minutes,
            now_keepa_minutes=now_keepa,
        ):
            logger.debug(
                "Filtered offer sellerId=%s condition=%r flags=%s stock=%s lastSeen=%s",
                offer.get("sellerId"),
                offer.get("condition"),
                {f: offer.get(f) for f in _DISQUALIFYING_OFFER_FLAGS},
                offer.get("stockCSV"),
                offer.get("lastSeen"),
            )
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
