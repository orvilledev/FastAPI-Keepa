"""OBZ / SMW FBA INV splitter API — inventory ledger → two Excel workbooks."""
import csv
import io
import logging
import re

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from supabase import Client

from app.database import get_supabase
from app.middleware.rate_limiter import RateLimits, limiter
from app.repositories.catalog_old_skus_repository import CatalogOldSkusRepository
from app.services.obz_smw_fba_inv import (
    MAX_UPLOAD_BYTES,
    GenerateResult,
    ObzSmwFbaInvError,
    extract_ledger_csv_bytes,
    generate_fba_inv_reports,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_ACCEPTED_SUFFIXES = (".csv", ".zip")
_OLD_SKU_RE = re.compile(r"^999\d+(?:-FNSKU)?$", re.IGNORECASE)


def _safe_disposition_name(filename: str) -> str:
    cleaned = (filename or "OBZ_SMW FBA INV.zip").replace('"', "").replace("\r", "").replace("\n", "")
    return cleaned or "OBZ_SMW FBA INV.zip"


def _collect_old_skus(csv_bytes: bytes) -> list[str]:
    text = csv_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    found: set[str] = set()
    if not reader.fieldnames or "MSKU" not in {(h or "").strip() for h in reader.fieldnames}:
        return []
    for row in reader:
        raw = (row.get("MSKU") or "").strip()
        if not _OLD_SKU_RE.match(raw):
            continue
        found.add(raw[:-6] if raw.upper().endswith("-FNSKU") else raw)
    return sorted(found)


def _old_sku_map_from_catalog(db: Client, old_skus: list[str]) -> dict[str, str]:
    """Build Old SKU → UPC from catalog_old_skus when the table is available."""
    if not old_skus:
        return {}
    try:
        repo = CatalogOldSkusRepository(db)
        rows = repo.lookup_by_upcs_and_old_skus([], old_skus)
        mapping: dict[str, str] = {}
        for row in rows:
            old = str(row.get("old_sku") or "").strip()
            upc = str(row.get("upc_code") or "").strip()
            if old and upc and old != upc:
                mapping[old] = upc
        return mapping
    except Exception as exc:  # noqa: BLE001 — catalog is optional enrichment
        logger.info("OBZ/SMW FBA INV: Old SKUs catalog unavailable (%s)", exc)
        return {}


def _zip_response(result: GenerateResult) -> Response:
    safe_name = _safe_disposition_name(result.zip_filename)
    return Response(
        content=result.zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "X-Obz-Smw-Zip-Filename": safe_name,
            "X-Obz-Smw-Weekly-Filename": result.weekly_filename,
            "X-Obz-Smw-Master-Filename": result.master_filename,
            "X-Obz-Smw-Ledger-Date": result.ledger_date.isoformat(),
            "X-Obz-Smw-Source-Rows": str(result.source_rows),
            "X-Obz-Smw-Obz-Rows": str(result.obz_rows),
            "X-Obz-Smw-Smw-Rows": str(result.smw_rows),
            "X-Obz-Smw-Dropped-Amzn-Rows": str(result.dropped_amzn_rows),
            "X-Obz-Smw-Skipped-Other-Rows": str(result.skipped_other_rows),
        },
    )


@router.post("/obz-smw-fba-inv/generate", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("generate OBZ/SMW FBA INV reports")
async def generate_obz_smw_fba_inv(
    request: Request,
    file: UploadFile = File(..., description="Amazon inventory ledger .csv or .zip"),
    db: Client = Depends(get_supabase),
):
    """Split an Amazon inventory ledger into OBZ weekly + SMW masterfile FBA INV workbooks."""
    name = file.filename or "upload"
    if not name.lower().endswith(_ACCEPTED_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail=f'"{name}" is not supported. Upload a .csv inventory ledger or a .zip containing one.',
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail=f'"{name}" is empty.')
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f'"{name}" is too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).',
        )

    try:
        csv_bytes = extract_ledger_csv_bytes(name, raw)
        extra_old = _old_sku_map_from_catalog(db, _collect_old_skus(csv_bytes))
        result = generate_fba_inv_reports(name, raw, extra_old_sku_to_upc=extra_old)
    except ObzSmwFbaInvError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _zip_response(result)
