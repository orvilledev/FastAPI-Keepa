"""Maps HTTP requests to audit actions, categories, and human-readable labels.

The audit middleware records every mutating request (POST/PUT/PATCH/DELETE) plus
the handful of GET endpoints that stream a file. Read-only GETs are page/data
views and are never recorded.
"""
from __future__ import annotations

import re
from typing import Dict, Iterable, NamedTuple, Optional, Pattern, Set, Tuple

CATEGORIES = (
    "auth",
    "upload",
    "download",
    "playground",
    "tool",
    "email",
    "settings",
    "admin",
    "job",
    "analytics",
    "data",
    "other",
)

_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# GET endpoints that stream a file back. Downloads are actions, not views.
_DOWNLOAD_GETS: Tuple[Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"^/api/v1/reports/[^/]+/csv$",
        r"^/api/v1/tools/micro-tools/[^/]+/download$",
        r"^/api/v1/keepa-import-export/builds/history/[^/]+/download$",
        r"^/api/v1/keepa-import-export/builds/[^/]+/download$",
        r"^/api/v1/keepa-import-export/[^/]+/download$",
    )
)

# Never recorded: background polling/telemetry and the audit endpoints themselves
# (the client POSTs login/logout here, and the handler already writes the row).
_NEVER_LOGGED: Tuple[Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"^/api/v1/audit/events$",
        r"^/api/v1/auth/presence/heartbeat$",
        r"^/api/v1/auth/presence/leave$",
        # Marking notifications read fires automatically when the feed is opened,
        # which makes it a view rather than a deliberate action.
        r"^/api/v1/notifications/read-all$",
        r"^/api/v1/notifications/[^/]+/read$",
        # Automatic side effect of a Tracking Extractor scan, which the client
        # already reports as tracking.scan_browser.
        r"^/api/v1/tracking-scanner/history$",
    )
)

# Routes whose handlers call record_audit_event() directly so they can include
# details the middleware cannot see (such as the uploaded filename). Middleware
# skips these to avoid duplicate rows.
_HANDLER_LOGGED: Tuple[Tuple[Set[str], Pattern[str]], ...] = (
    ({"POST"}, re.compile(r"^/api/v1/scheduler/uploaded-report$")),
    ({"PUT"}, re.compile(r"^/api/v1/scheduler/settings$")),
    ({"DELETE"}, re.compile(r"^/api/v1/scheduler/uploaded-report/[^/]+$")),
    ({"POST"}, re.compile(r"^/api/v1/scheduler/uploaded-report/rerun$")),
    ({"POST"}, re.compile(r"^/api/v1/analytics/off-price/mismatch-test$")),
    ({"POST"}, re.compile(r"^/api/v1/analytics/off-price/mismatch-fix$")),
    ({"DELETE"}, re.compile(r"^/api/v1/analytics/off-price/demo-snapshots$")),
    ({"PUT"}, re.compile(r"^/api/v1/analytics/off-price/tracking/[^/]+$")),
    ({"PUT"}, re.compile(r"^/api/v1/auth/upc-dnk-print-id-allowlist$")),
    ({"GET"}, re.compile(r"^/api/v1/keepa-import-export/builds/history/[^/]+/download$")),
    ({"GET"}, re.compile(r"^/api/v1/keepa-import-export/builds/[^/]+/download$")),
    ({"GET"}, re.compile(r"^/api/v1/keepa-import-export/[^/]+/download$")),
)

# Query parameters that must never be copied into audit metadata.
_SENSITIVE_QUERY_KEYS = frozenset(
    {"token", "access_token", "refresh_token", "password", "apikey", "api_key", "secret"}
)


class AuditDescriptor(NamedTuple):
    action: str
    category: str
    label: str


class _Route(NamedTuple):
    methods: Set[str]
    pattern: Pattern[str]
    action: str
    category: str
    label: str


def _r(methods: str, pattern: str, action: str, category: str, label: str) -> _Route:
    return _Route(set(methods.split()), re.compile(pattern), action, category, label)


