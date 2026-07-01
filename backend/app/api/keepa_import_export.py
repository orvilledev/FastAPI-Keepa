"""Keepa Import Export tool API (standalone).

Builds a Keepa-format Excel file (Import Mode schema) for the UPCs that exist in
Manage UPCs for a given vendor. UPCs are read only from the database; the client
cannot supply an arbitrary UPC list, so this tool can never pull Keepa data for
UPCs outside Manage UPCs.

Builds run asynchronously: ``/build`` starts one and returns a build id, the
client polls ``/builds/{id}/status``, can ``/builds/{id}/cancel`` it, and finally
``/builds/{id}/download`` the workbook. A global on/off flag (admin-controlled,
stored in keepa_import_export_settings) gates the tool for all users.
"""
import asyncio
import logging
from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_admin_user, get_keepa_access_user
from app.models.keepa_import_build_history import KeepaImportBuildHistorySummary
from app.repositories.keepa_import_build_history_repository import (
    KeepaImportBuildHistoryRepository,
)
from app.repositories.seller_name_repository import SellerNameRepository
from app.repositories.upc_repository import UPCRepository
from app.services.keepa_import_build_store import keepa_import_build_store
from app.services.keepa_import_export import (
    KeepaBuildCancelled,
    generate_keepa_import_file,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_VALID_CATEGORIES = {"dnk", "clk", "obz", "ref", "bor", "sff", "tev", "cha"}
_EXCEL_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)
_SETTINGS_TABLE = "keepa_import_export_settings"
_SETTINGS_ROW_ID = "00000000-0000-0000-0000-000000000000"


class FeatureToggle(BaseModel):
    enabled: bool


class BuildStartResponse(BaseModel):
    build_id: str
    upc_count: int
    category: str


def _normalize_category(category: str) -> str:
    cat = (category or "").strip().lower()
    if cat not in _VALID_CATEGORIES:
        raise HTTPException(
            status_code=400, detail=f"Unknown vendor category: {category}"
        )
    return cat


def _scoped_upcs(db: Client, category: str) -> list[str]:
    """Return deduped UPCs from Manage UPCs for the vendor (order preserved)."""
    raw_upcs = UPCRepository(db).get_all_upc_codes(category)
    return list(dict.fromkeys(u.strip() for u in raw_upcs if u and u.strip()))


def _seller_name_map(db: Client) -> dict[str, str]:
    """Cached seller id -> name map for buy-box seller display (no Keepa tokens)."""
    try:
        return SellerNameRepository(db).get_seller_name_map()
    except Exception as exc:  # never fail the export over a name lookup
        logger.warning("Could not load seller name map: %s", exc)
        return {}


def _read_enabled(db: Client) -> bool:
    """Read the global on/off flag. Defaults to enabled when row/table missing."""
    try:
        resp = (
            db.table(_SETTINGS_TABLE)
            .select("enabled")
            .eq("id", _SETTINGS_ROW_ID)
            .limit(1)
            .execute()
        )
        if resp.data:
            return bool(resp.data[0].get("enabled", True))
    except Exception as exc:  # table may not exist yet; fail open so tool works
        logger.warning("Could not read keepa import export flag: %s", exc)
    return True


def _require_enabled(db: Client) -> None:
    if not _read_enabled(db):
        raise HTTPException(
            status_code=403,
            detail="The Keepa Import File tool is currently turned off.",
        )


def _history_summary_from_row(row: dict) -> KeepaImportBuildHistorySummary:
    return KeepaImportBuildHistorySummary(**row)


