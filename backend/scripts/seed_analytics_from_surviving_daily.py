"""Seed weekly/monthly/yearly analytics archives from surviving daily 2026-07-20 snapshot.

Readonly source: off_price_analytics_snapshots daily/2026-07-20 (916 hits).
Does not recreate deleted batch_jobs or price_alerts — archive-only recovery.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.database import get_supabase
from app.repositories.off_price_analytics_snapshot_repository import (
    OffPriceAnalyticsSnapshotRepository,
)
from app.services.off_price_analytics_service import period_bounds

SOURCE_DAY = "2026-07-20"
REFERENCE = datetime(2026, 7, 20, 12, 0, 0, tzinfo=timezone.utc)
TARGET_PERIODS = ("weekly", "monthly", "yearly")


def main() -> None:
    db = get_supabase()
    snaps = OffPriceAnalyticsSnapshotRepository(db)
    source = snaps.get_snapshot("daily", SOURCE_DAY)
    if not source:
        raise SystemExit(f"Missing source snapshot daily/{SOURCE_DAY}")

    hits = int(source.get("total_off_price_count") or 0)
    if hits <= 0:
        raise SystemExit(f"Source daily/{SOURCE_DAY} has no hits to seed from")

    payload = source.get("payload") or {}
    vendors = payload.get("vendors") or []
    runs = int(source.get("total_run_count") or payload.get("total_run_count") or 0)
    distinct = int(source.get("distinct_sellers") or payload.get("distinct_sellers") or 0)
    vendors_with_hits = int(
        source.get("vendors_with_hits") or payload.get("vendors_with_hits") or 0
    )
    if not vendors_with_hits:
        vendors_with_hits = sum(1 for v in vendors if int(v.get("off_price_count") or 0) > 0)

    print(f"Source daily/{SOURCE_DAY}: hits={hits} runs={runs} vendors={len(vendors)}")

    seeded = []
    skipped = []
    for period in TARGET_PERIODS:
        start, end, label, period_key = period_bounds(period, offset=0, reference=REFERENCE)
        existing = snaps.get_snapshot(period, period_key)
        existing_hits = int((existing or {}).get("total_off_price_count") or 0)
        if existing_hits > hits:
            skipped.append(f"{period}/{period_key} (existing {existing_hits} > {hits})")
            continue

        note = (
            f"Partial recovery from surviving daily {SOURCE_DAY} only "
            f"({hits} hits / {runs} runs). Not a full {period} recomputation."
        )
        row = {
            "period_type": period,
            "period_key": period_key,
            "period_label": label,
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "total_off_price_count": hits,
            "total_run_count": runs,
            "distinct_sellers": distinct,
            "vendors_with_hits": vendors_with_hits,
            "payload": {
                "vendors": vendors,
                "total_off_price_count": hits,
                "total_run_count": runs,
                "distinct_sellers": distinct,
                "vendors_with_hits": vendors_with_hits,
                "recovery_note": note,
                "recovered_from": f"daily/{SOURCE_DAY}",
            },
            "source": "live",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        snaps.upsert_snapshot(row)
        seeded.append(f"{period}/{period_key} -> hits={hits} ({label})")

    print("Seeded:")
    for line in seeded:
        print(f"  {line}")
    if skipped:
        print("Skipped:")
        for line in skipped:
            print(f"  {line}")
    print("Done.")


if __name__ == "__main__":
    main()
