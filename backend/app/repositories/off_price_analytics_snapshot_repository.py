"""Durable off-price analytics snapshot persistence (no auto-delete).

This table is isolated from Express / Daily job cleanup:
- No foreign keys to ``batch_jobs`` or ``price_alerts``
- Job delete RPC / repositories must never write or delete these rows
- Express Job ``price_alerts`` are never counted into analytics
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from supabase import Client


class OffPriceAnalyticsSnapshotRepository:
    """Upsert/read only. Callers must never use this from job-delete paths."""

    table = "off_price_analytics_snapshots"

    def __init__(self, db: Client):
        self.db = db

    def upsert_snapshot(self, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Insert or update a period archive. Never deletes historical rows."""
        payload = {
            **row,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        response = (
            self.db.table(self.table)
            .upsert(payload, on_conflict="period_type,period_key")
            .execute()
        )
        data = response.data or []
        return data[0] if data else None

    def list_snapshots(
        self,
        *,
        period_type: Optional[str] = None,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        query = (
            self.db.table(self.table)
            .select(
                "id, period_type, period_key, period_label, period_start, period_end, "
                "total_off_price_count, total_run_count, distinct_sellers, "
                "vendors_with_hits, source, created_at, updated_at"
            )
            .order("period_start", desc=True)
            .limit(limit)
        )
        if period_type:
            query = query.eq("period_type", period_type)
        response = query.execute()
        return response.data or []

    def get_snapshot(self, period_type: str, period_key: str) -> Optional[Dict[str, Any]]:
        response = (
            self.db.table(self.table)
            .select("*")
            .eq("period_type", period_type)
            .eq("period_key", period_key)
            .limit(1)
            .execute()
        )
        data = response.data or []
        return data[0] if data else None