# First match wins, so list specific paths before their more general siblings.
_ROUTES: Tuple[_Route, ...] = (
    # --- Keepa Import / Export -------------------------------------------------
    _r("POST", r"^/api/v1/keepa-import-export/[^/]+/build$",
       "keepa.build_start", "tool", "Started a Keepa Import File build"),
    _r("POST", r"^/api/v1/keepa-import-export/builds/[^/]+/cancel$",
       "keepa.build_cancel", "tool", "Cancelled a Keepa Import File build"),
    _r("DELETE", r"^/api/v1/keepa-import-export/builds/history/all$",
       "keepa.history_clear", "data", "Cleared all Keepa Import build history"),
    _r("DELETE", r"^/api/v1/keepa-import-export/builds/history/[^/]+$",
       "keepa.history_delete", "data", "Deleted a Keepa Import build history entry"),
    _r("PUT", r"^/api/v1/keepa-import-export/scheduler/settings$",
       "keepa.scheduler_update", "settings", "Updated Keepa Import scheduler settings"),
    _r("PUT", r"^/api/v1/keepa-import-export/settings$",
       "keepa.settings_update", "settings", "Changed the Keepa Import tool availability"),

    # --- Daily Run scheduler ---------------------------------------------------
    _r("PUT", r"^/api/v1/scheduler/settings$",
       "scheduler.settings_update", "settings", "Updated Daily Run scheduler settings"),
    _r("POST", r"^/api/v1/scheduler/uploaded-report/rerun$",
       "scheduler.upload_rerun", "tool", "Re-ran Import Mode Daily Run from an uploaded Keepa report"),
    _r("DELETE", r"^/api/v1/scheduler/uploaded-report/[^/]+$",
       "scheduler.upload_delete", "data", "Deleted an uploaded Keepa report"),
    _r("POST", r"^/api/v1/scheduler/same-day-run$",
       "scheduler.same_day_create", "job", "Scheduled an extra same-day Daily Run"),
    _r("DELETE", r"^/api/v1/scheduler/same-day-run$",
       "scheduler.same_day_cancel", "job", "Cancelled a pending same-day Daily Run"),

    # --- Analytics -------------------------------------------------------------
    _r("POST", r"^/api/v1/analytics/off-price/download-logs$",
       "analytics.download", "download", "Downloaded the Off-Price Analytics Excel report"),
    _r("POST", r"^/api/v1/analytics/off-price/email-report$",
       "analytics.email", "email", "Emailed the Off-Price Analytics report"),
    _r("PUT", r"^/api/v1/analytics/off-price/tracking/[^/]+$",
       "analytics.tracking_update", "settings", "Changed Analytics vendor tracking"),
    _r("POST", r"^/api/v1/analytics/off-price/mismatch-test$",
       "analytics.mismatch_test", "tool", "Ran the Analytics mismatch test"),
    _r("POST", r"^/api/v1/analytics/off-price/mismatch-fix$",
       "analytics.mismatch_fix", "tool", "Recomputed Analytics to fix a mismatch"),
    _r("DELETE", r"^/api/v1/analytics/off-price/demo-snapshots$",
       "analytics.demo_delete", "data", "Removed Analytics demo snapshots"),
    _r("POST", r"^/api/v1/analytics/off-price/seed-demo-history$",
       "analytics.demo_seed", "data", "Attempted to seed Analytics demo history"),

    # --- Express jobs / reports ------------------------------------------------
    _r("DELETE", r"^/api/v1/jobs/completed$",
       "job.delete_completed", "data", "Deleted all completed Express jobs"),
    _r("POST", r"^/api/v1/jobs/[^/]+/trigger$",
       "job.trigger", "job", "Manually re-ran a job"),
    _r("POST", r"^/api/v1/jobs/[^/]+/stop$",
       "job.stop", "job", "Stopped a running job"),
    _r("PUT", r"^/api/v1/jobs/[^/]+$", "job.update", "job", "Updated job details"),
    _r("DELETE", r"^/api/v1/jobs/[^/]+$", "job.delete", "data", "Deleted a job"),
    _r("POST", r"^/api/v1/jobs$", "job.create", "job", "Created a new Express job"),
    _r("POST", r"^/api/v1/batches/[^/]+/stop$",
       "batch.stop", "job", "Stopped a UPC batch"),
    _r("GET", r"^/api/v1/reports/[^/]+/csv$",
       "report.download", "download", "Downloaded a job report file"),
    _r("POST", r"^/api/v1/reports/[^/]+/email$",
       "report.email", "email", "Re-sent a job report email"),
    _r("POST", r"^/api/v1/reports/test-email$",
       "report.test_email", "email", "Sent a test report email"),

    # --- Manage UPCs / MAP / sellers ------------------------------------------
    _r("POST", r"^/api/v1/upcs$", "upc.add", "data", "Added UPCs to Manage UPCs"),
    _r("DELETE", r"^/api/v1/upcs/[^/]+$", "upc.delete", "data", "Deleted a UPC"),
    _r("DELETE", r"^/api/v1/upcs$", "upc.delete_all", "data", "Deleted all UPCs"),
    _r("POST", r"^/api/v1/map/check-duplicates$",
       "map.check_duplicates", "tool", "Checked MAP rows for duplicates"),
    _r("POST", r"^/api/v1/map/delete-by-upcs$",
       "map.delete_by_upcs", "data", "Deleted MAP rows by UPC"),
    _r("POST", r"^/api/v1/map$", "map.add", "data", "Added MAP entries"),
    _r("DELETE", r"^/api/v1/map/[^/]+$", "map.delete", "data", "Deleted a MAP entry"),
    _r("DELETE", r"^/api/v1/map$", "map.delete_all", "data", "Deleted all MAP entries"),
    _r("POST", r"^/api/v1/sellers/bulk-delete$",
       "seller.bulk_delete", "data", "Bulk-deleted seller names"),
    _r("POST", r"^/api/v1/sellers/bulk$",
       "seller.bulk_upsert", "data", "Bulk-updated seller names"),
    _r("POST", r"^/api/v1/sellers$", "seller.add", "data", "Added a seller name"),
    _r("PUT", r"^/api/v1/sellers/[^/]+$", "seller.update", "data", "Updated a seller name"),
    _r("DELETE", r"^/api/v1/sellers/[^/]+$", "seller.delete", "data", "Deleted a seller name"),

    # --- Email recipients ------------------------------------------------------
    _r("POST", r"^/api/v1/email-recipients/pool/sync-used$",
       "email.pool_sync", "email", "Synced used addresses into the email list"),
    _r("POST", r"^/api/v1/email-recipients/pool$",
       "email.pool_add", "email", "Added an address to the email list"),
    _r("PATCH", r"^/api/v1/email-recipients/pool/[^/]+$",
       "email.pool_update", "email", "Updated an email list entry"),
    _r("DELETE", r"^/api/v1/email-recipients/pool/[^/]+$",
       "email.pool_delete", "email", "Removed an address from the email list"),
    _r("POST", r"^/api/v1/email-recipients/lists$",
       "email.list_create", "email", "Created a saved recipient list"),
    _r("PATCH", r"^/api/v1/email-recipients/lists/[^/]+$",
       "email.list_update", "email", "Updated a saved recipient list"),
    _r("DELETE", r"^/api/v1/email-recipients/lists/[^/]+$",
       "email.list_delete", "email", "Deleted a saved recipient list"),

    # --- Tools -----------------------------------------------------------------
    _r("GET", r"^/api/v1/tools/micro-tools/[^/]+/download$",
       "tool.micro_download", "download", "Downloaded a Work Sheet Template"),
    _r("POST", r"^/api/v1/tools/micro-tools$",
       "tool.micro_create", "tool", "Created a Micro Tool"),
    _r("PUT", r"^/api/v1/tools/micro-tools/[^/]+$",
       "tool.micro_update", "tool", "Updated a Micro Tool"),
    _r("DELETE", r"^/api/v1/tools/micro-tools/[^/]+$",
       "tool.micro_delete", "tool", "Deleted a Micro Tool"),
    _r("POST", r"^/api/v1/tools/public/[^/]+/star$",
       "tool.star", "tool", "Added a tool to My Toolbox"),
    _r("DELETE", r"^/api/v1/tools/public/[^/]+/star$",
       "tool.unstar", "tool", "Removed a tool from My Toolbox"),
    _r("POST", r"^/api/v1/tools/public$", "tool.public_create", "tool", "Created a Public Tool"),
    _r("PUT", r"^/api/v1/tools/public/[^/]+$", "tool.public_update", "tool", "Updated a Public Tool"),
    _r("DELETE", r"^/api/v1/tools/public/[^/]+$", "tool.public_delete", "tool", "Deleted a Public Tool"),
    _r("POST", r"^/api/v1/tools/user$", "tool.user_create", "tool", "Created a personal tool"),
    _r("PUT", r"^/api/v1/tools/user/[^/]+$", "tool.user_update", "tool", "Updated a personal tool"),
    _r("DELETE", r"^/api/v1/tools/user/[^/]+$", "tool.user_delete", "tool", "Deleted a personal tool"),
    _r("POST", r"^/api/v1/tools/job-aids/[^/]+/star$",
       "tool.job_aid_star", "tool", "Starred a Job Aid"),
    _r("DELETE", r"^/api/v1/tools/job-aids/[^/]+/star$",
       "tool.job_aid_unstar", "tool", "Unstarred a Job Aid"),
    _r("POST", r"^/api/v1/tools/job-aids$", "tool.job_aid_create", "tool", "Created a Job Aid"),
    _r("PUT", r"^/api/v1/tools/job-aids/[^/]+$", "tool.job_aid_update", "tool", "Updated a Job Aid"),
    _r("DELETE", r"^/api/v1/tools/job-aids/[^/]+$", "tool.job_aid_delete", "tool", "Deleted a Job Aid"),

    # --- Manifest / tracking / labels -----------------------------------------
    _r("POST", r"^/api/v1/manifest-generator/generate$",
       "manifest.generate", "tool", "Generated Amazon STA manifests"),
    _r("POST", r"^/api/v1/tracking-scanner/scan$",
       "tracking.scan", "tool", "Scanned PDFs with the Tracking Extractor"),
    _r("POST", r"^/api/v1/tracking-scanner/export-csv$",
       "tracking.export_csv", "download", "Exported Tracking Extractor rows to CSV"),
    _r("DELETE", r"^/api/v1/tracking-scanner/history/all$",
       "tracking.history_clear", "data", "Cleared Tracking Extractor history"),
    _r("DELETE", r"^/api/v1/tracking-scanner/history/[^/]+$",
       "tracking.history_delete", "data", "Deleted a Tracking Extractor scan"),
    _r("POST", r"^/api/v1/warehouse-products/import$",
       "warehouse.import", "upload", "Imported the warehouse products spreadsheet"),
    _r("DELETE", r"^/api/v1/warehouse-products/[^/]+$",
       "warehouse.delete", "data", "Deleted a warehouse product"),

    # --- Account / admin -------------------------------------------------------
    _r("POST", r"^/api/v1/auth/users/[^/]+/deactivate$",
       "admin.user_deactivate", "admin", "Deactivated a user"),
    _r("POST", r"^/api/v1/auth/users/[^/]+/approve$",
       "admin.user_approve", "admin", "Approved a pending user"),
    _r("PUT", r"^/api/v1/auth/users/[^/]+/keepa-access$",
       "admin.user_keepa_access", "admin", "Changed a user's app access"),
    _r("PUT", r"^/api/v1/auth/users/[^/]+/tools-access$",
       "admin.user_tools_access", "admin", "Changed a user's tools permission"),
    _r("PUT", r"^/api/v1/auth/users/[^/]+/tasks-access$",
       "admin.user_tasks_access", "admin", "Changed a user's task permission"),
    _r("POST", r"^/api/v1/auth/users$", "admin.user_create", "admin", "Created a user account"),
    _r("PUT", r"^/api/v1/auth/maintenance$",
       "admin.maintenance", "admin", "Changed maintenance mode"),
    _r("PUT", r"^/api/v1/auth/email-transport$",
       "admin.email_transport", "admin", "Changed outbound email transport"),
    _r("PUT", r"^/api/v1/auth/upc-dnk-print-id-allowlist$",
       "admin.upc_dnk_print_id_allowlist", "admin",
       "Updated the Label Station UPC (DNK) Print ID allowlist"),
    _r("POST", r"^/api/v1/auth/mfa/confirm-enrollment$",
       "auth.mfa_enrolled", "auth", "Completed two-factor setup"),
    _r("PUT", r"^/api/v1/auth/profile$", "auth.profile_update", "auth", "Updated their profile"),
    _r("PATCH", r"^/api/v1/auth/me/display-name$",
       "auth.display_name_update", "auth", "Changed their display name"),

    # --- Misc ------------------------------------------------------------------
    _r("POST", r"^/api/v1/feedback$", "feedback.submit", "other", "Submitted feedback"),
    _r("PATCH", r"^/api/v1/feedback/[^/]+$", "feedback.update", "other", "Updated a feedback item"),
    _r("DELETE", r"^/api/v1/feedback/[^/]+$", "feedback.delete", "other", "Deleted a feedback item"),
    _r("POST", r"^/api/v1/cli-chat/turn$", "chat.turn", "tool", "Sent a CLI chat message"),
    _r("POST", r"^/api/v1/dashboard/widgets/order$",
       "dashboard.reorder", "settings", "Rearranged dashboard widgets"),
    _r("POST", r"^/api/v1/quick-access$", "quick_access.create", "settings", "Added a quick-access link"),
    _r("PUT", r"^/api/v1/quick-access/[^/]+$", "quick_access.update", "settings", "Updated a quick-access link"),
    _r("DELETE", r"^/api/v1/quick-access/[^/]+$", "quick_access.delete", "settings", "Deleted a quick-access link"),
    _r("DELETE", r"^/api/v1/notifications/[^/]+$",
       "notification.delete", "other", "Deleted a completed-run notification"),
    _r("DELETE", r"^/api/v1/notifications$",
       "notification.clear", "other", "Cleared all completed-run notifications"),
)

