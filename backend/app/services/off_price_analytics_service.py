"""Off-price listing analytics from daily-run jobs (web feature).

Aggregates ``price_alerts`` produced by completed Daily Runs for all vendors
(active and inactive). Express Jobs are never included.

At most one Daily Run is counted per vendor per calendar day (earliest
completed job wins). Later same-day Trigger Import runs may still email, but
do not double-count in Live Analytics.

Persists period snapshots in ``off_price_analytics_snapshots`` so historical
years remain downloadable even when Express (or individual job) records and
their ``price_alerts`` are deleted. Job delete paths must not touch snapshots.
"""
from __future__ import annotations

import logging
from calendar import monthrange
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple

from supabase import Client

from app.repositories.job_repository import JobRepository
from app.repositories.off_price_analytics_snapshot_repository import (
    OffPriceAnalyticsSnapshotRepository,
)
from app.repositories.off_price_analytics_user_tracking_repository import (
    OffPriceAnalyticsUserTrackingRepository,
)
from app.services.off_price_analytics_vendors import (
    VENDOR_CODES,
    VENDOR_DEFS,
    VENDOR_LABELS,
    is_excluded_analytics_seller,
)

logger = logging.getLogger(__name__)

Period = Literal["daily", "weekly", "monthly", "yearly"]

# Analytics source-of-truth jobs only. Express Jobs share price_alerts but are excluded.
_DAILY_JOB_NAME_PREFIX = "Daily %"


