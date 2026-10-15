"""FBA Shipment Library — store yellow fields from the official shipment TSV."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_old_skus_user, is_superadmin_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.models.fba_shipment_library import (
    FbaShipmentDetailResponse,
    FbaShipmentImportResult,
    FbaShipmentLineResponse,
    FbaShipmentScanRequest,
    FbaShipmentScanResult,
    FbaShipmentUploadListResponse,
    FbaShipmentUploadResponse,
)
from app.repositories.fba_shipment_library_repository import FbaShipmentLibraryRepository
from app.services.fba_shipment_library import (
    FbaShipmentParseError,
    choose_line_for_scan,
    parse_fba_shipment_tsv,
    strip_upc_label,
)
from app.utils.error_handler import handle_api_errors
from app.utils.user_display_name import profile_display_name

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_BYTES = 15 * 1024 * 1024
_ALLOWED_SUFFIXES = (".tsv", ".txt", ".csv")


def _validate_name(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not name.endswith(_ALLOWED_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail="Upload the official FBA shipment file as .tsv.",
        )


async def _read_upload(file: UploadFile) -> bytes:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 15 MB limit.")
    return raw


def _creator_snapshot(db: Client, current_user: dict) -> tuple[str, str, str]:
    profile: dict = {}
    try:
        response = (
            db.table("profiles")
            .select("display_name, full_name, email")
            .eq("id", current_user["id"])
            .limit(1)
            .execute()
        )
        if response.data:
            profile = response.data[0]
    except Exception:
        logger.debug("FBA shipment library profile lookup failed", exc_info=True)
    email = (current_user.get("email") or profile.get("email") or "").strip().lower()
    name = profile_display_name(profile, current_user) or ""
    return str(current_user["id"]), email, name


def _upload_response(row: dict, current_user: dict, *, can_manage_any: bool) -> FbaShipmentUploadResponse:
    created_by = str(row.get("created_by") or "")
    owned = created_by == str(current_user.get("id") or "") or can_manage_any
    return FbaShipmentUploadResponse(
        id=row["id"],
        shipment_id=row.get("shipment_id") or "",
        source_filename=row.get("source_filename") or "",
        line_count=int(row.get("line_count") or 0),
        total_shipped=int(row.get("total_shipped") or 0),
        created_by=row.get("created_by"),
        created_by_email=row.get("created_by_email") or "",
        created_by_name=row.get("created_by_name") or "",
        created_at=row["created_at"],
        owned_by_me=owned,
    )


@router.get("/fba-shipment-library", response_model=FbaShipmentUploadListResponse)
@handle_api_errors("list FBA shipment library")
def list_fba_shipments(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    mine: bool = Query(False),
    current_user: dict = Depends(get_old_skus_user),
    db: Client = Depends(get_supabase),
):
    repo = FbaShipmentLibraryRepository(db)
    can_manage_any = is_superadmin_user(current_user, db)
    try:
        items, total = repo.list_uploads(
            limit=limit,
            offset=offset,
            search=search,
            created_by=str(current_user["id"]) if mine else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FbaShipmentUploadListResponse(
        items=[_upload_response(row, current_user, can_manage_any=can_manage_any) for row in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/fba-shipment-library/{upload_id}", response_model=FbaShipmentDetailResponse)
@handle_api_errors("open FBA shipment")
def get_fba_shipment(
    upload_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_old_skus_user),
    db: Client = Depends(get_supabase),
):
    repo = FbaShipmentLibraryRepository(db)
    can_manage_any = is_superadmin_user(current_user, db)
    try:
        upload = repo.get_upload(upload_id)
        if not upload:
            raise HTTPException(status_code=404, detail="That shipment upload was not found.")
        lines, total = repo.list_lines(upload_id, limit=limit, offset=offset, search=search)
        counts = repo.counts_for_lines(
            [str(row.get("id") or "") for row in lines],
            str(current_user["id"]),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    for row in lines:
        row["counted"] = counts.get(str(row.get("id") or ""), 0)
    return FbaShipmentDetailResponse(
        upload=_upload_response(upload, current_user, can_manage_any=can_manage_any),
        lines=[FbaShipmentLineResponse(**row) for row in lines],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/fba-shipment-library/{upload_id}/scan", response_model=FbaShipmentScanResult)
@handle_api_errors("scan FBA shipment barcode")
def scan_fba_shipment(
    upload_id: str,
    body: FbaShipmentScanRequest,
    current_user: dict = Depends(get_old_skus_user),
    db: Client = Depends(get_supabase),
):
    """Count one unit for the scanned external-id. Counts belong to the signed-in user."""
    barcode = strip_upc_label(body.barcode or "")
    if not barcode:
        raise HTTPException(status_code=400, detail="Scan an external-id barcode.")
    repo = FbaShipmentLibraryRepository(db)
    try:
        upload = repo.get_upload(upload_id)
        if not upload:
            raise HTTPException(status_code=404, detail="That shipment upload was not found.")
        matches = repo.lines_for_barcode(upload_id, barcode)
        if not matches:
            raise HTTPException(
                status_code=404,
                detail=f"{barcode} is not an external-id on this shipment.",
            )
        counts = repo.counts_for_lines(
            [str(row.get("id") or "") for row in matches],
            str(current_user["id"]),
        )
        for row in matches:
            row["counted"] = counts.get(str(row.get("id") or ""), 0)
        target = choose_line_for_scan(matches)
        counted = repo.increment_count(
            upload_id,
            str(target["id"]),
            str(current_user["id"]),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    target["counted"] = counted
    return FbaShipmentScanResult(
        barcode=barcode,
        line=FbaShipmentLineResponse(**target),
    )


@router.post("/fba-shipment-library/import", response_model=FbaShipmentImportResult)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("import FBA shipment")
async def import_fba_shipment(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_old_skus_user),
    db: Client = Depends(get_supabase),
):
    """Store Shipment ID, Merchant SKU, external-id, and Shipped. Does not replace earlier uploads."""
    _validate_name(file)
    raw = await _read_upload(file)
    try:
        parsed = parse_fba_shipment_tsv(raw)
    except FbaShipmentParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    created_by, email, name = _creator_snapshot(db, current_user)
    repo = FbaShipmentLibraryRepository(db)
    try:
        saved = repo.create_upload(
            shipment_id=parsed.shipment_id,
            source_filename=(file.filename or "").strip(),
            line_count=len(parsed.lines),
            total_shipped=parsed.total_shipped,
            created_by=created_by,
            created_by_email=email,
            created_by_name=name,
            lines=[
                {
                    "line_number": line.line_number,
                    "merchant_sku": line.merchant_sku,
                    "external_id": line.external_id,
                    "shipped": line.shipped,
                }
                for line in parsed.lines
            ],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "FBA shipment library import by %s: %s (%s lines)",
        email,
        parsed.shipment_id,
        len(parsed.lines),
    )
    return FbaShipmentImportResult(
        upload=_upload_response(
            saved,
            current_user,
            can_manage_any=is_superadmin_user(current_user, db),
        )
    )


@router.delete("/fba-shipment-library/{upload_id}")
@handle_api_errors("delete FBA shipment")
def delete_fba_shipment(
    upload_id: str,
    current_user: dict = Depends(get_old_skus_user),
    db: Client = Depends(get_supabase),
):
    repo = FbaShipmentLibraryRepository(db)
    try:
        upload = repo.get_upload(upload_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not upload:
        raise HTTPException(status_code=404, detail="That shipment upload was not found.")
    owner = str(upload.get("created_by") or "")
    if owner != str(current_user.get("id") or "") and not is_superadmin_user(current_user, db):
        raise HTTPException(
            status_code=403,
            detail="You can remove only shipments you uploaded.",
        )
    try:
        repo.delete_upload(upload_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deleted": True}