_ID_SEGMENT = re.compile(
    r"^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$",
    re.I,
)


def _matches_any(patterns: Iterable[Pattern[str]], path: str) -> bool:
    return any(p.search(path) for p in patterns)


def should_audit(method: str, path: str) -> bool:
    """True when this request represents an action worth recording."""
    if not path.startswith("/api/v1/"):
        return False
    if _matches_any(_NEVER_LOGGED, path):
        return False
    upper = method.upper()
    if any(upper in methods and pattern.search(path) for methods, pattern in _HANDLER_LOGGED):
        return False
    if upper in _MUTATING_METHODS:
        return True
    if upper == "GET":
        return _matches_any(_DOWNLOAD_GETS, path)
    return False


def _fallback_action(method: str, path: str) -> str:
    trimmed = path[len("/api/v1/"):] if path.startswith("/api/v1/") else path
    parts = [seg for seg in trimmed.split("/") if seg and not _ID_SEGMENT.match(seg)]
    slug = "_".join(parts) or "request"
    slug = re.sub(r"[^a-z0-9_.]+", "_", slug.lower()).strip("_.")
    return f"{method.lower()}.{slug}"[:64] or "other.request"


def describe(
    method: str,
    path: str,
    query: Optional[Dict[str, str]] = None,
) -> AuditDescriptor:
    """Resolve an action slug, category, and human label for a request.

    When ``query`` includes values the UI already sends (for example ``category``),
    the label is enriched so Audit Log shows what actually happened.
    """
    upper = method.upper()
    query = query or {}
    matched: Optional[_Route] = None
    for route in _ROUTES:
        if upper in route.methods and route.pattern.search(path):
            matched = route
            break

    if matched is None:
        verb = {
            "POST": "Created or ran",
            "PUT": "Updated",
            "PATCH": "Updated",
            "DELETE": "Deleted",
            "GET": "Downloaded",
        }.get(upper, "Performed")
        return AuditDescriptor(
            _fallback_action(upper, path),
            "other",
            f"{verb}: {upper} {path}",
        )

    label = _enrich_label(matched.action, matched.label, path, query)
    return AuditDescriptor(matched.action, matched.category, label)


