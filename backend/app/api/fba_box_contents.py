"""FBA Box Contents API — Tool #1, Tool #2, OBZ, and DNK converters."""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_fba_box_contents_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.repositories.catalog_old_skus_repository import CatalogOldSkusRepository
from app.services.fba_box_contents import (
    DEFAULT_OUTPUT_FILENAME,
    FbaBoxContentsError,
    generate_fba_box_contents,
    sanitize_download_filename,
)
from app.services.fba_box_contents_dnk import (
    DEFAULT_OUTPUT_FILENAME as DNK_DEFAULT_OUTPUT_FILENAME,
    FbaBoxContentsDnkError,
    generate_fba_box_contents_dnk,
    sanitize_download_filename as sanitize_dnk_download_filename,
)
from app.services.fba_box_contents_dnk_compare import (
    FbaBoxContentsDnkCompareError,
    generate_dnk_box_contents_compare,
    parse_dnk_box_contents,
    parse_manifest,
    sanitize_download_filename as sanitize_dnk_compare_download_filename,
)
from app.services.fba_box_contents_obz import (
    DEFAULT_OUTPUT_FILENAME as OBZ_DEFAULT_OUTPUT_FILENAME,
    FbaBoxContentsObzError,
    generate_fba_box_contents_obz,
    sanitize_download_filename as sanitize_obz_download_filename,
)
from app.services.fba_box_contents_tool2 import (
    DEFAULT_OUTPUT_FILENAME as TOOL2_DEFAULT_OUTPUT_FILENAME,
    FbaBoxContentsTool2Error,
    generate_fba_box_contents_tool2,
    sanitize_download_filename as sanitize_tool2_download_filename,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_BYTES = 15 * 1024 * 1024


def _validate_upload(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not (name.endswith(".xls") or name.endswith(".xlsx") or name.endswith(".xlsm")):
        raise HTTPException(
            status_code=400,
            detail="Only FBA Carton Detail .xls or .xlsx Excel files are supported.",
        )


def _response_headers(safe_name: str, result) -> dict[str, str]:
    return {
        "Content-Disposition": f'attachment; filename="{safe_name}"',
        "X-Fba-Filename": safe_name,
        "X-Fba-Row-Count": str(result.row_count),
        "X-Fba-Box-Count": str(result.box_count),
        "X-Fba-Upc-Count": str(result.upc_count),
        "X-Fba-Total-Qty": str(result.total_qty),
        "X-Fba-Shipment-Id": result.shipment_id,
    }


@router.post("/fba-box-contents/generate", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("generate FBA Box Contents workbook")
async def generate_fba_box_contents_file(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_fba_box_contents_user),
):
    """Tool #1 — FBA Carton Detail dump into Box Contents + Dimensions Excel."""
    _ = current_user
    _validate_upload(file)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 15 MB).")

    try:
        result = generate_fba_box_contents(raw, file.filename or DEFAULT_OUTPUT_FILENAME)
    except FbaBoxContentsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    safe_name = sanitize_download_filename(result.filename, DEFAULT_OUTPUT_FILENAME)
    return Response(
        content=result.file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=_response_headers(safe_name, result),
    )


@router.post("/fba-box-contents/generate-tool2", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("generate FBA Box Contents Tool #2 workbook")
async def generate_fba_box_contents_tool2_file(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_fba_box_contents_user),
):
    """Tool #2 — spaced PO# carton dump into Box Number + Total-weight Dimensions."""
    _ = current_user
    _validate_upload(file)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 15 MB).")

    try:
        result = generate_fba_box_contents_tool2(
            raw, file.filename or TOOL2_DEFAULT_OUTPUT_FILENAME
        )
    except FbaBoxContentsTool2Error as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    safe_name = sanitize_tool2_download_filename(
        result.filename, TOOL2_DEFAULT_OUTPUT_FILENAME
    )
    return Response(
        content=result.file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=_response_headers(safe_name, result),
    )


