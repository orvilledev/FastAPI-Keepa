"""Keepa Import Export tool API (standalone).

Builds a Keepa-format Excel file (Import Mode schema) for the UPCs that exist in
Manage UPCs for a given vendor, and can kick off a standard Express Job for the
same vendor scope. UPCs are read only from the database; the client cannot
supply an arbitrary UPC list, so this tool can never pull Keepa data for UPCs
outside Manage UPCs.

A global on/off flag (admin-controlled, stored in keepa_import_export_settings)
gates the download and express-job actions for all users. The flag does not
affect any other tool.
"""
import asyncio
import logging
from datetime import datetime
from io import BytesIO
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from supabase import Client

from app.config import settings
from app.database import get_supabase
from app.dependencies import get_admin_user, get_job_runner_user, get_keepa_access_user
from app.repositories.seller_name_repository import SellerNameRepository
from app.repositories.upc_repository import UPCRepository
from app.services.batch_processor import BatchProcessor
from app.services.keepa_import_export import generate_keepa_import_file
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_VALID_CATEGORIES = {"dnk", "clk", "obz", "ref", "bor", "sff", "tev", "cha"}
_EXCEL_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)
_SETTINGS_TABLE = "keepa_import_export_settings"
_SETTINGS_ROW_ID = "00000000-0000-0000-0000-000000000000"
# Express runs flag both buy-box and non-buy-box sellers below MAP, matching daily runs.
_EXPRESS_OFF_PRICE_SCOPE = "buybox_and_non_buybox_below_map"


class FeatureToggle(BaseModel):
    enabled: bool


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


@router.post("/keepa-import-export/{category}/run-express-job")
@handle_api_errors("run keepa import export express job")
async def run_keepa_import_export_express_job(
    category: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_job_runner_user),
    db: Client = Depends(get_supabase),
):
    """Create + start a standard Express Job for the vendor's Manage UPCs (API mode)."""
    cat = _normalize_category(category)
    _require_enabled(db)

    upcs = await asyncio.to_thread(_scoped_upcs, db, cat)
    if not upcs:
        raise HTTPException(
            status_code=400,
            detail="No UPCs found in Manage UPCs for this vendor.",
        )

    processor = BatchProcessor()
    job_name = (
        f"Express {cat.upper()} Off Price Report - "
        f"{datetime.now().strftime('%Y-%m-%d %H:%M')}"
    )
    job_id = await processor.create_batch_job(
        job_name=job_name,
        upcs=upcs,
        created_by=UUID(current_user["id"]),
        keepa_offers_limit=settings.keepa_offers_limit,
        map_vendor_type=cat,
        off_price_scope=_EXPRESS_OFF_PRICE_SCOPE,
    )
    background_tasks.add_task(processor.process_job, job_id)

    return {"job_id": str(job_id), "upc_count": len(upcs)}