def _enrich_label(
    action: str,
    base_label: str,
    path: str,
    query: Dict[str, str],
) -> str:
    """Attach vendor/category and other path/query identity to a base label."""
    category = (query.get("category") or "").strip().upper()
    vendor = (query.get("vendor_code") or "").strip().upper()
    enabled_raw = (query.get("enabled") or "").strip().lower()

    if action == "scheduler.settings_update" and category:
        return f"Updated {category} Daily Run scheduler settings"
    if action == "scheduler.upload_delete" and category:
        return f"Deleted an uploaded Keepa report for {category}"
    if action == "scheduler.upload_rerun" and category:
        return f"Re-ran {category} Import Mode Daily Run from the uploaded Keepa report"
    if action == "scheduler.same_day_create" and category:
        return f"Scheduled an extra same-day Daily Run for {category}"
    if action == "scheduler.same_day_cancel" and category:
        return f"Cancelled a pending same-day Daily Run for {category}"
    if action == "keepa.scheduler_update" and category:
        return f"Updated Keepa Import scheduler settings for {category}"
    if action.startswith("keepa.") and category and "for " not in base_label.lower():
        return f"{base_label} for {category}"

    if action == "analytics.tracking_update":
        # Path: /api/v1/analytics/off-price/tracking/{vendor_code}
        parts = [p for p in path.split("/") if p]
        code = (parts[-1] if parts else "").upper()
        if enabled_raw in ("true", "1", "yes"):
            return f"Started Analytics tracking for {code}" if code else base_label
        if enabled_raw in ("false", "0", "no"):
            return f"Stopped Analytics tracking for {code}" if code else base_label
        return f"Changed Analytics tracking for {code}" if code else base_label

    if action in ("analytics.mismatch_test", "analytics.mismatch_fix"):
        offset = (query.get("offset") or "").strip()
        if offset and offset != "0":
            return f"{base_label} (UTC day offset {offset})"
        return base_label

    if action in ("job.trigger", "job.stop", "job.update", "job.delete"):
        job_id = _last_path_id(path)
        if job_id:
            short = job_id if len(job_id) <= 12 else f"{job_id[:8]}…"
            verb = {
                "job.trigger": "Manually re-ran job",
                "job.stop": "Stopped running job",
                "job.update": "Updated job",
                "job.delete": "Deleted job",
            }[action]
            return f"{verb} {short}"

    if action in ("report.download", "report.email"):
        job_id = _last_path_id(path, before_last=("csv", "email"))
        if job_id:
            short = job_id if len(job_id) <= 12 else f"{job_id[:8]}…"
            if action == "report.download":
                return f"Downloaded report file for job {short}"
            return f"Re-sent report email for job {short}"

    if action == "upc.delete":
        upc = _last_path_segment(path)
        if upc:
            return f"Deleted UPC {upc}"

    if action == "warehouse.delete":
        upc = _last_path_segment(path)
        if upc:
            return f"Deleted warehouse product {upc}"

    if vendor and action.startswith("analytics."):
        return f"{base_label} ({vendor})"

    if category and action.startswith(("upc.", "map.")) and "for " not in base_label.lower():
        # Some UPC/MAP endpoints pass category as query.
        return f"{base_label} ({category})"

    return base_label


