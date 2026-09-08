"""Registered shipments — many users upload FBA exports, one compiled WR SKU sheet.

A shipment stays in the app until its creator (or an admin) deletes it. Every
upload keeps its own rows; duplicate UPCs are collapsed only when the sheet is
compiled, so removing one upload never disturbs another's rows.
"""
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from supabase import Client

from app.api.auth import _ensure_profile_row
from app.database import get_supabase
from app.dependencies import get_current_user, is_superadmin_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.models.shipment import (
    ShipmentCreate,
    ShipmentDetailResponse,
    ShipmentResponse,
    ShipmentUpdate,
    ShipmentUploadResponse,
    ShipmentUploadResult,
)
from app.repositories.shipment_repository import ShipmentRepository
from app.services.shipment_manager import (
    OUTPUT_FILENAME,
    ShipmentManagerError,
    ShipmentSkuRow,
    build_workbook,
    dedupe_by_upc,
    parse_fba_export,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_BYTES = 15 * 1024 * 1024
_ACCEPTED_SUFFIXES = (".csv", ".txt", ".tsv", ".xlsx", ".xlsm")
_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _header_safe(value: str) -> str:
    """HTTP headers are latin-1; drop anything a shipment name might smuggle in."""
    return "".join(char for char in value if 32 <= ord(char) < 127).strip()


def _is_admin(db: Client, current_user: dict) -> bool:
    if is_superadmin_user(current_user, db):
        return True
    response = (
        db.table("profiles").select("role").eq("id", current_user["id"]).limit(1).execute()
    )
    rows = response.data or []
    return bool(rows) and (rows[0].get("role") or "").lower() in ("admin", "superadmin")


def _load_shipment(repo: ShipmentRepository, shipment_id: UUID) -> dict:
    try:
        shipment = repo.get_shipment(str(shipment_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found.")
    return shipment


def _to_response(
    shipment: dict,
    *,
    upload_count: int,
    contributor_count: int,
    row_count: int,
    unique_upc_count: int,
    can_delete: bool,
) -> ShipmentResponse:
    return ShipmentResponse(
        **shipment,
        upload_count=upload_count,
        contributor_count=contributor_count,
        row_count=row_count,
        unique_upc_count=unique_upc_count,
        can_delete=can_delete,
    )


@router.get("/shipments", response_model=List[ShipmentResponse])
@handle_api_errors("list shipments")
def list_shipments(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Every registered shipment, newest first. Shipments are shared by the team."""
    repo = ShipmentRepository(db)
    try:
        shipments = repo.list_shipments()
        ids = [str(row["id"]) for row in shipments]
        uploads = repo.list_uploads_for_shipments(ids)
        upcs = repo.upcs_for_shipments(ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    admin = _is_admin(db, current_user)
    by_shipment: dict[str, list[dict]] = {}
    for upload in uploads:
        by_shipment.setdefault(str(upload.get("shipment_id")), []).append(upload)

    results: List[ShipmentResponse] = []
    for shipment in shipments:
        key = str(shipment["id"])
        group = by_shipment.get(key, [])
        results.append(
            _to_response(
                shipment,
                upload_count=len(group),
                contributor_count=len({str(item.get("uploaded_by")) for item in group}),
                row_count=sum(int(item.get("row_count") or 0) for item in group),
                unique_upc_count=len(upcs.get(key, set())),
                can_delete=admin or str(shipment.get("created_by")) == current_user["id"],
            )
        )
    return results


@router.post("/shipments", response_model=ShipmentResponse, status_code=201)
@handle_api_errors("register shipment")
def create_shipment(
    payload: ShipmentCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Register a shipment that the team can upload FBA exports into."""
    _ensure_profile_row(db, current_user)
    repo = ShipmentRepository(db)
    try:
        shipment = repo.create_shipment(
            {
                "name": payload.name,
                "notes": payload.notes,
                "created_by": current_user["id"],
                "created_by_email": current_user.get("email") or "",
            }
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info("Shipment %s registered by %s", shipment.get("id"), current_user.get("email"))
    return _to_response(
        shipment,
        upload_count=0,
        contributor_count=0,
        row_count=0,
        unique_upc_count=0,
        can_delete=True,
    )


@router.get("/shipments/{shipment_id}", response_model=ShipmentDetailResponse)
@handle_api_errors("load shipment")
def get_shipment(
    shipment_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """One shipment with its upload history."""
    repo = ShipmentRepository(db)
    shipment = _load_shipment(repo, shipment_id)
    try:
        uploads = repo.list_uploads(str(shipment_id))
        row_count, unique_upc_count = repo.row_stats(str(shipment_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    admin = _is_admin(db, current_user)
    return ShipmentDetailResponse(
        **shipment,
        upload_count=len(uploads),
        contributor_count=len({str(item.get("uploaded_by")) for item in uploads}),
        row_count=row_count,
        unique_upc_count=unique_upc_count,
        can_delete=admin or str(shipment.get("created_by")) == current_user["id"],
        uploads=[ShipmentUploadResponse(**item) for item in uploads],
    )


@router.patch("/shipments/{shipment_id}", response_model=ShipmentResponse)
@handle_api_errors("update shipment")
def update_shipment(
    shipment_id: UUID,
    payload: ShipmentUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Rename a shipment or edit its notes (creator or admin)."""
    repo = ShipmentRepository(db)
    shipment = _load_shipment(repo, shipment_id)
    admin = _is_admin(db, current_user)
    if not admin and str(shipment.get("created_by")) != current_user["id"]:
        raise HTTPException(
            status_code=403, detail="Only the person who registered this shipment can edit it."
        )

    patch = payload.model_dump(exclude_unset=True)
    if "notes" in patch and patch["notes"] == "":
        patch["notes"] = None
    if not patch:
        updated = shipment
    else:
        try:
            updated = repo.update_shipment(str(shipment_id), patch) or shipment
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        uploads = repo.list_uploads(str(shipment_id))
        row_count, unique_upc_count = repo.row_stats(str(shipment_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(
        updated,
        upload_count=len(uploads),
        contributor_count=len({str(item.get("uploaded_by")) for item in uploads}),
        row_count=row_count,
        unique_upc_count=unique_upc_count,
        can_delete=True,
    )


@router.delete("/shipments/{shipment_id}", status_code=status.HTTP_204_NO_CONTENT)
@handle_api_errors("delete shipment")
def delete_shipment(
    shipment_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Delete a shipment and everything collected in it (creator or admin)."""
    repo = ShipmentRepository(db)
    shipment = _load_shipment(repo, shipment_id)
    if not _is_admin(db, current_user) and str(shipment.get("created_by")) != current_user["id"]:
        raise HTTPException(
            status_code=403,
            detail="Only the person who registered this shipment, or an admin, can delete it.",
        )
    try:
        repo.delete_shipment(str(shipment_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    logger.info("Shipment %s deleted by %s", shipment_id, current_user.get("email"))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/shipments/{shipment_id}/uploads", response_model=ShipmentUploadResult)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("add shipment upload")
async def add_shipment_upload(
    request: Request,
    shipment_id: UUID,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Add one FBA export's SKU rows to a registered shipment."""
    name = (file.filename or "").lower()
    if not name.endswith(_ACCEPTED_SUFFIXES):
        raise HTTPException(
            status_code=400, detail="Upload the FBA shipment export as a .csv or .xlsx file."
        )

    repo = ShipmentRepository(db)
    _load_shipment(repo, shipment_id)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 15 MB).")

    try:
        parsed = parse_fba_export(file.filename or "shipment.csv", raw)
    except ShipmentManagerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    _ensure_profile_row(db, current_user)
    try:
        existing_upcs = repo.existing_upcs(str(shipment_id))
        upload = repo.create_upload(
            {
                "shipment_id": str(shipment_id),
                "filename": file.filename or "",
                "amazon_shipment_id": parsed.shipment_id,
                "amazon_shipment_name": parsed.shipment_name,
                "ship_to": parsed.ship_to,
                "box_count": parsed.box_count,
                "row_count": len(parsed.rows),
                "total_units": parsed.total_units,
                "uploaded_by": current_user["id"],
                "uploaded_by_email": current_user.get("email") or "",
            }
        )
        repo.insert_rows(
            [
                {
                    "shipment_id": str(shipment_id),
                    "upload_id": str(upload["id"]),
                    "sku": item.sku,
                    "description": item.description,
                    "upc": item.upc,
                    "fnsku": item.fnsku,
                    "total_units": item.total_units,
                    "row_index": index,
                }
                for index, item in enumerate(parsed.rows)
            ]
        )
        _, unique_upc_count = repo.row_stats(str(shipment_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    overlap = len([item for item in parsed.rows if item.upc in existing_upcs])
    logger.info(
        "Shipment %s upload by %s: %s rows (%s already in shipment)",
        shipment_id,
        current_user.get("email"),
        len(parsed.rows),
        overlap,
    )
    return ShipmentUploadResult(
        upload=ShipmentUploadResponse(**upload),
        rows_added=len(parsed.rows),
        duplicates_in_file=parsed.duplicate_skus,
        duplicates_against_shipment=overlap,
        unique_upc_count=unique_upc_count,
    )


@router.delete(
    "/shipments/{shipment_id}/uploads/{upload_id}", status_code=status.HTTP_204_NO_CONTENT
)
@handle_api_errors("remove shipment upload")
def delete_shipment_upload(
    shipment_id: UUID,
    upload_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Remove one upload and only the rows it contributed."""
    repo = ShipmentRepository(db)
    shipment = _load_shipment(repo, shipment_id)
    try:
        upload = repo.get_upload(str(upload_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not upload or str(upload.get("shipment_id")) != str(shipment_id):
        raise HTTPException(status_code=404, detail="Upload not found on this shipment.")

    allowed = (
        str(upload.get("uploaded_by")) == current_user["id"]
        or str(shipment.get("created_by")) == current_user["id"]
        or _is_admin(db, current_user)
    )
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail="Only the uploader, the shipment owner, or an admin can remove this upload.",
        )

    try:
        repo.delete_upload(str(upload_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    logger.info("Shipment %s upload %s removed by %s", shipment_id, upload_id, current_user.get("email"))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/shipments/{shipment_id}/generate", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("compile shipment sku sheet")
async def generate_shipment_sheet(
    request: Request,
    shipment_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Compile every upload into one WR SKU Update sheet, one row per UPC."""
    repo = ShipmentRepository(db)
    shipment = _load_shipment(repo, shipment_id)
    try:
        stored = repo.list_rows(str(shipment_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not stored:
        raise HTTPException(
            status_code=400, detail="No files have been uploaded to this shipment yet."
        )

    rows = dedupe_by_upc(
        [
            ShipmentSkuRow(
                sku=row.get("sku") or "",
                description=row.get("description") or "",
                upc=row.get("upc") or "",
                fnsku=row.get("fnsku") or "",
                total_units=int(row.get("total_units") or 0),
            )
            for row in stored
        ]
    )
    try:
        workbook_bytes = build_workbook(rows)
    except ShipmentManagerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Shipment %s compiled by %s: %s rows from %s collected",
        shipment_id,
        current_user.get("email"),
        len(rows),
        len(stored),
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{OUTPUT_FILENAME}"',
        "X-Shipment-Filename": OUTPUT_FILENAME,
        "X-Shipment-Name": _header_safe(str(shipment.get("name") or "")),
        "X-Shipment-Sku-Count": str(len(rows)),
        "X-Shipment-Collected-Rows": str(len(stored)),
        "X-Shipment-Duplicates-Removed": str(len(stored) - len(rows)),
    }
    return Response(content=workbook_bytes, media_type=_XLSX_MEDIA_TYPE, headers=headers)
