"""Validate Import Mode uploads have usable numeric prices.

Import Mode compares column-H prices to MAP. Full Keepa product exports map
Parent ASIN (or similar) into H, so every "price" fails to parse and the run
quietly finishes with 0 MAP hits. Reject those uploads at parse time.
"""
from __future__ import annotations

from typing import List, Optional

# Reject when fewer than this fraction of UPCs have a usable price.
MIN_UPLOADED_PRICE_COVERAGE = 0.05

UPLOADED_PRICE_SCHEMA_HINT = (
    "Import Mode expects fixed columns: A=UPC, C=Title, F=Seller, H=Price (numeric), "
    "L=ASIN, U=Amazon link. Full Keepa product exports are not supported."
)


def positive_uploaded_price(value: object) -> Optional[float]:
    try:
        price = float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
    if price is None or price <= 0:
        return None
    return price


def count_priced_uploaded_upcs(compact_rows: List[dict]) -> int:
    """How many per-UPC entries have at least one usable numeric uploaded_price."""
    priced = 0
    for row in compact_rows:
        if positive_uploaded_price(row.get("uploaded_price")) is not None:
            priced += 1
            continue
        candidates = row.get("uploaded_candidates")
        if not isinstance(candidates, list):
            continue
        if any(
            isinstance(cand, dict) and positive_uploaded_price(cand.get("uploaded_price")) is not None
            for cand in candidates
        ):
            priced += 1
    return priced


def validate_uploaded_price_coverage(compact_rows: List[dict]) -> None:
    """
    Raise ValueError when UPCs were found but almost none have a usable price.
    """
    total = len(compact_rows)
    if total <= 0:
        raise ValueError("No valid UPC values found in uploaded file")

    priced = count_priced_uploaded_upcs(compact_rows)
    coverage = priced / total
    if priced == 0 or coverage < MIN_UPLOADED_PRICE_COVERAGE:
        pct = f"{coverage * 100:.1f}"
        raise ValueError(
            f"Usable prices found for only {priced} of {total} UPCs ({pct}%). "
            f"{UPLOADED_PRICE_SCHEMA_HINT}"
        )
