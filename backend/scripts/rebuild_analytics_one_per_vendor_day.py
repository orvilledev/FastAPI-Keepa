"""Rebuild Live Analytics from 2026-07-20 with one report per vendor per day."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.database import get_supabase
from app.services.off_price_analytics_service import OffPriceAnalyticsService

CUTOVER = datetime(2026, 7, 20, 12, 0, 0, tzinfo=timezone.utc)


def main() -> None:
    db = get_supabase()
    svc = OffPriceAnalyticsService(db)
    now = datetime.now(timezone.utc)

    print("=== Rebuild dailies from 2026-07-20 ===")
    day = CUTOVER
    while day.date() <= now.date():
        out = svc.get_off_price_summary(
            "daily",
            offset=0,
            persist=True,
            force_persist=True,
            user_id=None,
            reference=day,
        )
        print(
            f"  daily/{out.get('period_key')}: hits={out.get('total_off_price_count')} "
            f"runs={out.get('total_run_count')}"
        )
        for v in out.get("vendors") or []:
            if int(v.get("off_price_count") or 0) or int(v.get("run_count") or 0):
                print(
                    f"    {v.get('code')}: off={v.get('off_price_count')} "
                    f"runs={v.get('run_count')}"
                )
        day += timedelta(days=1)

    print("=== Rebuild week / month / year ===")
    for period in ("weekly", "monthly", "yearly"):
        out = svc.get_off_price_summary(
            period,
            offset=0,
            persist=True,
            force_persist=True,
            user_id=None,
            reference=now,
        )
        print(
            f"  {period}/{out.get('period_key')}: hits={out.get('total_off_price_count')} "
            f"runs={out.get('total_run_count')}"
        )
        for v in out.get("vendors") or []:
            if int(v.get("off_price_count") or 0) or int(v.get("run_count") or 0):
                print(
                    f"    {v.get('code')}: off={v.get('off_price_count')} "
                    f"runs={v.get('run_count')}"
                )

    print("Done.")


if __name__ == "__main__":
    main()