@router.post("/fba-box-contents/generate-obz", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("generate FBA Box Contents OBZ workbook")
async def generate_fba_box_contents_obz_file(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_fba_box_contents_user),
):
    """OBZ Tool — Oboz packing slip by carton into Box Number, UPC, Qty."""
    _ = current_user
    _validate_upload(file)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 15 MB).")

    try:
        result = generate_fba_box_contents_obz(
            raw, file.filename or OBZ_DEFAULT_OUTPUT_FILENAME
        )
    except FbaBoxContentsObzError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    safe_name = sanitize_obz_download_filename(result.shipment_id)
    return Response(
        content=result.file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=_response_headers(safe_name, result),
    )


@router.post("/fba-box-contents/generate-dnk", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("generate FBA Box Contents DNK workbook")
async def generate_fba_box_contents_dnk_file(
    request: Request,
    file: UploadFile = File(...),
    current_user=Depends(get_fba_box_contents_user),
):
    """DNK Tool — DNK Carton Contents List into Contents + Dimensions."""
    _ = current_user
    _validate_upload(file)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 15 MB).")

    try:
        result = generate_fba_box_contents_dnk(
            raw, file.filename or DNK_DEFAULT_OUTPUT_FILENAME
        )
    except FbaBoxContentsDnkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    safe_name = sanitize_dnk_download_filename(result.shipment_id)
    return Response(
        content=result.file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=_response_headers(safe_name, result),
    )


@router.post("/fba-box-contents/compare-dnk", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("compare DNK Box Contents to manifest")
async def compare_dnk_box_contents_to_manifest(
    request: Request,
    box_contents_file: UploadFile = File(..., description="DNK Box Contents.xlsx"),
    manifest_file: UploadFile = File(..., description="Amazon Seller Central manifest.xlsx"),
    current_user=Depends(get_fba_box_contents_user),
    db: Client = Depends(get_supabase),
):
    """DNK Tool — compare Box Contents to the manifest and download a corrected workbook."""
    _ = current_user
    _validate_upload(box_contents_file)
    _validate_upload(manifest_file)

    box_raw = await box_contents_file.read()
    if not box_raw:
        raise HTTPException(status_code=400, detail="Box Contents file is empty.")
    if len(box_raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="Box Contents file is too large (max 15 MB).")

    manifest_raw = await manifest_file.read()
    if not manifest_raw:
        raise HTTPException(status_code=400, detail="Manifest file is empty.")
    if len(manifest_raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="Manifest file is too large (max 15 MB).")

    try:
        parsed_box = parse_dnk_box_contents(
            box_raw, filename=box_contents_file.filename
        )
        parsed_manifest = parse_manifest(manifest_raw)
    except FbaBoxContentsDnkCompareError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    output_upcs = sorted({row.identifier for row in parsed_box.rows})
    amz_ids = sorted({row.sku_id for row in parsed_manifest.skus})
    repo = CatalogOldSkusRepository(db)
    try:
        catalog_rows = repo.lookup_by_upcs_and_old_skus(output_upcs, amz_ids)
    except Exception as exc:
        logger.error("Old SKUs lookup failed for DNK compare: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to look up Old SKUs catalog mappings.",
        ) from exc

    try:
        result = generate_dnk_box_contents_compare(
            box_raw,
            manifest_raw,
            catalog_rows,
            box_contents_filename=box_contents_file.filename,
            manifest_filename=manifest_file.filename,
        )
    except FbaBoxContentsDnkCompareError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    safe_name = sanitize_dnk_compare_download_filename(result.shipment_id)
    return Response(
        content=result.file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            **_response_headers(safe_name, result),
            "X-Fba-Remapped-Count": str(result.remapped_count),
            "X-Fba-Added-Count": str(result.added_count),
            "X-Fba-Added-Qty": str(result.added_qty),
            "X-Fba-Removed-Count": str(result.removed_count),
            "X-Fba-Removed-Qty": str(result.removed_qty),
            "X-Fba-Last-Box": str(result.last_box),
        },
    )
