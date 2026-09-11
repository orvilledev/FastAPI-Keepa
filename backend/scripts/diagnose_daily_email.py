"""One-off diagnostic: today's daily runs vs email send status."""
from __future__ import annotations

import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
if not url or not key:
    raise SystemExit("Missing SUPABASE credentials")

db = create_client(url, key)
today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

resp = (
    db.table("batch_jobs")
    .select(
        "id, job_name, status, completed_at, completion_email_sent_at, "
        "email_recipients, email_bcc_recipients, map_vendor_type, error_message"
    )
    .ilike("job_name", "Daily %")
    .gte("completed_at", today)
    .order("completed_at", desc=True)
    .execute()
)

print(f"=== Completed daily runs since {today} ===")
for row in resp.data or []:
    rec = row.get("email_recipients") or "(none)"
    bcc = row.get("email_bcc_recipients") or "(none)"
    sent = row.get("completion_email_sent_at") or "NOT SENT"
    vendor = row.get("map_vendor_type") or "?"
    status = row.get("status") or "?"
    print(
        f"{vendor:>4} | {status:>10} | email_sent={sent} | "
        f"to={rec[:60]} | bcc={bcc[:40]} | {row.get('job_name')}"
    )

print()
print("=== Scheduler email recipients ===")
sresp = (
    db.table("scheduler_settings")
    .select("category, enabled, email_recipients, email_bcc_recipients")
    .order("category")
    .execute()
)
for row in sresp.data or []:
    rec = row.get("email_recipients") or "(none)"
    bcc = row.get("email_bcc_recipients") or "(none)"
    en = row.get("enabled")
    print(f"{row.get('category', '?'):>4} | enabled={en} | to={rec[:60]} | bcc={bcc[:40]}")

print()
print("=== Email env (non-secret) ===")
for k in ("EMAIL_TRANSPORT", "EMAIL_FROM", "EMAIL_SMTP_HOST", "AZURE_TENANT_ID", "AZURE_CLIENT_ID"):
    v = os.getenv(k)
    print(f"{k}={v if v else '(not set)'}")
print(f"EMAIL_PASSWORD set={bool(os.getenv('EMAIL_PASSWORD'))}")
print(f"AZURE_CLIENT_SECRET set={bool(os.getenv('AZURE_CLIENT_SECRET'))}")
email_to = os.getenv("EMAIL_TO") or "(not set)"
print(f"EMAIL_TO={email_to[:80]}")

print()
print("=== Recent completed daily runs (last 15) ===")
history = (
    db.table("batch_jobs")
    .select("job_name, status, completed_at, completion_email_sent_at")
    .ilike("job_name", "Daily %")
    .eq("status", "completed")
    .order("completed_at", desc=True)
    .limit(15)
    .execute()
)
for row in history.data or []:
    sent = row.get("completion_email_sent_at") or "NOT SENT"
    sent_label = sent[:19] if sent != "NOT SENT" else sent
    completed = (row.get("completed_at") or "")[:19]
    print(f"{sent_label} | completed={completed} | {row.get('job_name')}")

print()
print("=== daily_run_email_claims since 2026-09-01 ===")
try:
    claims = (
        db.table("daily_run_email_claims")
        .select("vendor_code, run_date, run_kind, job_id, claimed_at")
        .gte("run_date", "2026-09-01")
        .order("claimed_at", desc=True)
        .execute()
    )
    for row in claims.data or []:
        print(row)
    if not claims.data:
        print("(none)")
except Exception as exc:
    print(f"claims query failed: {exc}")
