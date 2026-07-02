"""Launch and run Keepa Import File builds (manual and scheduled)."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from supabase import Client

from app.repositories.keepa_import_build_history_repository import (
    KeepaImportBuildHistoryRepository,
)
from app.repositories.seller_name_repository import SellerNameRepository
from app.repositories.upc_repository import UPCRepository
from app.services.keepa_import_build_store import (
    KeepaImportBuildBusyError,
    keepa_import_build_store,
)
from app.services.keepa_import_export import (
    KeepaBuildCancelled,
    generate_keepa_import_file,
)
from app.services.keepa_import_off_price_report import (
    _load_off_price_settings,
    send_keepa_import_off_price_email,
)
from app.utils.email_recipient_utils import parse_recipient_csv
from app.utils.user_display_name import format_stored_creator_name

logger = logging.getLogger(__name__)

VALID_CATEGORIES = frozenset({"dnk", "clk", "obz", "ref", "bor", "sff", "tev", "cha"})

# Orphaned DB rows with no heartbeat for this long are failed by the sweeper.
_STALE_HEARTBEAT_MINUTES = 5
# How often the background sweeper checks for orphans / hung builds.
_SWEEP_INTERVAL_SECONDS = 60

_ORPHAN_FAIL_MESSAGE = (
    "Build interrupted when the server restarted or lost connection. "
    "Please start a new build."
)
_STALE_FAIL_MESSAGE = (
    "Build stopped because progress was not updated for several minutes. "
    "Please start a new build."
)

_running_build_ids: set[str] = set()
_sweeper_task: Optional[asyncio.Task] = None

_last_persisted_phase: dict[str, str] = {}
_last_persisted_percent: dict[str, int] = {}


def _should_force_progress_persist(build_id: str, phase: str, progress_percent: int) -> bool:
    """Bypass DB throttle on phase changes and any forward progress jump."""
    if _last_persisted_phase.get(build_id) != phase:
        return True
    if phase == "excel":
        return True
    return progress_percent > _last_persisted_percent.get(build_id, 0)


def _record_persisted_progress(build_id: str, phase: str, progress_percent: int) -> None:
    _last_persisted_phase[build_id] = phase
    _last_persisted_percent[build_id] = progress_percent


def _clear_persisted_progress(build_id: str) -> None:
    _last_persisted_phase.pop(build_id, None)
    _last_persisted_percent.pop(build_id, None)


@dataclass
class KeepaImportEmailNotify:
    recipients: Optional[str]
    bcc_recipients: Optional[str]
    category: str


def _scoped_upcs(db: Client, category: str) -> list[str]:
    raw_upcs = UPCRepository(db).get_all_upc_codes(category)
    return list(dict.fromkeys(u.strip() for u in raw_upcs if u and u.strip()))


def _seller_name_map(db: Client) -> dict[str, str]:
    try:
        return SellerNameRepository(db).get_seller_name_map()
    except Exception as exc:
        logger.warning("Could not load seller name map: %s", exc)
        return {}


@dataclass
class GlobalActiveBuildInfo:
    build_id: str
    category: str
    created_by_name: Optional[str] = None
    progress_percent: int = 0
    user_id: Optional[str] = None


def global_busy_detail(info: GlobalActiveBuildInfo) -> str:
    """User-facing message when another Keepa Import build is in progress."""
    vendor = info.category.upper()
    who_name = format_stored_creator_name(info.created_by_name)
    who = f" (started by {who_name})" if who_name else ""
    progress = (
        f" · {info.progress_percent}% complete"
        if info.progress_percent and info.progress_percent > 0
        else ""
    )
    return (
        f"The app is busy building a Keepa file for {vendor}{who}{progress}. "
        "Please wait until it finishes before starting another build."
    )


def _parse_updated_at(value: object) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def is_keepa_import_build_task_running(build_id: str) -> bool:
    """True when this process has an asyncio worker for the build."""
    return build_id in _running_build_ids


async def is_keepa_import_build_live(build_id: str) -> bool:
    """True when a build is actively running on this worker."""
    if is_keepa_import_build_task_running(build_id):
        return True
    build = await keepa_import_build_store.get_by_id(build_id)
    return bool(build and build.status == "building")


async def _fail_orphan_build(
    db: Client,
    build_id: str,
    *,
    message: str = _ORPHAN_FAIL_MESSAGE,
) -> bool:
    """Mark a dead build failed in memory and DB. Returns True if it was orphaned."""
    if await is_keepa_import_build_live(build_id):
        return False
    repo = KeepaImportBuildHistoryRepository(db)
    row = await asyncio.to_thread(repo.get_by_id, build_id)
    if not row or row.get("status") != "building":
        return False
    logger.warning("Failing orphaned Keepa Import build %s (%s)", build_id, row.get("category"))
    await keepa_import_build_store.fail(build_id, message)
    await asyncio.to_thread(repo.fail, build_id, message)
    _clear_persisted_progress(build_id)
    return True


async def reconcile_orphaned_keepa_import_builds(
    db: Client,
    *,
    stale_minutes: int = 0,
) -> int:
    """Fail DB rows still marked building but with no live worker on this process.

  When ``stale_minutes`` is 0 (startup), every orphan is failed immediately.
  During periodic sweeps, only rows whose ``updated_at`` is older than
  ``stale_minutes`` are touched so brief API hiccups do not cancel healthy builds.
    """
    repo = KeepaImportBuildHistoryRepository(db)
    if stale_minutes <= 0:
        rows = await asyncio.to_thread(repo.list_building)
    else:
        rows = await asyncio.to_thread(
            repo.list_stale_building, older_than_minutes=stale_minutes
        )

    reconciled = 0
    for row in rows:
        build_id = str(row.get("id") or "")
        if not build_id:
            continue
        if await is_keepa_import_build_live(build_id):
            continue
        if stale_minutes > 0:
            updated = _parse_updated_at(row.get("updated_at"))
            if updated is not None:
                age_minutes = (
                    datetime.now(timezone.utc) - updated
                ).total_seconds() / 60.0
                if age_minutes < stale_minutes:
                    continue
        if await _fail_orphan_build(db, build_id):
            reconciled += 1
    if reconciled:
        logger.info("Reconciled %d orphaned Keepa Import build(s)", reconciled)
    return reconciled


async def reconcile_stale_keepa_import_builds(
    db: Client,
    *,
    older_than_minutes: int = 0,
) -> int:
    """Backward-compatible alias used on startup."""
    return await reconcile_orphaned_keepa_import_builds(
        db, stale_minutes=older_than_minutes
    )


async def _reconcile_stale_running_builds(db: Client) -> int:
    """Fail builds whose worker is running but DB heartbeat stopped updating."""
    repo = KeepaImportBuildHistoryRepository(db)
    rows = await asyncio.to_thread(
        repo.list_stale_building, older_than_minutes=_STALE_HEARTBEAT_MINUTES
    )
    reconciled = 0
    for row in rows:
        build_id = str(row.get("id") or "")
        if not build_id or not is_keepa_import_build_task_running(build_id):
            continue
        logger.warning(
            "Failing stale Keepa Import build %s (%s) — no progress heartbeat",
            build_id,
            row.get("category"),
        )
        await keepa_import_build_store.force_cancel(build_id)
        await asyncio.to_thread(repo.fail, build_id, _STALE_FAIL_MESSAGE)
        _running_build_ids.discard(build_id)
        _clear_persisted_progress(build_id)
        reconciled += 1
    return reconciled


async def _keepa_import_build_sweeper_loop() -> None:
    while True:
        try:
            await asyncio.sleep(_SWEEP_INTERVAL_SECONDS)
            from app.database import get_supabase

            db = get_supabase()
            await reconcile_orphaned_keepa_import_builds(
                db, stale_minutes=_STALE_HEARTBEAT_MINUTES
            )
            await _reconcile_stale_running_builds(db)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Keepa Import build sweeper error: %s", exc)


def start_keepa_import_build_sweeper() -> None:
    """Start the periodic orphan/stale build sweeper (idempotent)."""
    global _sweeper_task
    if _sweeper_task is not None and not _sweeper_task.done():
        return
    _sweeper_task = asyncio.create_task(_keepa_import_build_sweeper_loop())


async def stop_keepa_import_build_sweeper() -> None:
    """Stop the periodic sweeper on shutdown."""
    global _sweeper_task
    if _sweeper_task is None:
        return
    _sweeper_task.cancel()
    try:
        await _sweeper_task
    except asyncio.CancelledError:
        pass
    _sweeper_task = None


def category_has_active_build(db: Client, category: str) -> bool:
    """True if a Keepa Import build is already running for this vendor."""
    try:
        resp = (
            db.table("keepa_import_build_history")
            .select("id")
            .eq("category", category)
            .eq("status", "building")
            .limit(1)
            .execute()
        )
        if resp.data:
            return True
    except Exception as exc:
        logger.warning("Could not check keepa import build history: %s", exc)
    return False


async def _global_active_from_history_row(
    db: Client, row: dict
) -> Optional[GlobalActiveBuildInfo]:
    build_id = str(row.get("id") or "")
    if not build_id:
        return None
    if not await is_keepa_import_build_live(build_id):
        await _fail_orphan_build(db, build_id)
        return None
    return GlobalActiveBuildInfo(
        build_id=build_id,
        category=row.get("category", ""),
        created_by_name=row.get("created_by_name"),
        progress_percent=int(row.get("progress_percent") or 0),
        user_id=str(row.get("user_id")) if row.get("user_id") else None,
    )


async def is_category_build_active(db: Client, category: str) -> bool:
    if await keepa_import_build_store.has_active_build_for_category(category):
        return True
    repo = KeepaImportBuildHistoryRepository(db)
    row = await asyncio.to_thread(repo.get_any_active_build)
    if not row or row.get("category", "").lower() != category.strip().lower():
        return False
    build_id = str(row.get("id") or "")
    return bool(build_id) and await is_keepa_import_build_live(build_id)


async def get_global_active_build(db: Client) -> Optional[GlobalActiveBuildInfo]:
    """Return the single in-progress Keepa Import build, if any."""
    repo = KeepaImportBuildHistoryRepository(db)
    in_memory = await keepa_import_build_store.get_any_active_build()
    if in_memory:
        created_by_name = None
        row = await asyncio.to_thread(repo.get_by_id, in_memory.build_id)
        if row:
            created_by_name = row.get("created_by_name")
        return GlobalActiveBuildInfo(
            build_id=in_memory.build_id,
            category=in_memory.category,
            created_by_name=created_by_name,
            progress_percent=in_memory.progress_percent,
            user_id=in_memory.user_id,
        )

    row = await asyncio.to_thread(repo.get_any_active_build)
    if not row:
        return None
    return await _global_active_from_history_row(db, row)


async def is_global_build_active(db: Client) -> bool:
    return (await get_global_active_build(db)) is not None


async def _send_completion_email(
    file_bytes: bytes,
    filename: str,
    category: str,
    upc_count: int,
    notify: KeepaImportEmailNotify,
) -> None:
    recipients = (notify.recipients or "").strip()
    bcc_raw = (notify.bcc_recipients or "").strip()
    if not recipients and not bcc_raw:
        return

    from app.services.email_service import EmailService

    bcc_list = parse_recipient_csv(bcc_raw) if bcc_raw else []
    vendor_upper = category.upper()
    subject = f"Keepa Import File - {vendor_upper} ({filename})"
    body = (
        f"The scheduled Keepa Import File build for {vendor_upper} completed.\n\n"
        f"UPCs in file: {upc_count}\n"
        f"Filename: {filename}\n\n"
        "The Excel file is attached."
    )
    await asyncio.to_thread(
        EmailService().send_binary_attachment,
        file_bytes,
        filename,
        subject,
        body,
        recipients or None,
        bcc_list,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        False,
    )


async def _maybe_send_off_price_after_build(
    db: Client,
    build_id: str,
    category: str,
    file_bytes: bytes,
) -> None:
    settings_row = await asyncio.to_thread(_load_off_price_settings, db, category)
    if not settings_row.get("off_price_send_after_build", True):
        return
    recipients = (settings_row.get("off_price_email_recipients") or "").strip()
    bcc = (settings_row.get("off_price_email_bcc_recipients") or "").strip()
    if not recipients and not bcc:
        return
    await asyncio.to_thread(
        send_keepa_import_off_price_email,
        db,
        build_id=build_id,
        category=category,
        file_bytes=file_bytes,
        email_recipients=settings_row.get("off_price_email_recipients"),
        email_bcc_recipients=settings_row.get("off_price_email_bcc_recipients"),
        email_subject_template=settings_row.get("off_price_email_subject_template"),
        email_body_template=settings_row.get("off_price_email_body_template"),
    )


async def run_keepa_import_build(
    build_id: str,
    user_id: str,
    cat: str,
    upcs: list[str],
    seller_name_map: dict[str, str],
    include_header: bool,
    db: Client,
    email_notify: Optional[KeepaImportEmailNotify] = None,
) -> None:
    """Background task: fetch Keepa data and store the finished workbook."""
    enrich_total = 0
    history = KeepaImportBuildHistoryRepository(db)

    async def on_progress(
        completed: int,
        total: int,
        phase: str,
        message: str,
        enrich_total_arg: int,
        phase_completed: int,
    ) -> None:
        nonlocal enrich_total
        if enrich_total_arg:
            enrich_total = enrich_total_arg
        await keepa_import_build_store.update_progress(
            build_id,
            phase=phase,
            completed=completed,
            phase_completed=phase_completed,
            total=total,
            message=message,
            enrich_total=enrich_total or None,
        )
        if keepa_import_build_store.is_cancelled(build_id):
            return
        build = await keepa_import_build_store.get_by_id(build_id)
        if build and build.status == "building":
            force = _should_force_progress_persist(
                build_id, build.phase, build.progress_percent
            )
            await asyncio.to_thread(
                history.update_progress,
                build_id,
                phase=build.phase,
                completed_upcs=build.completed,
                progress_percent=build.progress_percent,
                message=build.message,
                force=force,
            )
            if force:
                _record_persisted_progress(
                    build_id, build.phase, build.progress_percent
                )

    def should_cancel() -> bool:
        return keepa_import_build_store.is_cancelled(build_id)

    try:
        file_bytes = await generate_keepa_import_file(
            upcs,
            seller_name_map=seller_name_map,
            include_header=include_header,
            on_progress=on_progress,
            should_cancel=should_cancel,
        )
        filename = f"{cat.upper()}_Keepa_{datetime.now().strftime('%m.%d.%y')}.xlsx"
        await keepa_import_build_store.update_progress(
            build_id,
            phase="excel",
            message="Saving file to archive…",
        )
        build = await keepa_import_build_store.get_by_id(build_id)
        if build and build.status == "building":
            await asyncio.to_thread(
                history.update_progress,
                build_id,
                phase=build.phase,
                completed_upcs=build.completed,
                progress_percent=build.progress_percent,
                message=build.message,
                force=True,
            )
            _record_persisted_progress(
                build_id, build.phase, build.progress_percent
            )
        await keepa_import_build_store.complete(build_id, file_bytes, filename)
        await asyncio.to_thread(history.complete, build_id, filename, file_bytes)
        if email_notify:
            await _send_completion_email(
                file_bytes, filename, cat, len(upcs), email_notify
            )
        await _maybe_send_off_price_after_build(db, build_id, cat, file_bytes)
    except KeepaBuildCancelled:
        logger.info("Keepa Import File build %s cancelled", build_id)
        await asyncio.to_thread(history.cancel, build_id)
    except Exception as exc:
        logger.exception("Keepa Import File build %s failed", build_id)
        await keepa_import_build_store.fail(build_id, str(exc))
        await asyncio.to_thread(history.fail, build_id, str(exc))
    finally:
        _clear_persisted_progress(build_id)


async def _run_build_task(
    build_id: str,
    user_id: str,
    cat: str,
    upcs: list[str],
    seller_name_map: dict[str, str],
    include_header: bool,
    db: Client,
    email_notify: Optional[KeepaImportEmailNotify] = None,
) -> None:
    _running_build_ids.add(build_id)
    try:
        await run_keepa_import_build(
            build_id,
            user_id,
            cat,
            upcs,
            seller_name_map,
            include_header,
            db,
            email_notify=email_notify,
        )
    finally:
        _running_build_ids.discard(build_id)


async def launch_keepa_import_build(
    db: Client,
    user_id: str,
    category: str,
    *,
    created_by_name: Optional[str] = None,
    include_header: bool = True,
    email_notify: Optional[KeepaImportEmailNotify] = None,
) -> str:
    """Start an async Keepa Import File build. Returns build_id."""
    cat = category.strip().lower()
    if cat not in VALID_CATEGORIES:
        raise ValueError(f"Unknown vendor category: {category}")

    await reconcile_orphaned_keepa_import_builds(db, stale_minutes=0)

    active = await get_global_active_build(db)
    if active:
        raise RuntimeError(global_busy_detail(active))

    upcs = await asyncio.to_thread(_scoped_upcs, db, cat)
    if not upcs:
        raise ValueError("No UPCs found in Manage UPCs for this vendor.")

    seller_name_map = await asyncio.to_thread(_seller_name_map, db)
    try:
        build_id = await keepa_import_build_store.create(user_id, cat, len(upcs))
    except KeepaImportBuildBusyError as exc:
        busy = GlobalActiveBuildInfo(
            build_id=exc.build.build_id,
            category=exc.build.category,
            progress_percent=exc.build.progress_percent,
            user_id=exc.build.user_id,
        )
        row = await asyncio.to_thread(
            KeepaImportBuildHistoryRepository(db).get_by_id, exc.build.build_id
        )
        if row:
            busy.created_by_name = row.get("created_by_name")
        raise RuntimeError(global_busy_detail(busy)) from exc
    await asyncio.to_thread(
        KeepaImportBuildHistoryRepository(db).create,
        build_id,
        user_id,
        cat,
        len(upcs),
        created_by_name,
    )
    asyncio.create_task(
        _run_build_task(
            build_id,
            user_id,
            cat,
            upcs,
            seller_name_map,
            include_header,
            db,
            email_notify=email_notify,
        )
    )
    return build_id
