"""Shared validation for MAP vendor_type and UPC category codes."""
from __future__ import annotations

import re
from typing import Optional

from fastapi import HTTPException

# Lowercase alphanumeric, underscore, hyphen; 1–32 chars; must start with alphanumeric
MAX_VENDOR_CODE_LEN = 32
_VENDOR_CODE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


def normalize_vendor_code(raw: Optional[str]) -> str:
    if raw is None or not str(raw).strip():
        return ""
    return str(raw).strip().lower()


def is_valid_vendor_code(v: str) -> bool:
    if not v or len(v) > MAX_VENDOR_CODE_LEN:
        return False
    return bool(_VENDOR_CODE_RE.match(v))


def validate_vendor_code(raw: str, *, default: Optional[str] = None) -> str:
    """
    Normalize and validate a vendor/category code.

    If raw is empty and default is provided, returns default (also validated).
    """
    v = normalize_vendor_code(raw)
    if not v:
        if default is not None:
            return validate_vendor_code(default, default=None)
        raise HTTPException(
            status_code=400,
            detail=(
                "Vendor or category code is required (1–32 lowercase letters, digits, hyphens, or underscores; "
                "must start with a letter or digit)."
            ),
        )
    if not is_valid_vendor_code(v):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid vendor or category code '{raw}'. "
                "Use 1–32 characters: lowercase letters, digits, hyphens, or underscores; "
                "must start with a letter or digit."
            ),
        )
    return v


def resolve_map_vendor_type(raw: Optional[str]) -> str:
    """
    MAP vendor_type for batch jobs and reports (matches map_prices.vendor_type).
    Blank or invalid values fall back to DEFAULT_MAP_VENDOR_TYPE from app.models.map.
    """
    from app.models.map import DEFAULT_MAP_VENDOR_TYPE

    v = normalize_vendor_code(raw) if raw is not None else ""
    if not v:
        v = normalize_vendor_code(DEFAULT_MAP_VENDOR_TYPE)
    if not is_valid_vendor_code(v):
        v = normalize_vendor_code(DEFAULT_MAP_VENDOR_TYPE) or "dnk"
    return v
