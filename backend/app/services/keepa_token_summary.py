"""Keepa token usage summary for completed Express / API Mode Daily Runs.

Token Load (the degree we use) is spend rate vs the 5-key pool's combined
tokens-per-minute generation. Challenge is that load mapped to 1–5.
Token cost per UPC is Keepa tokens, not dollars.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class KeepaUsageStats:
    processed: int = 0
    tokens_consumed: int = 0
    tokens_estimated: int = 0
    requests: int = 0
    products_returned: int = 0
    refill_rate_samples: list[int] = field(default_factory=list)

    def merge(self, other: "KeepaUsageStats") -> None:
        self.processed += int(other.processed or 0)
        self.tokens_consumed += int(other.tokens_consumed or 0)
        self.tokens_estimated += int(other.tokens_estimated or 0)
        self.requests += int(other.requests or 0)
        self.products_returned += int(other.products_returned or 0)
        self.refill_rate_samples.extend(other.refill_rate_samples or [])

    @property
    def tokens_used(self) -> int:
        if self.tokens_consumed > 0:
            return self.tokens_consumed
        return max(0, self.tokens_estimated)


def estimate_tokens_for_product_request(
    *,
    product_count: int,
    offers_limit: int,
    include_buybox: bool,
) -> int:
    """Keepa product cost: 1/ASIN, +6 per 10-offer page, +2 with buybox."""
    count = max(1, int(product_count or 0))
    per = 1
    if include_buybox:
        per += 2
    offers = max(0, int(offers_limit or 0))
    if offers > 0:
        pages = max(1, math.ceil(offers / 10))
        per += 6 * pages
    return per * count


def classify_token_load(load_ratio: Optional[float]) -> tuple[int, str]:
    """Map spend/generation to degree 1–5."""
    if load_ratio is None or not math.isfinite(load_ratio) or load_ratio < 0:
        return 0, "Unknown"
    pct = load_ratio * 100
    if pct < 40:
        return 1, "Easy"
    if pct < 80:
        return 2, "Comfortable"
    if pct < 110:
        return 3, "Balanced"
    if pct < 160:
        return 4, "Strained"
    return 5, "Overloaded"


def _challenge_note(degree: int) -> str:
    if degree <= 1:
        return "This run sat well under generation. The token bucket should recover quickly."
    if degree == 2:
        return "This run used a moderate share of generation. Headroom remains for another API run."
    if degree == 3:
        return "This run tracked close to generation. The next API run should wait for the bucket to refill."
    if degree == 4:
        return "This run spent faster than the keys refill. The next API run may start with a thinner bucket."
    if degree == 5:
        return "This run heavily overspent generation. Expect waits or 429s until the 5-key pool refills."
    return "Token Load could not be scored for this run."


def pool_tpm_from_meters(meters: Optional[list[dict[str, Any]]]) -> tuple[int, int]:
    """Return (combined TPM, keys that reported a refill rate)."""
    total = 0
    counted = 0
    for row in meters or []:
        if not isinstance(row, dict):
            continue
        rate = row.get("refill_rate")
        try:
            value = int(rate)
        except (TypeError, ValueError):
            continue
        if value <= 0:
            continue
        total += value
        counted += 1
    return total, counted


def build_keepa_run_summary(
    *,
    usage: KeepaUsageStats,
    upc_count: int,
    duration_seconds: float,
    pool_tpm: int,
    pool_keys: int,
    offers_limit: Optional[int] = None,
) -> dict[str, Any]:
    upcs = max(0, int(upc_count or 0))
    tokens_used = int(usage.tokens_used)
    duration = max(1.0, float(duration_seconds or 0.0))
    duration_minutes = duration / 60.0
    spend_tpm = tokens_used / duration_minutes if duration_minutes > 0 else 0.0
    load_ratio: Optional[float] = None
    if pool_tpm > 0:
        load_ratio = spend_tpm / float(pool_tpm)
    degree, degree_label = classify_token_load(load_ratio)
    tokens_per_upc = (tokens_used / upcs) if upcs > 0 else None
    source = "keepa" if usage.tokens_consumed > 0 else "estimate"

    return {
        "tokens_used": tokens_used,
        "tokens_source": source,
        "tokens_per_upc": round(tokens_per_upc, 2) if tokens_per_upc is not None else None,
        "upc_count": upcs,
        "products_returned": int(usage.products_returned or 0),
        "keepa_requests": int(usage.requests or 0),
        "duration_seconds": int(round(duration)),
        "duration_minutes": round(duration_minutes, 2),
        "spend_tpm": round(spend_tpm, 1),
        "pool_tpm": int(pool_tpm),
        "pool_keys": int(pool_keys),
        "token_load_percent": round(load_ratio * 100, 1) if load_ratio is not None else None,
        "token_load_degree": degree,
        "token_load_label": degree_label,
        "offers_limit": offers_limit,
        "challenge_note": _challenge_note(degree),
    }


def format_keepa_run_completion_message(summary: dict[str, Any]) -> str:
    """User-facing completion copy for notifications, email, and the job page."""
    upcs = int(summary.get("upc_count") or 0)
    minutes = summary.get("duration_minutes")
    tokens_used = int(summary.get("tokens_used") or 0)
    per_upc = summary.get("tokens_per_upc")
    source = str(summary.get("tokens_source") or "keepa")
    pool_tpm = int(summary.get("pool_tpm") or 0)
    pool_keys = int(summary.get("pool_keys") or 0)
    spend_tpm = summary.get("spend_tpm")
    load_pct = summary.get("token_load_percent")
    degree = int(summary.get("token_load_degree") or 0)
    label = str(summary.get("token_load_label") or "Unknown")
    note = str(summary.get("challenge_note") or "").strip()

    duration_bit = f" in {minutes} min" if minutes is not None else ""
    per_upc_bit = f"{per_upc:.2f} tokens/UPC" if isinstance(per_upc, (int, float)) else "n/a"
    source_bit = "measured from Keepa" if source == "keepa" else "estimated from request shape"
    load_bit = f"{load_pct}%" if load_pct is not None else "n/a"
    degree_bit = f"{degree} {label}" if degree else label

    lines = [
        f"API run completed: {upcs:,} UPCs processed{duration_bit}.",
        f"Keepa tokens used: {tokens_used:,} ({source_bit}).",
        f"Token cost: {per_upc_bit}.",
        f"Pool generation: {pool_tpm} tokens/min across {pool_keys} key(s).",
        f"Spend rate: {spend_tpm} tokens/min." if spend_tpm is not None else "Spend rate: n/a.",
        f"Token Load: {load_bit} — Degree {degree_bit}.",
    ]
    if note:
        lines.append(note)
    return "\n".join(lines)