def period_bounds(
    period: Period,
    *,
    offset: int = 0,
    reference: Optional[datetime] = None,
) -> Tuple[datetime, datetime, str, str]:
    """
    Return (start_inclusive, end_exclusive, label, period_key) in UTC.

    Daily = calendar day, weekly = ISO week (Mon), monthly = calendar month,
    yearly = calendar year. ``offset`` 0 = current period, 1 = previous, etc.
    """
    now = (reference or datetime.now(timezone.utc)).astimezone(timezone.utc)
    offset = max(0, int(offset))

    if period == "daily":
        start = (now - timedelta(days=offset)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        end = start + timedelta(days=1)
        label = start.strftime("%b %d, %Y")
        period_key = start.strftime("%Y-%m-%d")
    elif period == "weekly":
        weekday = now.weekday()
        this_monday = (now - timedelta(days=weekday)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        start = this_monday - timedelta(weeks=offset)
        end = start + timedelta(weeks=1)
        iso = start.isocalendar()
        label = f"Week {iso.week}, {iso.year}"
        period_key = f"{iso.year}-W{iso.week:02d}"
    elif period == "monthly":
        year, month = now.year, now.month
        for _ in range(offset):
            month -= 1
            if month < 1:
                month = 12
                year -= 1
        start = datetime(year, month, 1, tzinfo=timezone.utc)
        last_day = monthrange(year, month)[1]
        end = datetime(year, month, last_day, tzinfo=timezone.utc) + timedelta(days=1)
        label = start.strftime("%B %Y")
        period_key = start.strftime("%Y-%m")
    else:
        year = now.year - offset
        start = datetime(year, 1, 1, tzinfo=timezone.utc)
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        label = str(year)
        period_key = str(year)

    return start, end, label, period_key


def _vendor_from_job(job: Dict[str, Any]) -> Optional[str]:
    raw = (job.get("map_vendor_type") or "").strip().lower()
    if raw in VENDOR_CODES:
        return raw
    name = (job.get("job_name") or "").strip().lower()
    if not name.startswith("daily "):
        return None
    parts = name.split()
    if len(parts) >= 2 and parts[1] in VENDOR_CODES:
        return parts[1]
    return None


def _run_date_for_job(job: Dict[str, Any]) -> Optional[str]:
    """Calendar day (YYYY-MM-DD) for analytics: job_name date, else completed/created UTC."""
    name = str(job.get("job_name") or "")
    # "Daily CLK Uploaded Report - 2026-07-22"
    if len(name) >= 10:
        tail = name[-10:]
        if tail[4:5] == "-" and tail[7:8] == "-":
            try:
                datetime.strptime(tail, "%Y-%m-%d")
                return tail
            except ValueError:
                pass
    for key in ("completed_at", "created_at"):
        raw = job.get(key)
        if not raw:
            continue
        try:
            text = str(raw).replace("Z", "+00:00")
            dt = datetime.fromisoformat(text)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            continue
    return None


def _job_sort_key(job: Dict[str, Any]) -> Tuple[str, str, str]:
    return (
        str(job.get("completed_at") or ""),
        str(job.get("created_at") or ""),
        str(job.get("id") or ""),
    )


def dedupe_one_job_per_vendor_day(jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Keep a single Daily Run per vendor per calendar day.

    The earliest completed job wins (scheduled countdown before Trigger Import Now).
    Later same-day triggers still email, but must not double-count in Analytics.
    """
    chosen: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for job in jobs:
        vendor = _vendor_from_job(job)
        run_date = _run_date_for_job(job)
        if not vendor or not run_date:
            continue
        key = (vendor, run_date)
        prev = chosen.get(key)
        if prev is None or _job_sort_key(job) < _job_sort_key(prev):
            chosen[key] = job
    return sorted(chosen.values(), key=_job_sort_key)


class OffPriceAnalyticsService:
    """Build period off-price counts per vendor and archive them permanently."""

    def __init__(self, db: Client):
        self.db = db
        self.snapshots = OffPriceAnalyticsSnapshotRepository(db)
        self.user_tracking = OffPriceAnalyticsUserTrackingRepository(db)

    def _fetch_scheduler_enabled(self) -> Dict[str, bool]:
        enabled: Dict[str, bool] = {code: False for code in VENDOR_CODES}
        try:
            response = (
                self.db.table("scheduler_settings")
                .select("category, enabled")
                .execute()
            )
            for row in response.data or []:
                category = (row.get("category") or "").strip().lower()
                if category in enabled:
                    enabled[category] = bool(row.get("enabled", False))
        except Exception:
            pass
        return enabled

    def _fetch_daily_jobs(self, start: datetime, end: datetime) -> List[Dict[str, Any]]:
        """
        Completed Daily Run jobs only (Express Jobs are never included).

        Filtering is applied twice: SQL ``Daily %`` prefix and
        ``JobRepository._is_daily_run_job`` so Express alert rows cannot leak in.
        """
        jobs: List[Dict[str, Any]] = []
        page_size = 500
        offset = 0
        start_iso = start.isoformat()
        end_iso = end.isoformat()

        while True:
            response = (
                self.db.table("batch_jobs")
                .select("id, job_name, map_vendor_type, completed_at, created_at, status")
                .eq("status", "completed")
                .ilike("job_name", _DAILY_JOB_NAME_PREFIX)
                .gte("completed_at", start_iso)
                .lt("completed_at", end_iso)
                .order("completed_at", desc=False)
                .range(offset, offset + page_size - 1)
                .execute()
            )
            chunk = response.data or []
            for job in chunk:
                name = job.get("job_name")
                # Explicit Express exclusion (mirrors job-delete isolation).
                if JobRepository._is_express_job(name):
                    continue
                if JobRepository._is_daily_run_job(name):
                    jobs.append(job)
            if len(chunk) < page_size:
                break
            offset += page_size

        return dedupe_one_job_per_vendor_day(jobs)

    def _count_alerts_by_job(self, job_ids: List[str]) -> Dict[str, int]:
        counts: Dict[str, int] = defaultdict(int)
        if not job_ids:
            return counts

        chunk_size = 80
        page_size = 1000
        for i in range(0, len(job_ids), chunk_size):
            id_chunk = job_ids[i : i + chunk_size]
            page_offset = 0
            while True:
                response = (
                    self.db.table("price_alerts")
                    .select("id, batch_job_id, seller_name")
                    .in_("batch_job_id", id_chunk)
                    .range(page_offset, page_offset + page_size - 1)
                    .execute()
                )
                rows = response.data or []
                for row in rows:
                    if is_excluded_analytics_seller(row.get("seller_name")):
                        continue
                    job_id = str(row.get("batch_job_id") or "")
                    if job_id:
                        counts[job_id] += 1
                if len(rows) < page_size:
                    break
                page_offset += page_size

        return counts

    def _count_sellers_by_job(self, job_ids: List[str]) -> Dict[str, Dict[str, int]]:
        """seller_name -> count, scoped per job then merged by caller as needed."""
        by_job: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        if not job_ids:
            return by_job

        chunk_size = 80
        page_size = 1000
        for i in range(0, len(job_ids), chunk_size):
            id_chunk = job_ids[i : i + chunk_size]
            page_offset = 0
            while True:
                response = (
                    self.db.table("price_alerts")
                    .select("batch_job_id, seller_name")
                    .in_("batch_job_id", id_chunk)
                    .range(page_offset, page_offset + page_size - 1)
                    .execute()
                )
                rows = response.data or []
                for row in rows:
                    job_id = str(row.get("batch_job_id") or "")
                    seller = (row.get("seller_name") or "").strip()
                    if not job_id or not seller:
                        continue
                    if is_excluded_analytics_seller(seller):
                        continue
                    by_job[job_id][seller] += 1
                if len(rows) < page_size:
                    break
                page_offset += page_size

        return by_job

    def get_off_price_summary(
        self,
        period: Period,
        *,
        offset: int = 0,
        persist: bool = True,
        source: str = "live",
        user_id: Optional[str] = None,
        force_persist: bool = False,
        reference: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        start, end, label, period_key = period_bounds(
            period, offset=offset, reference=reference
        )
        enabled_map = self._fetch_scheduler_enabled()
        # Personal tracking: when user_id is set, only that user's toggles apply.
        # Without user_id (system seed), all vendors remain tracked.
        if user_id:
            tracking_map = self.user_tracking.get_tracking_map(user_id)
        else:
            tracking_map = {code: True for code, _ in VENDOR_DEFS}

        start_out = start.isoformat()
        end_out = end.isoformat()
        served_from_archive = False

        if period == "daily":
            jobs = self._fetch_daily_jobs(start, end)
            (
                vendors_sorted,
                total_off_price,
                total_runs,
                all_sellers,
                vendors_with_hits,
                personal_off_price,
                personal_runs,
                personal_sellers,
                personal_vendors_with_hits,
            ) = self._vendor_stats_from_jobs(
                jobs, enabled_map=enabled_map, tracking_map=tracking_map
            )
            if total_runs == 0:
                archived = None
                try:
                    existing_snap = self.snapshots.get_snapshot(period, period_key)
                except Exception:
                    existing_snap = None
                if existing_snap and str(existing_snap.get("source") or "").lower() != "demo":
                    archived = self.get_archive(period, period_key)
                if (not archived or not archived.get("vendors")) and offset == 0:
                    try:
                        recent = self.snapshots.list_snapshots(
                            period_type="daily", limit=14, exclude_demo=True
                        )
                    except Exception:
                        recent = []
                    for row in recent:
                        if int(row.get("total_off_price_count") or 0) <= 0:
                            continue
                        candidate = self.get_archive(
                            "daily", str(row.get("period_key") or "")
                        )
                        if candidate and candidate.get("vendors"):
                            archived = candidate
                            period_key = str(candidate.get("period_key") or period_key)
                            label = str(candidate.get("period_label") or label)
                            if candidate.get("start"):
                                start_out = str(candidate["start"])
                            if candidate.get("end"):
                                end_out = str(candidate["end"])
                            break
                if archived and archived.get("vendors"):
                    served_from_archive = True
                    (
                        vendors_sorted,
                        total_off_price,
                        total_runs,
                        all_sellers,
                        vendors_with_hits,
                        personal_off_price,
                        personal_runs,
                        personal_sellers,
                        personal_vendors_with_hits,
                    ) = self._vendor_stats_from_archive_vendors(
                        archived.get("vendors") or [],
                        enabled_map=enabled_map,
                        tracking_map=tracking_map,
                    )
        else:
            # Week / month / year: sum one-record-per-vendor-day building blocks.
            (
                vendors_sorted,
                total_off_price,
                total_runs,
                all_sellers,
                vendors_with_hits,
                personal_off_price,
                personal_runs,
                personal_sellers,
                personal_vendors_with_hits,
                served_from_archive,
            ) = self._aggregate_period_from_daily_sources(
                start,
                end,
                enabled_map=enabled_map,
                tracking_map=tracking_map,
            )

        archive_summary = {
            "period": period,
            "period_key": period_key,
            "period_label": label,
            "offset": offset,
            "start": start_out,
            "end": end_out,
            "total_off_price_count": total_off_price,
            "total_run_count": total_runs,
            "distinct_sellers": len(all_sellers),
            "vendors_with_hits": vendors_with_hits,
            "vendors": [{**v, "tracking_enabled": True} for v in vendors_sorted],
            "archived": False,
        }

        if persist:
            archive_summary["archived"] = self._persist_summary(
                archive_summary, source=source, force=force_persist
            )

        return {
            "period": period,
            "period_key": period_key,
            "period_label": label,
            "offset": offset,
            "start": start_out,
            "end": end_out,
            "total_off_price_count": personal_off_price if user_id else total_off_price,
            "total_run_count": personal_runs if user_id else total_runs,
            "distinct_sellers": len(personal_sellers) if user_id else len(all_sellers),
            "vendors_with_hits": personal_vendors_with_hits if user_id else vendors_with_hits,
            "vendors": vendors_sorted,
            "tracking_settings": [
                {
                    "vendor_code": code,
                    "vendor_name": name,
                    "tracking_enabled": tracking_map.get(code, True),
                }
                for code, name in VENDOR_DEFS
            ],
            "archived": archive_summary.get("archived", False) or served_from_archive,
            "personalized": bool(user_id),
        }

    def _vendor_stats_from_jobs(
        self,
        jobs: List[Dict[str, Any]],
        *,
        enabled_map: Dict[str, bool],
        tracking_map: Dict[str, bool],
    ) -> Tuple[
        List[Dict[str, Any]],
        int,
        int,
        set[str],
        int,
        int,
        int,
        set[str],
        int,
    ]:
        jobs_by_vendor: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for job in jobs:
            vendor = _vendor_from_job(job)
            if vendor:
                jobs_by_vendor[vendor].append(job)

        all_job_ids = [str(j["id"]) for j in jobs if j.get("id")]
        alert_counts = self._count_alerts_by_job(all_job_ids)
        sellers_by_job = self._count_sellers_by_job(all_job_ids)

        vendors_out: List[Dict[str, Any]] = []
        total_off_price = 0
        total_runs = 0
        all_sellers: set[str] = set()
        personal_off_price = 0
        personal_runs = 0
        personal_sellers: set[str] = set()

        for code, name in VENDOR_DEFS:
            tracking_enabled = tracking_map.get(code, True)
            vendor_jobs = jobs_by_vendor.get(code, [])
            off_price_count = sum(alert_counts.get(str(j["id"]), 0) for j in vendor_jobs)
            run_count = len(vendor_jobs)
            seller_counts: Dict[str, int] = defaultdict(int)
            for j in vendor_jobs:
                for seller, count in sellers_by_job.get(str(j["id"]), {}).items():
                    seller_counts[seller] += count
                    all_sellers.add(seller.lower())
                    if tracking_enabled:
                        personal_sellers.add(seller.lower())

            sellers_sorted = sorted(
                [{"seller_name": s, "hits": c} for s, c in seller_counts.items()],
                key=lambda item: item["hits"],
                reverse=True,
            )
            total_off_price += off_price_count
            total_runs += run_count
            if tracking_enabled:
                personal_off_price += off_price_count
                personal_runs += run_count
            vendors_out.append(
                {
                    "code": code,
                    "name": name,
                    "off_price_count": off_price_count,
                    "run_count": run_count,
                    "scheduler_enabled": enabled_map.get(code, False),
                    "tracking_enabled": tracking_enabled,
                    "sellers": sellers_sorted,
                }
            )

        vendors_sorted = sorted(
            vendors_out,
            key=lambda v: (-int(v["tracking_enabled"]), -v["off_price_count"], v["code"]),
        )
        vendors_with_hits = sum(1 for v in vendors_sorted if v["off_price_count"] > 0)
        personal_vendors_with_hits = sum(
            1 for v in vendors_sorted if v["tracking_enabled"] and v["off_price_count"] > 0
        )
        return (
            vendors_sorted,
            total_off_price,
            total_runs,
            all_sellers,
            vendors_with_hits,
            personal_off_price,
            personal_runs,
            personal_sellers,
            personal_vendors_with_hits,
        )

    def _vendor_stats_from_archive_vendors(
        self,
        archived_vendors: List[Dict[str, Any]],
        *,
        enabled_map: Dict[str, bool],
        tracking_map: Dict[str, bool],
    ) -> Tuple[
        List[Dict[str, Any]],
        int,
        int,
        set[str],
        int,
        int,
        int,
        set[str],
        int,
    ]:
        archive_by_code = {
            str(v.get("code") or "").lower(): v
            for v in archived_vendors
            if str(v.get("code") or "").strip()
        }
        vendors_sorted: List[Dict[str, Any]] = []
        personal_off_price = 0
        personal_runs = 0
        personal_sellers: set[str] = set()
        all_sellers: set[str] = set()
        total_off_price = 0
        total_runs = 0
        for code, name in VENDOR_DEFS:
            tracking_enabled = tracking_map.get(code, True)
            match = archive_by_code.get(code) or {}
            off = int(match.get("off_price_count") or 0)
            runs = int(match.get("run_count") or 0)
            sellers = list(match.get("sellers") or [])
            total_off_price += off
            total_runs += runs
            for s in sellers:
                sn = str((s or {}).get("seller_name") or "").strip()
                if not sn:
                    continue
                all_sellers.add(sn.lower())
                if tracking_enabled:
                    personal_sellers.add(sn.lower())
            if tracking_enabled:
                personal_off_price += off
                personal_runs += runs
            vendors_sorted.append(
                {
                    "code": code,
                    "name": name,
                    "off_price_count": off,
                    "run_count": runs,
                    "scheduler_enabled": enabled_map.get(code, False),
                    "tracking_enabled": tracking_enabled,
                    "sellers": sellers,
                }
            )
        vendors_sorted.sort(
            key=lambda v: (-int(v["tracking_enabled"]), -v["off_price_count"], v["code"])
        )
        vendors_with_hits = sum(1 for v in vendors_sorted if v["off_price_count"] > 0)
        personal_vendors_with_hits = sum(
            1 for v in vendors_sorted if v["tracking_enabled"] and v["off_price_count"] > 0
        )
        return (
            vendors_sorted,
            total_off_price,
            total_runs,
            all_sellers,
            vendors_with_hits,
            personal_off_price,
            personal_runs,
            personal_sellers,
            personal_vendors_with_hits,
        )

    def _aggregate_period_from_daily_sources(
        self,
        start: datetime,
        end: datetime,
        *,
        enabled_map: Dict[str, bool],
        tracking_map: Dict[str, bool],
    ) -> Tuple[
        List[Dict[str, Any]],
        int,
        int,
        set[str],
        int,
        int,
        int,
        set[str],
        int,
        bool,
    ]:
        """
        Sum daily analytics building blocks (live deduped jobs or daily archives).

        At most one recorded report per vendor per calendar day.
        """
        vendor_off: Dict[str, int] = defaultdict(int)
        vendor_runs: Dict[str, int] = defaultdict(int)
        vendor_sellers: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        used_archive = False
        day = start
        identity_tracking = {c: True for c, _ in VENDOR_DEFS}
        while day < end:
            day_end = day + timedelta(days=1)
            day_key = day.strftime("%Y-%m-%d")
            jobs = self._fetch_daily_jobs(day, day_end)
            day_vendors: List[Dict[str, Any]]
            if jobs:
                day_vendors = self._vendor_stats_from_jobs(
                    jobs, enabled_map=enabled_map, tracking_map=identity_tracking
                )[0]
            else:
                archived = self.get_archive("daily", day_key)
                if (
                    not archived
                    or not archived.get("vendors")
                    or int(archived.get("total_off_price_count") or 0) <= 0
                ):
                    day += timedelta(days=1)
                    continue
                used_archive = True
                day_vendors = self._vendor_stats_from_archive_vendors(
                    archived.get("vendors") or [],
                    enabled_map=enabled_map,
                    tracking_map=identity_tracking,
                )[0]

            for v in day_vendors:
                code = str(v.get("code") or "").lower()
                if not code:
                    continue
                vendor_off[code] += int(v.get("off_price_count") or 0)
                vendor_runs[code] += int(v.get("run_count") or 0)
                for s in v.get("sellers") or []:
                    sn = str((s or {}).get("seller_name") or "").strip()
                    if not sn:
                        continue
                    vendor_sellers[code][sn] += int((s or {}).get("hits") or 0)

            day += timedelta(days=1)

        vendors_out: List[Dict[str, Any]] = []
        total_off_price = 0
        total_runs = 0
        all_sellers: set[str] = set()
        personal_off_price = 0
        personal_runs = 0
        personal_sellers: set[str] = set()
        for code, name in VENDOR_DEFS:
            tracking_enabled = tracking_map.get(code, True)
            off = int(vendor_off.get(code) or 0)
            runs = int(vendor_runs.get(code) or 0)
            sellers_sorted = sorted(
                [
                    {"seller_name": s, "hits": c}
                    for s, c in (vendor_sellers.get(code) or {}).items()
                ],
                key=lambda item: item["hits"],
                reverse=True,
            )
            for s in sellers_sorted:
                sn = str(s.get("seller_name") or "").strip().lower()
                if sn:
                    all_sellers.add(sn)
                    if tracking_enabled:
                        personal_sellers.add(sn)
            total_off_price += off
            total_runs += runs
            if tracking_enabled:
                personal_off_price += off
                personal_runs += runs
            vendors_out.append(
                {
                    "code": code,
                    "name": name,
                    "off_price_count": off,
                    "run_count": runs,
                    "scheduler_enabled": enabled_map.get(code, False),
                    "tracking_enabled": tracking_enabled,
                    "sellers": sellers_sorted,
                }
            )

        vendors_sorted = sorted(
            vendors_out,
            key=lambda v: (-int(v["tracking_enabled"]), -v["off_price_count"], v["code"]),
        )
        vendors_with_hits = sum(1 for v in vendors_sorted if v["off_price_count"] > 0)
        personal_vendors_with_hits = sum(
            1 for v in vendors_sorted if v["tracking_enabled"] and v["off_price_count"] > 0
        )
        return (
            vendors_sorted,
            total_off_price,
            total_runs,
            all_sellers,
            vendors_with_hits,
            personal_off_price,
            personal_runs,
            personal_sellers,
            personal_vendors_with_hits,
            used_archive,
        )

    def _persist_summary(
        self, summary: Dict[str, Any], *, source: str = "live", force: bool = False
    ) -> bool:
        """Upsert a durable snapshot.

        Empty live data never clobbers a richer archive (wipe protection).
        Positive corrections (e.g. deduping same-day Trigger runs) may decrease
        totals. ``force=True`` always writes (rebuild scripts).
        """
        try:
            period_type = summary["period"]
            period_key = summary["period_key"]
            new_hits = int(summary.get("total_off_price_count") or 0)
            existing = self.snapshots.get_snapshot(period_type, period_key)
            existing_hits = int((existing or {}).get("total_off_price_count") or 0)
            existing_source = str((existing or {}).get("source") or "").lower()
            if (
                not force
                and existing
                and existing_source != "demo"
                and new_hits < existing_hits
                and new_hits <= 0
            ):
                logger.info(
                    "Skipping analytics persist for %s/%s: empty live would wipe archive hits %s",
                    period_type,
                    period_key,
                    existing_hits,
                )
                return True

            self.snapshots.upsert_snapshot(
                {
                    "period_type": period_type,
                    "period_key": period_key,
                    "period_label": summary["period_label"],
                    "period_start": summary["start"],
                    "period_end": summary["end"],
                    "total_off_price_count": summary["total_off_price_count"],
                    "total_run_count": summary["total_run_count"],
                    "distinct_sellers": summary.get("distinct_sellers", 0),
                    "vendors_with_hits": summary.get("vendors_with_hits", 0),
                    "payload": {
                        "vendors": summary.get("vendors", []),
                        "total_off_price_count": summary["total_off_price_count"],
                        "total_run_count": summary["total_run_count"],
                        "distinct_sellers": summary.get("distinct_sellers", 0),
                        "vendors_with_hits": summary.get("vendors_with_hits", 0),
                    },
                    "source": source,
                }
            )
            return True
        except Exception as exc:
            # Table may not exist yet until migration is applied.
            logger.warning("Could not archive off-price analytics snapshot: %s", exc)
            return False

    def list_archives(
        self,
        *,
        period_type: Optional[str] = None,
        limit: int = 200,
        exclude_demo: bool = False,
    ) -> Dict[str, Any]:
        try:
            rows = self.snapshots.list_snapshots(
                period_type=period_type,
                limit=limit,
                exclude_demo=exclude_demo,
            )
            return {"archives": rows, "available": True}
        except Exception as exc:
            logger.warning("Could not list analytics archives: %s", exc)
            return {"archives": [], "available": False, "detail": str(exc)}

    def delete_demo_snapshots(self) -> Dict[str, Any]:
        """Purge fabricated ``source=demo`` archives. Live/manual rows are kept."""
        try:
            deleted = self.snapshots.delete_demo_snapshots()
            return {"deleted": deleted, "available": True}
        except Exception as exc:
            logger.warning("Could not delete demo analytics snapshots: %s", exc)
            return {"deleted": 0, "available": False, "detail": str(exc)}

    def get_archive(self, period_type: str, period_key: str) -> Optional[Dict[str, Any]]:
        try:
            row = self.snapshots.get_snapshot(period_type, period_key)
        except Exception as exc:
            logger.warning("Could not load analytics archive: %s", exc)
            return None
        if not row:
            return None
        payload = row.get("payload") or {}
        vendors = self._strip_excluded_sellers_from_vendors(payload.get("vendors") or [])
        total_off = sum(int(v.get("off_price_count") or 0) for v in vendors)
        distinct = {
            str(s.get("seller_name") or "").strip().lower()
            for v in vendors
            for s in (v.get("sellers") or [])
            if str(s.get("seller_name") or "").strip()
        }
        return {
            "period": row.get("period_type"),
            "period_key": row.get("period_key"),
            "period_label": row.get("period_label"),
            "start": row.get("period_start"),
            "end": row.get("period_end"),
            "total_off_price_count": total_off,
            "total_run_count": row.get("total_run_count", 0),
            "distinct_sellers": len(distinct),
            "vendors_with_hits": sum(1 for v in vendors if int(v.get("off_price_count") or 0) > 0),
            "vendors": vendors,
            "source": row.get("source"),
            "archived": True,
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        }

    @staticmethod
    def _strip_excluded_sellers_from_vendors(vendors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Drop MetroShoe Warehouse from archived payloads (legacy rows may still include it)."""
        cleaned: List[Dict[str, Any]] = []
        for vendor in vendors:
            sellers_in = vendor.get("sellers") or []
            sellers = [
                s
                for s in sellers_in
                if not is_excluded_analytics_seller(s.get("seller_name") if isinstance(s, dict) else None)
            ]
            excluded_hits = sum(
                int(s.get("hits") or 0)
                for s in sellers_in
                if isinstance(s, dict) and is_excluded_analytics_seller(s.get("seller_name"))
            )
            off = max(0, int(vendor.get("off_price_count") or 0) - excluded_hits)
            cleaned.append({**vendor, "sellers": sellers, "off_price_count": off})
        return cleaned

    def seed_demo_history(self) -> Dict[str, Any]:
        """
        Upsert fabricated yearly (and recent) snapshots for demo / past-year download.
        Seeds 50 calendar years (current year + 49 prior). Safe to re-run; unique on
        (period_type, period_key).
        """
        seeded: List[str] = []
        current_year = datetime.now(timezone.utc).year
        year_count = 50
        first_year = current_year - year_count + 1
        baseline = {
            "dnk": 2180,
            "clk": 1740,
            "obz": 1210,
            "ref": 980,
            "bor": 640,
            "sff": 720,
            "tev": 1100,
            "cha": 410,
            "jfs": 560,
        }

        def hits_for_year(year: int) -> Dict[str, int]:
            progress = (year - first_year) / max(1, year_count - 2)
            factor = 0.28 + max(0.0, min(1.0, progress)) * 0.97
            jitter_seed = year * 17
            out: Dict[str, int] = {}
            for code, base in baseline.items():
                wobble = ((jitter_seed + ord(code[0]) * 13) % 11) - 5
                out[code] = max(40, int(round(base * factor + wobble * 8)))
            return out

        demo_sellers = [
            "ShoeDealz Outlet",
            "British Walk Co",
            "Mountain Gear Depot",
            "Coastal Flip Co",
            "River Sandal Co",
            "Comfort Footwear Co",
        ]

        for year in range(first_year, current_year + 1):
            vendor_hits = hits_for_year(year)
            start = datetime(year, 1, 1, tzinfo=timezone.utc)
            end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
            total = sum(vendor_hits.values())
            vendors = []
            for code, name in VENDOR_DEFS:
                hits = vendor_hits.get(code, 0)
                sellers = []
                remaining = hits
                for i, seller in enumerate(demo_sellers[:4]):
                    share = hits // 4 if i < 3 else remaining
                    remaining -= share
                    if share > 0:
                        sellers.append({"seller_name": seller, "hits": share})
                vendors.append(
                    {
                        "code": code,
                        "name": name,
                        "off_price_count": hits,
                        "run_count": 120 + ((year * 3 + ord(code[0])) % 90),
                        "scheduler_enabled": code not in {"bor", "cha"},
                        "sellers": sellers,
                    }
                )
            vendors.sort(key=lambda v: -v["off_price_count"])
            summary = {
                "period": "yearly",
                "period_key": str(year),
                "period_label": str(year) if year < current_year else f"{year} (YTD)",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "total_off_price_count": total,
                "total_run_count": sum(v["run_count"] for v in vendors),
                "distinct_sellers": len(demo_sellers),
                "vendors_with_hits": sum(1 for v in vendors if v["off_price_count"] > 0),
                "vendors": vendors,
            }
            ok = self._persist_summary(summary, source="demo")
            if ok:
                seeded.append(f"yearly:{year}")

        # Also archive current calendar periods so “today” starts landing in history
        for period in ("daily", "weekly", "monthly", "yearly"):
            live = self.get_off_price_summary(period, offset=0, persist=True, source="live")
            if live.get("archived"):
                seeded.append(f"{period}:{live['period_key']}")

        return {"seeded": seeded, "count": len(seeded), "years": year_count}