def _last_path_segment(path: str) -> str:
    parts = [p for p in path.split("/") if p]
    return parts[-1] if parts else ""


def _last_path_id(path: str, before_last: Tuple[str, ...] = ()) -> str:
    parts = [p for p in path.split("/") if p]
    if before_last and parts and parts[-1] in before_last and len(parts) >= 2:
        return parts[-2]
    return parts[-1] if parts else ""


def safe_query_metadata(query_string: str, limit: int = 8) -> Dict[str, str]:
    """Return a small, redacted copy of the query string for audit metadata."""
    if not query_string:
        return {}
    from urllib.parse import parse_qsl

    out: Dict[str, str] = {}
    try:
        pairs = parse_qsl(query_string, keep_blank_values=False)
    except Exception:
        return {}
    for key, value in pairs:
        if len(out) >= limit:
            break
        if key.lower() in _SENSITIVE_QUERY_KEYS:
            continue
        out[key[:40]] = str(value)[:120]
    return out


def category_for(action: str, fallback: str = "other") -> Optional[str]:
    """Best-effort category lookup for an action slug (used for client events)."""
    for route in _ROUTES:
        if route.action == action:
            return route.category
    prefix = action.split(".", 1)[0]
    mapping = {
        "playground": "playground",
        "fnsku": "tool",
        "tracking": "tool",
        "label_station": "tool",
        "analytics": "analytics",
        "keepa": "tool",
        "auth": "auth",
        "login": "auth",
        "logout": "auth",
        "email": "email",
    }
    return mapping.get(prefix, fallback)