def _keepa_build_creator_name(current_user: dict, db: Client) -> str | None:
    """Return a stable display name snapshot for the user starting a build."""
    profile = {}
    try:
        response = (
            db.table("profiles")
            .select("*")
            .eq("id", current_user["id"])
            .limit(1)
            .execute()
        )
        if response.data:
            profile = response.data[0]
    except Exception as exc:
        logger.warning("Could not load keepa build creator profile: %s", exc)

    metadata = current_user.get("user_metadata") or {}
    candidates = [
        profile.get("display_name"),
        profile.get("full_name"),
        metadata.get("display_name"),
        metadata.get("full_name"),
        metadata.get("name"),
        profile.get("email"),
        current_user.get("email"),
    ]
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _streaming_excel_response(file_bytes: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        BytesIO(file_bytes),
        media_type=_EXCEL_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _status_from_history(row: dict) -> dict:
    """Map a persisted history row to the same shape as in-memory status polling."""
    return {
        "build_id": row["id"],
        "category": row["category"],
        "status": row["status"],
        "phase": row.get("phase") or "",
        "completed": row.get("completed_upcs", 0),
        "total": row.get("upc_count", 0),
        "progress_percent": row.get("progress_percent", 0),
        "message": row.get("message") or "",
        "error": row.get("error"),
        "filename": row.get("filename"),
    }


async def _run_keepa_import_build(
    build_id: str,
    user_id: str,
    cat: str,
    upcs: list[str],
    seller_name_map: dict[str, str],
    include_header: bool,
    db: Client,
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
        build = await keepa_import_build_store.get_for_user(build_id, user_id)
        if build:
            await asyncio.to_thread(
                history.update_progress,
                build_id,
                phase=build.phase,
                completed_upcs=build.completed,
                progress_percent=build.progress_percent,
                message=build.message,
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
        await keepa_import_build_store.complete(build_id, file_bytes, filename)
        await asyncio.to_thread(history.complete, build_id, filename, file_bytes)
    except KeepaBuildCancelled:
        # Status was already set to "cancelled" by the cancel endpoint.
        logger.info("Keepa Import File build %s cancelled by user", build_id)
        await asyncio.to_thread(history.cancel, build_id)
    except Exception as exc:
        logger.exception("Keepa Import File build %s failed", build_id)
        await keepa_import_build_store.fail(build_id, str(exc))
        await asyncio.to_thread(history.fail, build_id, str(exc))


@router.get("/keepa-import-export/settings")
@handle_api_errors("get keepa import export settings")
def get_keepa_import_export_settings(
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Return the global on/off flag (readable by any Keepa-access user)."""
    return {"enabled": _read_enabled(db)}


@router.put("/keepa-import-export/settings")
@handle_api_errors("update keepa import export settings")
def update_keepa_import_export_settings(
    payload: FeatureToggle,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase),
):
    """Enable/disable the tool globally (admin only)."""
    row = {
        "id": _SETTINGS_ROW_ID,
        "enabled": payload.enabled,
        "updated_by": current_user["id"],
        "updated_at": datetime.utcnow().isoformat(),
    }
    db.table(_SETTINGS_TABLE).upsert(row).execute()
    return {"enabled": payload.enabled}


@router.get("/keepa-import-export/{category}/count")
@handle_api_errors("get keepa import export upc count")
def get_keepa_import_export_count(
    category: str,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """How many Manage UPCs would be included for this vendor."""
    cat = _normalize_category(category)
    upcs = _scoped_upcs(db, cat)
    return {"category": cat, "upc_count": len(upcs)}


@router.get("/keepa-import-export/builds/history")
@handle_api_errors("list keepa import build history")
def list_keepa_import_build_history(
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Return all Keepa Import File builds (newest first), visible to every user."""
    rows = KeepaImportBuildHistoryRepository(db).list_all()
    return [_history_summary_from_row(row) for row in rows]


@router.get("/keepa-import-export/builds/history/{build_id}/download")
@handle_api_errors("download keepa import build history file")
def download_keepa_import_build_history(
    build_id: str,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Download a completed build from the persistent history archive."""
    repo = KeepaImportBuildHistoryRepository(db)
    row = repo.get_by_id(build_id)
    if not row:
        raise HTTPException(status_code=404, detail="Build not found.")
    if row.get("status") == "building":
        raise HTTPException(status_code=409, detail="Build is still in progress.")
    if row.get("status") == "failed":
        raise HTTPException(
            status_code=500,
            detail=row.get("error") or "Build failed.",
        )
    file_bytes, filename = repo.get_file_bytes(build_id)
    if not file_bytes or not filename:
        raise HTTPException(status_code=500, detail="Build file is missing.")

    return _streaming_excel_response(file_bytes, filename)


@router.get("/keepa-import-export/builds/active")
@handle_api_errors("get active keepa import build")
async def get_active_keepa_import_build(
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Return the caller's most recent in-memory build so a reopened client can
    resume progress (or download a finished file) without its saved build id."""
    build = await keepa_import_build_store.get_active_for_user(current_user["id"])
    if build:
        return {"build": build.to_status_dict()}

    history_row = await asyncio.to_thread(
        KeepaImportBuildHistoryRepository(db).get_active_for_user,
        current_user["id"],
    )
    if history_row:
        return {"build": _status_from_history(history_row)}
    return {"build": None}


@router.get("/keepa-import-export/builds/{build_id}/status")
@handle_api_errors("get keepa import build status")
async def get_keepa_import_build_status(
    build_id: str,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Poll progress for an async Keepa Import File build."""
    build = await keepa_import_build_store.get_for_user(build_id, current_user["id"])
    if build:
        return build.to_status_dict()

    history_row = await asyncio.to_thread(
        KeepaImportBuildHistoryRepository(db).get_for_user,
        build_id,
        current_user["id"],
    )
    if history_row:
        return _status_from_history(history_row)
    raise HTTPException(status_code=404, detail="Build not found.")


@router.post("/keepa-import-export/builds/{build_id}/cancel")
@handle_api_errors("cancel keepa import build")
async def cancel_keepa_import_build(
    build_id: str,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Stop a still-running Keepa Import File build."""
    build = await keepa_import_build_store.get_for_user(build_id, current_user["id"])
    if not build:
        history_row = await asyncio.to_thread(
            KeepaImportBuildHistoryRepository(db).get_for_user,
            build_id,
            current_user["id"],
        )
        if not history_row:
            raise HTTPException(status_code=404, detail="Build not found.")
        return {
            "build_id": build_id,
            "status": history_row.get("status", "unknown"),
            "cancelled": False,
        }
    cancelled = await keepa_import_build_store.cancel(build_id, current_user["id"])
    if not cancelled:
        # Already finished/failed/cancelled — surface current state, not an error.
        return {"build_id": build_id, "status": build.status, "cancelled": False}
    await asyncio.to_thread(KeepaImportBuildHistoryRepository(db).cancel, build_id)
    return {"build_id": build_id, "status": "cancelled", "cancelled": True}


@router.get("/keepa-import-export/builds/{build_id}/download")
@handle_api_errors("download keepa import build file")
async def download_keepa_import_build(
    build_id: str,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Download a completed async Keepa Import File build."""
    build = await keepa_import_build_store.get_by_id(build_id)
    if build:
        if build.status == "building":
            raise HTTPException(status_code=409, detail="Build is still in progress.")
        if build.status == "failed":
            raise HTTPException(
                status_code=500,
                detail=build.error or "Build failed.",
            )
        if build.file_bytes and build.filename:
            return _streaming_excel_response(build.file_bytes, build.filename)

    repo = KeepaImportBuildHistoryRepository(db)
    row = await asyncio.to_thread(repo.get_by_id, build_id)
    if not row:
        raise HTTPException(status_code=404, detail="Build not found.")
    if row.get("status") == "building":
        raise HTTPException(status_code=409, detail="Build is still in progress.")
    if row.get("status") == "failed":
        raise HTTPException(
            status_code=500,
            detail=row.get("error") or "Build failed.",
        )
    file_bytes, filename = repo.get_file_bytes(build_id)
    if not file_bytes or not filename:
        raise HTTPException(status_code=500, detail="Build file is missing.")

    return _streaming_excel_response(file_bytes, filename)


@router.post("/keepa-import-export/{category}/build", response_model=BuildStartResponse)
@handle_api_errors("start keepa import export build")
async def start_keepa_import_export_build(
    category: str,
    include_header: bool = True,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Start an async Keepa Import File build and return a build id for polling."""
    cat = _normalize_category(category)
    _require_enabled(db)

    upcs = await asyncio.to_thread(_scoped_upcs, db, cat)
    if not upcs:
        raise HTTPException(
            status_code=400,
            detail="No UPCs found in Manage UPCs for this vendor.",
        )

    seller_name_map = await asyncio.to_thread(_seller_name_map, db)
    creator_name = await asyncio.to_thread(_keepa_build_creator_name, current_user, db)
    build_id = await keepa_import_build_store.create(
        current_user["id"], cat, len(upcs)
    )
    await asyncio.to_thread(
        KeepaImportBuildHistoryRepository(db).create,
        build_id,
        current_user["id"],
        cat,
        len(upcs),
        creator_name,
    )
    asyncio.create_task(
        _run_keepa_import_build(
            build_id,
            current_user["id"],
            cat,
            upcs,
            seller_name_map,
            include_header,
            db,
        )
    )
    return BuildStartResponse(build_id=build_id, upc_count=len(upcs), category=cat)


@router.get("/keepa-import-export/{category}/download")
@handle_api_errors("download keepa import export file")
async def download_keepa_import_export(
    category: str,
    include_header: bool = True,
    current_user: dict = Depends(get_keepa_access_user),
    db: Client = Depends(get_supabase),
):
    """Fetch Keepa data for the vendor's Manage UPCs and return an .xlsx file."""
    cat = _normalize_category(category)
    _require_enabled(db)

    # Sync Supabase read off the event loop.
    upcs = await asyncio.to_thread(_scoped_upcs, db, cat)
    if not upcs:
        raise HTTPException(
            status_code=400,
            detail="No UPCs found in Manage UPCs for this vendor.",
        )

    seller_name_map = await asyncio.to_thread(_seller_name_map, db)

    file_bytes = await generate_keepa_import_file(
        upcs, seller_name_map=seller_name_map, include_header=include_header
    )

    filename = f"{cat.upper()}_Keepa_{datetime.now().strftime('%m.%d.%y')}.xlsx"
    return StreamingResponse(
        BytesIO(file_bytes),
        media_type=_EXCEL_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
