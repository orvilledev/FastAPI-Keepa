"""Per-user off-price analytics tracking preferences."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from supabase import Client

from app.services.off_price_analytics_vendors import VENDOR_CODES, VENDOR_DEFS


class OffPriceAnalyticsUserTrackingRepository:
    table = "off_price_analytics_user_tracking"

    def __init__(self, db: Client):
        self.db = db

    def list_settings(self, user_id: str) -> List[Dict[str, Any]]:
        """Return one row per known vendor for this user (default tracking on)."""
        by_code: Dict[str, Dict[str, Any]] = {}
        try:
            response = (
                self.db.table(self.table)
                .select("*")
                .eq("user_id", str(user_id))
                .execute()
            )
            for row in response.data or []:
                code = (row.get("vendor_code") or "").strip().lower()
                if code in VENDOR_CODES:
                    by_code[code] = row
        except Exception:
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
                    "user_id": str(user_id),
                }
            )
        return out

    def get_tracking_map(self, user_id: str) -> Dict[str, bool]:
        return {
            row["vendor_code"]: bool(row["tracking_enabled"])
            for row in self.list_settings(user_id)
        }

    def set_tracking(
        self,
        user_id: str,
        vendor_code: str,
        enabled: bool,
    ) -> Dict[str, Any]:
        code = (vendor_code or "").strip().lower()
        if code not in VENDOR_CODES:
            raise ValueError(f"Unknown vendor code: {vendor_code}")
        uid = str(user_id)

        payload: Dict[str, Any] = {
            "user_id": uid,
            "vendor_code": code,
            "tracking_enabled": bool(enabled),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        response = (
            self.db.table(self.table)
            .upsert(payload, on_conflict="user_id,vendor_code")
            .execute()
        )
        data = (response.data or [None])[0] or payload
        name = next((n for c, n in VENDOR_DEFS if c == code), code.upper())
        return {
            "vendor_code": code,
            "vendor_name": name,
            "tracking_enabled": bool(data.get("tracking_enabled", enabled)),
            "updated_at": data.get("updated_at"),
            "user_id": uid,
        }
