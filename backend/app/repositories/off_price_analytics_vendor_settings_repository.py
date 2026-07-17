"""Per-vendor off-price analytics tracking toggles."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from supabase import Client

from app.services.off_price_analytics_vendors import VENDOR_CODES, VENDOR_DEFS


class OffPriceAnalyticsVendorSettingsRepository:
    table = "off_price_analytics_vendor_settings"

    def __init__(self, db: Client):
        self.db = db

    def list_settings(self) -> List[Dict[str, Any]]:
        """Return one row per known vendor (defaults tracking_enabled=True if missing)."""
        by_code: Dict[str, Dict[str, Any]] = {}
        try:
            response = self.db.table(self.table).select("*").execute()
            for row in response.data or []:
                code = (row.get("vendor_code") or "").strip().lower()
                if code in VENDOR_CODES:
                    by_code[code] = row
        except Exception:
            # Table may not exist until migration is applied.
            by_code = {}

        out: List[Dict[str, Any]] = []
        for code, name in VENDOR_DEFS:
            row = by_code.get(code)
            out.append(
                {
                    "vendor_code": code,
                    "vendor_name": name,
                    "tracking_enabled": True if row is None else bool(row.get("tracking_enabled", True)),
                    "updated_at": row.get("updated_at") if row else None,
                    "updated_by": str(row.get("updated_by")) if row and row.get("updated_by") else None,
                }
            )
        return out

    def get_tracking_map(self) -> Dict[str, bool]:
        return {
            row["vendor_code"]: bool(row["tracking_enabled"])
            for row in self.list_settings()
        }

    def set_tracking(
        self,
        vendor_code: str,
        enabled: bool,
        *,
        updated_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        code = (vendor_code or "").strip().lower()
        if code not in VENDOR_CODES:
            raise ValueError(f"Unknown vendor code: {vendor_code}")

        payload: Dict[str, Any] = {
            "vendor_code": code,
            "tracking_enabled": bool(enabled),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if updated_by:
            payload["updated_by"] = updated_by

        response = (
            self.db.table(self.table)
            .upsert(payload, on_conflict="vendor_code")
            .execute()
        )
        data = (response.data or [None])[0] or payload
        name = next((n for c, n in VENDOR_DEFS if c == code), code.upper())
        return {
            "vendor_code": code,
            "vendor_name": name,
            "tracking_enabled": bool(data.get("tracking_enabled", enabled)),
            "updated_at": data.get("updated_at"),
            "updated_by": str(data.get("updated_by")) if data.get("updated_by") else updated_by,
        }
