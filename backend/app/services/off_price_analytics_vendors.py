"""Shared vendor codes for off-price analytics (no DB imports)."""
from typing import List, Tuple

VENDOR_DEFS: List[Tuple[str, str]] = [
    ("dnk", "DNK (Dansko)"),
    ("clk", "CLK (Clarks)"),
    ("obz", "OBZ (Oboz)"),
    ("ref", "REF (Reef)"),
    ("bor", "BOR (Born)"),
    ("sff", "SFF (Sofft)"),
    ("tev", "TEV (Teva)"),
    ("cha", "CHA (Chaco)"),
]

VENDOR_CODES = {code for code, _ in VENDOR_DEFS}
VENDOR_LABELS = {code: label for code, label in VENDOR_DEFS}
