"""Repository for batch job database operations."""
import logging
from typing import List, Optional
from uuid import UUID
from supabase import Client
from fastapi import HTTPException
from datetime import datetime

from app.repositories.supabase_read_all import read_all_paginated

logger = logging.getLogger(__name__)

# Fallback path: chunked deletes via PostgREST when RPC is missing or fails.
# Larger chunks = fewer round trips (RPC path avoids this entirely).
_DELETE_CHUNK_SIZE = 500


class JobRepository:
    """Repository for batch_jobs table operations."""
    
    def __init__(self, db: Client):
        self.db = db
        self.table = "batch_jobs"
    
    def get_job(self, job_id: UUID) -> dict:
        """Get a job by ID."""
        response = self.db.table(self.table).select("*").eq("id", str(job_id)).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Job not found")
        return response.data[0]
    
    def list_jobs(
        self, 
        limit: int = 15, 
        offset: int = 0, 
        user_id: Optional[str] = None, 
        is_admin: bool = False
    ) -> List[dict]:
        """List jobs with pagination."""
        query = self.db.table(self.table).select("*").order("created_at", desc=True)
        
        if not is_admin and user_id:
            query = query.eq("created_by", user_id)
        
        response = query.range(offset, offset + limit - 1).execute()
        return response.data

    @staticmethod
    def _is_daily_run_job(job_name: Optional[str]) -> bool:
        """Return True when job name indicates a scheduled daily run."""
        if not job_name:
            return False
        normalized = job_name.lower()
        return (
            normalized.startswith("daily ")
            and (
                "metro report" in normalized
                or "off price report" in normalized
                or "uploaded report" in normalized
            )
        )

    @classmethod
    def _is_express_job(cls, job_name: Optional[str]) -> bool:
        """Return True for Express Jobs (anything that is not a Daily Run)."""
        return not cls._is_daily_run_job(job_name)

    @staticmethod
    def _format_initiator_name(display_name: Optional[str], email: Optional[str], created_by: Optional[str]) -> str:
        """
        Return a readable initiator name.

        Priority:
        1) profile display_name
        2) email local-part (before @), title-cased
        3) created_by UUID
        """
        if display_name:
            normalized_display_name = display_name.strip()
            if normalized_display_name:
                return normalized_display_name

        if email:
            local_part = email.split("@", 1)[0].strip()
            if local_part:
                # Convert separators to spaces so "john_doe" -> "John Doe"
                local_part = local_part.replace(".", " ").replace("_", " ").replace("-", " ")
                local_part = " ".join(local_part.split())
                if local_part:
                    return local_part.title()

        return created_by or "Unknown"

    def enrich_jobs_with_initiated_by(self, jobs: List[dict]) -> List[dict]:
        """
        Add initiated_by to each job.

        - Daily runs are always labeled as "Daily Run"
        - Manual jobs use display_name, then email, then created_by
        """
        if not jobs:
            return jobs

        creator_ids = sorted({
            str(job.get("created_by"))
            for job in jobs
            if job.get("created_by")
        })

        creator_lookup = {}
        if creator_ids:
            try:
                profile_response = (
                    self.db.table("profiles")
                    .select("id, display_name, email")
                    .in_("id", creator_ids)
                    .execute()
                )
                for profile in profile_response.data or []:
                    profile_id = str(profile.get("id"))
                    creator_lookup[profile_id] = self._format_initiator_name(
                        display_name=profile.get("display_name"),
                        email=profile.get("email"),
                        created_by=profile_id,
                    )
            except Exception:
                # Fallback to created_by IDs if profile lookup fails.
                logger.exception("Failed to enrich jobs with profile initiator metadata")

        enriched_jobs: List[dict] = []
        for job in jobs:
            job_copy = dict(job)
            if self._is_daily_run_job(job_copy.get("job_name")):
                job_copy["initiated_by"] = "Daily Run"
            else:
                created_by = job_copy.get("created_by")
                created_by_str = str(created_by) if created_by else None
                job_copy["initiated_by"] = (
                    creator_lookup.get(created_by_str)
                    if created_by_str
                    else "Unknown"
                )
            enriched_jobs.append(job_copy)

        return enriched_jobs

    def enrich_jobs_with_total_upcs(self, jobs: List[dict]) -> List[dict]:
        """Add total_upcs (sum of upc_batches.upc_count) to each job."""
        if not jobs:
            return jobs

        job_ids = [str(j["id"]) for j in jobs]
        totals: dict[str, int] = {jid: 0 for jid in job_ids}

        rows = read_all_paginated(
            lambda start, end: self.db.table("upc_batches")
            .select("batch_job_id, upc_count")
            .in_("batch_job_id", job_ids)
            .order("batch_job_id")
            .range(start, end)
            .execute()
        )
        for row in rows:
            jid = str(row["batch_job_id"])
            uc = row.get("upc_count")
            if uc is None:
                continue
            totals[jid] = totals.get(jid, 0) + int(uc)

        enriched: List[dict] = []
        for job in jobs:
            jc = dict(job)
            jc["total_upcs"] = totals.get(str(jc["id"]), 0)
            enriched.append(jc)
        return enriched

    def enrich_jobs_with_live_completed_batches(self, jobs: List[dict]) -> List[dict]:
        """
        Add completed_batches from live upc_batches status counts.

        This keeps list/detail progress consistent even when batch_jobs.completed_batches
        lags behind while workers are still updating batch rows.
        """
        if not jobs:
            return jobs

        job_ids = [str(j["id"]) for j in jobs]
        completed_counts: dict[str, int] = {jid: 0 for jid in job_ids}

        rows = read_all_paginated(
            lambda start, end: self.db.table("upc_batches")
            .select("batch_job_id, status")
            .in_("batch_job_id", job_ids)
            .order("batch_job_id")
            .range(start, end)
            .execute()
        )

        for row in rows:
            jid = str(row.get("batch_job_id"))
            status = str(row.get("status") or "").strip().lower()
            if status in {"completed", "cancelled"}:
                completed_counts[jid] = completed_counts.get(jid, 0) + 1

        enriched: List[dict] = []
        for job in jobs:
            jc = dict(job)
            jc["completed_batches"] = completed_counts.get(str(jc["id"]), 0)
            enriched.append(jc)
        return enriched
    
    def create_job(
        self, 
        job_name: str, 
        total_batches: int, 
        created_by: UUID
    ) -> dict:
        """Create a new batch job."""
        response = self.db.table(self.table).insert({
            "job_name": job_name,
            "status": "pending",
            "total_batches": total_batches,
            "completed_batches": 0,
            "created_by": str(created_by),
        }).execute()
        return response.data[0]
    
    def update_job(
        self,
        job_id: UUID,
        job_name: Optional[str] = None,
        description: Optional[str] = None,
        email_recipients: Optional[str] = None
    ) -> dict:
        """Update job information."""
        update_data = {}
        if job_name is not None:
            update_data["job_name"] = job_name
        if description is not None:
            update_data["description"] = description if description.strip() else None
        if email_recipients is not None:
            update_data["email_recipients"] = email_recipients if email_recipients.strip() else None
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        response = self.db.table(self.table).update(update_data).eq("id", str(job_id)).execute()
        if not response.data:
            raise HTTPException(status_code=404, detail="Job not found")
        return response.data[0]
    
    def update_job_status(
        self, 
        job_id: UUID, 
        status: str, 
        completed_batches: Optional[int] = None,
        completed_at: Optional[datetime] = None
    ) -> None:
        """Update job status."""
        update_data = {"status": status}
        if completed_batches is not None:
            update_data["completed_batches"] = completed_batches
        if completed_at:
            update_data["completed_at"] = completed_at.isoformat()
        
        self.db.table(self.table).update(update_data).eq("id", str(job_id)).execute()
    
    def get_job_batches(self, job_id: UUID) -> List[dict]:
        """Get all batches for a job."""
        return read_all_paginated(
            lambda start, end: self.db.table("upc_batches")
            .select("id, batch_number, status, processed_count, upc_count")
            .eq("batch_job_id", str(job_id))
            .order("batch_number")
            .range(start, end)
            .execute()
        )

    def _delete_in_chunks_by_eq(
        self, table: str, filter_column: str, filter_value: str
    ) -> int:
        """
        Delete rows where filter_column = filter_value, in small batches.
        Returns number of rows removed.
        """
        removed = 0
        chunk = _DELETE_CHUNK_SIZE
        while True:
            resp = (
                self.db.table(table)
                .select("id")
                .eq(filter_column, filter_value)
                .order("id")
                .range(0, chunk - 1)
                .execute()
            )
            rows = resp.data or []
            if not rows:
                break
            ids = [str(r["id"]) for r in rows]
            self.db.table(table).delete().in_("id", ids).execute()
            removed += len(ids)
            if len(rows) < chunk:
                break
        return removed

    def delete_job(self, job_id: UUID) -> None:
        """
        Delete a job and related job-scoped rows only.

        Scope (Express or Daily):
        - ``price_alerts``, ``upc_batch_items``, ``upc_batches``, ``batch_jobs``

        Never touches analytics archives (``off_price_analytics_snapshots``).
        Express job deletes must not alter Daily Run analytics history.

        Prefer the Postgres function ``delete_batch_job_cascade`` (one round trip,
        higher local statement_timeout). If it is not deployed or errors, fall
        back to chunked deletes via PostgREST.
        """
        self.get_job(job_id)
        jid = str(job_id)

        try:
            self.db.rpc("delete_batch_job_cascade", {"p_job_id": jid}).execute()
            logger.info(
                "Deleted job %s via delete_batch_job_cascade RPC "
                "(analytics snapshots untouched)",
                jid,
            )
            return
        except Exception as e:
            logger.warning(
                "delete_batch_job_cascade RPC unavailable or failed (%s); using chunked delete",
                e,
            )

        n_alerts = self._delete_in_chunks_by_eq("price_alerts", "batch_job_id", jid)
        if n_alerts:
            logger.info("Deleted %s price_alerts rows for job %s", n_alerts, jid)

        batch_rows = read_all_paginated(
            lambda start, end: self.db.table("upc_batches")
            .select("id")
            .eq("batch_job_id", jid)
            .order("id")
            .range(start, end)
            .execute()
        )
        n_items = 0
        for batch in batch_rows:
            bid = str(batch["id"])
            n_items += self._delete_in_chunks_by_eq("upc_batch_items", "upc_batch_id", bid)
        if n_items:
            logger.info("Deleted %s upc_batch_items rows for job %s", n_items, jid)

        n_batches = self._delete_in_chunks_by_eq("upc_batches", "batch_job_id", jid)
        if n_batches:
            logger.info("Deleted %s upc_batches rows for job %s", n_batches, jid)

        self.db.table(self.table).delete().eq("id", jid).execute()
        # Do NOT delete from off_price_analytics_snapshots — permanent archive.

    def list_completed_job_ids(self) -> List[UUID]:
        """Return IDs of all jobs with status completed."""
        rows = read_all_paginated(
            lambda start, end: self.db.table(self.table)
            .select("id")
            .eq("status", "completed")
            .order("created_at", desc=True)
            .range(start, end)
            .execute()
        )
        return [UUID(row["id"]) for row in rows]

    def list_completed_express_job_ids(self) -> List[UUID]:
        """Return IDs of completed Express Jobs only (excludes Daily Runs)."""
        rows = read_all_paginated(
            lambda start, end: self.db.table(self.table)
            .select("id, job_name")
            .eq("status", "completed")
            .order("created_at", desc=True)
            .range(start, end)
            .execute()
        )
        return [
            UUID(row["id"])
            for row in rows
            if self._is_express_job(row.get("job_name"))
        ]

    def delete_completed_jobs(self) -> int:
        """
        Delete completed Express Jobs only (not Daily Runs) and related
        job-scoped data (batches, items, alerts).

        Daily Run rows stay so Off-Price Live Analytics can still recompute
        from ``price_alerts``. Snapshots are never touched.
        """
        job_ids = self.list_completed_express_job_ids()
        for job_id in job_ids:
            self.delete_job(job_id)
        return len(job_ids)

