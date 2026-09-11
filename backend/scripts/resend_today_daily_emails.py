"""Resend completion emails for today's completed daily runs."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

from app.services.daily_run_completion import send_daily_run_completion_email_for_job

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
if not url or not key:
    raise SystemExit("Missing SUPABASE credentials")

db = create_client(url, key)
today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

resp = (
    db.table("batch_jobs")
    .select("id, job_name, completion_email_sent_at")
    .ilike("job_name", "Daily %")
    .eq("status", "completed")
    .gte("completed_at", today)
    .is_("completion_email_sent_at", "null")
    .order("completed_at")
    .execute()
)

jobs = resp.data or []
if not jobs:
    print("No unsent completed daily runs for today.")
    sys.exit(0)

print(f"Resending {len(jobs)} daily run email(s) for {today}...")
ok = 0
failed = 0
for job in jobs:
    job_id = UUID(job["id"])
    name = job["job_name"]
    print(f"  -> {name} ({job_id})")
    sent = send_daily_run_completion_email_for_job(db, job_id)
    after = (
        db.table("batch_jobs")
        .select("completion_email_sent_at")
        .eq("id", str(job_id))
        .limit(1)
        .execute()
    )
    stamp = (after.data or [{}])[0].get("completion_email_sent_at")
    if sent and stamp:
        print(f"     SENT at {stamp}")
        ok += 1
    else:
        print("     FAILED (completion_email_sent_at still null)")
        failed += 1

print(f"Done: {ok} sent, {failed} failed.")
sys.exit(1 if failed else 0)
