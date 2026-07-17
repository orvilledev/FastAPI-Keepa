"""Audit log for off-price analytics Excel downloads."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

from supabase import Client

from app.services.off_price_analytics_vendors import VENDOR_CODES, VENDOR_LABELS


class OffPriceAnalyticsDownloadLogRepository:
    table = "off_price_analytics_download_logs"

    def __init__(self, db: Client):
        self.db = db

    @staticmethod
    def vendor_label_for(codes: Sequence[str], *, all_vendors: bool) -> str:
        if all_vendors or not codes:
            return "All vendors"
        labels = [VENDOR_LABELS.get(c, c.upper()) for c in codes if c in VENDOR_CODES]
        if not labels:
            return "All vendors"
        if len(labels) == 1:
            return labels[0]
        if len(labels) <= 3:
            return ", ".join(labels)
        return f"{', '.join(labels[:3])} (+{len(labels) - 3} more)"

    def record_download(
        self,
        *,
        user_id: Optional[str],
        user_display_name: Optional[str],
        user_email: Optional[str],
        vendor_codes: Sequence[str],
        filename: Optional[str] = None,
        period: Optional[str] = None,
    ) -> Dict[str, Any]:
        codes = [
            c.strip().lower()
            for c in vendor_codes
            if c and c.strip().lower() in VENDOR_CODES
        ]
        # Deduplicate preserve order
        seen = set()
        ordered: List[str] = []
        for c in codes:
            if c not in seen:
                seen.add(c)
                ordered.append(c)

        all_vendors = len(ordered) == 0 or len(ordered) >= len(VENDOR_CODES)
        if all_vendors:
            ordered = sorted(VENDOR_CODES)

        payload = {
            "user_id": str(user_id) if user_id else None,
            "user_display_name": (user_display_name or "").strip() or None,
            "user_email": (user_email or "").strip() or None,
            "vendor_codes": ordered,
            "vendor_scope": "all" if all_vendors else "selected",
            "vendor_label": self.vendor_label_for(ordered, all_vendors=all_vendors),
            "filename": filename,
            "period": period,
            "downloaded_at": datetime.now(timezone.utc).isoformat(),
        }
        response = self.db.table(self.table).insert(payload).execute()
        data = (response.data or [None])[0] or payload
        return self._normalize(data)

    def list_logs(self, *, limit: int = 100) -> List[Dict[str, Any]]:
        response = (
            self.db.table(self.table)
            .select("*")
            .order("downloaded_at", desc=True)
            .limit(limit)
            .execute()
        )
        return [self._normalize(row) for row in (response.data or [])]

    @staticmethod
    def _normalize(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row.get("id")) if row.get("id") else None,
            "user_id": str(row.get("user_id")) if row.get("user_id") else None,
            "user_display_name": row.get("user_display_name"),
            "user_email": row.get("user_email"),
            "vendor_codes": list(row.get("vendor_codes") or []),
            "vendor_scope": row.get("vendor_scope") or "selected",
            "vendor_label": row.get("vendor_label") or "All vendors",
            "filename": row.get("filename"),
            "period": row.get("period"),
            "downloaded_at": row.get("downloaded_at"),
        }
