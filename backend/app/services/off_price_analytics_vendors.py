"""Shared vendor codes for off-price analytics (no DB imports)."""
from typing import List, Optional, Tuple

VENDOR_DEFS: List[Tuple[str, str]] = [
    ("dnk", "DNK (Dansko)"),
    ("clk", "CLK (Clarks)"),
    ("obz", "OBZ (Oboz)"),
    ("ref", "REF (Reef)"),
    ("bor", "BOR (Born)"),
    ("sff", "SFF (Sofft)"),
    ("tev", "TEV (Teva)"),
    ("cha", "CHA (Chaco)"),
    ("jfs", "JFS (Josef Siebel)"),
]

VENDOR_CODES = {code for code, _ in VENDOR_DEFS}
VENDOR_LABELS = {code: label for code, label in VENDOR_DEFS}

# Own storefront — never treat as an off-price seller in Analytics.
_EXCLUDED_SELLER_NAME_TOKENS = ("metroshoe",)


def normalize_seller_name(raw: Optional[str]) -> str:
    """Lowercase alphanumerics only (e.g. 'MetroShoe Warehouse' -> 'metroshoewarehouse')."""
    if not raw:
        return ""
    return "".join(ch.lower() for ch in str(raw) if ch.isalnum())


def is_excluded_analytics_seller(seller_name: Optional[str]) -> bool:
    """True for MetroShoe Warehouse (and name variants)."""
    normalized = normalize_seller_name(seller_name)
    if not normalized:
        return False
    return any(token in normalized for token in _EXCLUDED_SELLER_NAME_TOKENS)
