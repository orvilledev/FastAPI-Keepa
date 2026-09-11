"""Registered shipments — many users upload FBA exports, two kinds of sheet come out.

A shipment stays in the app until its creator (or an admin) deletes it. Every
upload keeps its own rows; duplicate UPCs are collapsed only when the WR SKU
Update sheet is compiled, so removing one upload never disturbs another's rows.
The PO Import and Order Import sheets are built per upload instead of merged,
because one purchase order covers one FBA shipment.
"""
import io
import logging
import zipfile
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from supabase import Client

from app.api.auth import _ensure_profile_row
from app.database import get_supabase
from app.dependencies import get_current_user, is_superadmin_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.models.shipment import (
    ShipmentCompiledRow,
    ShipmentCreate,
    ShipmentDetailResponse,
    ShipmentResponse,
    ShipmentUpdate,
    ShipmentUploadResponse,
    ShipmentUploadResult,
)
from app.repositories.catalog_ship_to_repository import CatalogShipToRepository
from app.repositories.shipment_repository import ShipmentRepository
from app.services.shipment_manager import (
    INPUT_SUFFIXES,
    OUTPUT_FILENAME,
    ShipmentManagerError,
    ShipmentSkuRow,
    build_order_import_text,
    build_order_import_workbook,
    build_po_import_text,
    build_po_import_workbook,
    build_shipment_ledger_workbook,
    build_workbook,
    compile_stored_rows,
    ledger_filename,
    order_import_filename,
    order_import_text_filename,
    parse_fba_export,
    po_import_filename,
    po_import_text_filename,
    resolve_po_supplier,
    ship_to_address_from_catalog,
    ship_to_code,
    stored_rows_to_sku_rows,
)
from app.utils.error_handler import handle_api_errors
from app.utils.user_display_name import resolve_user_display_name

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_BYTES = 15 * 1024 * 1024
_ACCEPTED_SUFFIXES = INPUT_SUFFIXES
_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_ZIP_MEDIA_TYPE = "application/zip"


def _bundle_filename(workbook_filename: str) -> str:
    """The zip the browser receives before it is split back into the two files."""
    stem = workbook_filename[: -len(".xlsx")] if workbook_filename.lower().endswith(
        ".xlsx"
    ) else workbook_filename
    return f"{stem}.zip"


def _zip_import_pair(
    *,
    workbook_name: str,
    workbook_bytes: bytes,
    text_name: str,
    text_bytes: bytes,
) -> bytes:
    """Bundle a sheet and its tab-delimited twin so one click yields both files."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(workbook_name, workbook_bytes)
        archive.writestr(text_name, text_bytes)
    return buffer.getvalue()


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


def _load_upload(repo: ShipmentRepository, shipment_id: UUID, upload_id: UUID) -> dict:
    try:
        upload = repo.get_upload(str(upload_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not upload or str(upload.get("shipment_id")) != str(shipment_id):
        raise HTTPException(status_code=404, detail="Upload not found on this shipment.")
    return upload


def _upload_sku_rows(repo: ShipmentRepository, upload_id: UUID) -> List[ShipmentSkuRow]:
    """One upload's own rows, never merged with the rest of the shipment."""
    try:
        stored = repo.list_rows_for_upload(str(upload_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not stored:
        raise HTTPException(status_code=400, detail="This upload has no SKU rows to write.")
    return stored_rows_to_sku_rows(stored)


def _require_catalog_ship_to(db: Client, ship_to_raw: str) -> tuple[str, dict]:
    """Resolve the export's Ship to line against the Ship To Address Catalog.

    Uploads and Order Import both require a known fulfilment-centre code so we
    never store or export an address we cannot look up.
    """
    code = ship_to_code(ship_to_raw)
    if not code:
        raise HTTPException(
            status_code=400,
            detail="This FBA export has no Ship to code, so it cannot be added. "
            "Confirm the file includes a Ship to line, then try again.",
        )
    try:
        record = CatalogShipToRepository(db).get_by_code(code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not record:
        raise HTTPException(
            status_code=400,
            detail=f"{code} is not in the Ship To Address Catalog. Add it there, then try again.",
        )
    return code, record


def _display_names(db: Client, user_ids: List[str], emails: dict[str, str]) -> dict[str, str]:
    """Live profile names for the given user ids; email local-part is the fallback."""
    names: dict[str, str] = {}
    ids = [str(uid) for uid in user_ids if uid]
    if ids:
        try:
            response = (
                db.table("profiles")
                .select("id, display_name, email")
                .in_("id", ids)
                .execute()
            )
            for row in response.data or []:
                uid = str(row.get("id") or "")
                if not uid:
                    continue
                resolved = resolve_user_display_name(
                    display_name=row.get("display_name"),
                    email=row.get("email") or emails.get(uid),
                )
                if resolved:
                    names[uid] = resolved
        except Exception:
            logger.debug("shipment display-name lookup failed", exc_info=True)
    for uid, email in emails.items():
        if uid not in names:
            names[uid] = resolve_user_display_name(email=email) or email or ""
    return names


def _person_name(names: dict[str, str], user_id: object, email: object) -> str:
    uid = str(user_id or "")
    mail = (email or "").strip() if isinstance(email, str) else ""
    return names.get(uid) or resolve_user_display_name(email=mail) or mail


def _to_response(
    shipment: dict,
    *,
    upload_count: int,
    contributor_count: int,
    row_count: int,
    unique_upc_count: int,
    can_delete: bool,
    created_by_name: str = "",
) -> ShipmentResponse:
    return ShipmentResponse(
        **shipment,
        upload_count=upload_count,
        contributor_count=contributor_count,
        row_count=row_count,
        unique_upc_count=unique_upc_count,
        can_delete=can_delete,
        created_by_name=created_by_name
        or _person_name({}, shipment.get("created_by"), shipment.get("created_by_email")),
    )


def _upload_response(item: dict, names: dict[str, str]) -> ShipmentUploadResponse:
    return ShipmentUploadResponse(
        **item,
        uploaded_by_name=_person_name(names, item.get("uploaded_by"), item.get("uploaded_by_email")),
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

    names = _display_names(
        db,
        [str(row.get("created_by") or "") for row in shipments],
        {
            str(row.get("created_by") or ""): str(row.get("created_by_email") or "")
            for row in shipments
        },
    )

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
                created_by_name=_person_name(
                    names, shipment.get("created_by"), shipment.get("created_by_email")
                ),
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
                "vendor": payload.vendor,
                "notes": payload.notes,
                "status": payload.status,
                "created_by": current_user["id"],
                "created_by_email": current_user.get("email") or "",
            }
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info("Shipment %s registered by %s", shipment.get("id"), current_user.get("email"))
    names = _display_names(
        db,
        [current_user["id"]],
        {current_user["id"]: current_user.get("email") or ""},
    )
    return _to_response(
        shipment,
        upload_count=0,
        contributor_count=0,
        row_count=0,
        unique_upc_count=0,
        can_delete=True,
        created_by_name=_person_name(names, current_user["id"], current_user.get("email")),
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
        stored = repo.list_rows_merged(str(shipment_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    compiled, collected = compile_stored_rows(stored)
    admin = _is_admin(db, current_user)
    names = _display_names(
        db,
        [str(shipment.get("created_by") or "")]
        + [str(item.get("uploaded_by") or "") for item in uploads],
        {
            **{
                str(shipment.get("created_by") or ""): str(shipment.get("created_by_email") or "")
            },
            **{
                str(item.get("uploaded_by") or ""): str(item.get("uploaded_by_email") or "")
                for item in uploads
            },
        },
    )
    return ShipmentDetailResponse(
        **shipment,
        upload_count=len(uploads),
        contributor_count=len({str(item.get("uploaded_by")) for item in uploads}),
        row_count=collected,
        unique_upc_count=len(compiled),
        can_delete=admin or str(shipment.get("created_by")) == current_user["id"],
        created_by_name=_person_name(
            names, shipment.get("created_by"), shipment.get("created_by_email")
        ),
        uploads=[_upload_response(item, names) for item in uploads],
        compiled_rows=[
            ShipmentCompiledRow(
                sku=item.sku,
                description=item.description,
                upc=item.upc,
                fnsku=item.fnsku,
            )
            for item in compiled
        ],
    )


@router.patch("/shipments/{shipment_id}", response_model=ShipmentResponse)
@handle_api_errors("update shipment")
def update_shipment(
    shipment_id: UUID,
    payload: ShipmentUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Rename a shipment, change status, or edit notes (creator or admin)."""
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
    names = _display_names(
        db,
        [str(updated.get("created_by") or "")],
        {str(updated.get("created_by") or ""): str(updated.get("created_by_email") or "")},
    )
    return _to_response(
        updated,
        upload_count=len(uploads),
        contributor_count=len({str(item.get("uploaded_by")) for item in uploads}),
        row_count=row_count,
        unique_upc_count=unique_upc_count,
        can_delete=True,
        created_by_name=_person_name(
            names, updated.get("created_by"), updated.get("created_by_email")
        ),
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
    """Add one FBA export's SKU rows to a registered shipment.

    The export's Ship to code must already exist in the Ship To Address Catalog;
    otherwise the upload is rejected and nothing is stored.
    """
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

    # Reject before anything is stored — Order Import needs this address later.
    _require_catalog_ship_to(db, parsed.ship_to)

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
        upload=_upload_response(
            upload,
            _display_names(
                db,
                [current_user["id"]],
                {current_user["id"]: current_user.get("email") or ""},
            ),
        ),
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
    upload = _load_upload(repo, shipment_id, upload_id)

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
        stored = repo.list_rows_merged(str(shipment_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not stored:
        raise HTTPException(
            status_code=400, detail="No files have been uploaded to this shipment yet."
        )

    rows, collected = compile_stored_rows(stored)
    try:
        workbook_bytes = build_workbook(rows)
    except ShipmentManagerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.info(
        "Shipment %s compiled by %s: %s unique UPCs from %s collected rows across uploads",
        shipment_id,
        current_user.get("email"),
        len(rows),
        collected,
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{OUTPUT_FILENAME}"',
        "X-Shipment-Filename": OUTPUT_FILENAME,
        "X-Shipment-Name": _header_safe(str(shipment.get("name") or "")),
        "X-Shipment-Sku-Count": str(len(rows)),
        "X-Shipment-Collected-Rows": str(collected),
        "X-Shipment-Duplicates-Removed": str(collected - len(rows)),
    }
    return Response(content=workbook_bytes, media_type=_XLSX_MEDIA_TYPE, headers=headers)


@router.post("/shipments/{shipment_id}/ledger", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("build shipment ledger")
async def download_shipment_ledger(
    request: Request,
    shipment_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Download an Excel ledger of this shipment's details, uploads and unique SKUs."""
    repo = ShipmentRepository(db)
    shipment = _load_shipment(repo, shipment_id)
    try:
        uploads = repo.list_uploads(str(shipment_id))
        stored = repo.list_rows_merged(str(shipment_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    rows, collected = compile_stored_rows(stored)
    names = _display_names(
        db,
        [str(shipment.get("created_by") or "")]
        + [str(item.get("uploaded_by") or "") for item in uploads],
        {
            **{
                str(shipment.get("created_by") or ""): str(shipment.get("created_by_email") or "")
            },
            **{
                str(item.get("uploaded_by") or ""): str(item.get("uploaded_by_email") or "")
                for item in uploads
            },
        },
    )
    upload_payload = [
        {
            **item,
            "uploaded_by_name": _person_name(
                names, item.get("uploaded_by"), item.get("uploaded_by_email")
            ),
        }
        for item in uploads
    ]
    registered_by = _person_name(
        names, shipment.get("created_by"), shipment.get("created_by_email")
    )

    try:
        workbook_bytes = build_shipment_ledger_workbook(
            shipment=shipment,
            uploads=upload_payload,
            sku_rows=rows,
            registered_by=registered_by,
        )
    except ShipmentManagerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    filename = _header_safe(ledger_filename(str(shipment.get("name") or ""))) or "LEDGER.xlsx"
    logger.info(
        "Shipment %s ledger downloaded by %s: %s unique UPC(s) from %s collected row(s)",
        shipment_id,
        current_user.get("email"),
        len(rows),
        collected,
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-Shipment-Filename": filename,
        "X-Shipment-Name": _header_safe(str(shipment.get("name") or "")),
        "X-Shipment-Sku-Count": str(len(rows)),
        "X-Shipment-Collected-Rows": str(collected),
        "X-Shipment-Upload-Count": str(len(uploads)),
    }
    return Response(content=workbook_bytes, media_type=_XLSX_MEDIA_TYPE, headers=headers)


@router.post("/shipments/{shipment_id}/uploads/{upload_id}/po-import", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("build shipment po import sheet")
async def generate_upload_po_import(
    request: Request,
    shipment_id: UUID,
    upload_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Build one upload's own PO Import sheet and its tab-delimited twin.

    Never merged with the other uploads. The response is a zip holding the
    .xlsx and the .txt so a single click delivers both files.
    """
    repo = ShipmentRepository(db)
    _load_shipment(repo, shipment_id)
    upload = _load_upload(repo, shipment_id, upload_id)

    rows = _upload_sku_rows(repo, upload_id)
    purchase_order_number = str(upload.get("amazon_shipment_id") or "")
    supplier = resolve_po_supplier(
        rows,
        filename=str(upload.get("filename") or ""),
        shipment_name=str(upload.get("amazon_shipment_name") or ""),
    )
    try:
        workbook_bytes = build_po_import_workbook(
            rows,
            purchase_order_number=purchase_order_number,
            supplier=supplier,
        )
        text_bytes = build_po_import_text(
            rows,
            purchase_order_number=purchase_order_number,
            supplier=supplier,
        )
    except ShipmentManagerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    filename = _header_safe(po_import_filename(purchase_order_number, supplier)) or "PO IMPORT.xlsx"
    total_units = sum(item.total_units for item in rows)
    box_count = int(upload.get("box_count") or 0)
    txt_name = _header_safe(
        po_import_text_filename(
            purchase_order_number, box_count=box_count, total_units=total_units
        )
    ) or "WR PO Import.txt"
    bundle = _zip_import_pair(
        workbook_name=filename,
        workbook_bytes=workbook_bytes,
        text_name=txt_name,
        text_bytes=text_bytes,
    )
    logger.info(
        "Shipment %s upload %s PO import built by %s: %s line(s)",
        shipment_id,
        upload_id,
        current_user.get("email"),
        len(rows),
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{_bundle_filename(filename)}"',
        "X-Shipment-Filename": filename,
        "X-Shipment-Text-Filename": txt_name,
        "X-Shipment-Po-Number": _header_safe(purchase_order_number),
        "X-Shipment-Supplier": _header_safe(supplier),
        "X-Shipment-Sku-Count": str(len(rows)),
    }
    return Response(content=bundle, media_type=_ZIP_MEDIA_TYPE, headers=headers)


@router.post("/shipments/{shipment_id}/uploads/{upload_id}/order-import", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("build shipment order import sheet")
async def generate_upload_order_import(
    request: Request,
    shipment_id: UUID,
    upload_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase),
):
    """Build one upload's own Order Import sheet and its tab-delimited twin.

    The ship-to block is the Ship To Address Catalog entry for the fulfilment
    centre code on the export's "Ship to" line. The response is a zip holding
    the .xlsx and the .txt so a single click delivers both files.
    """
    repo = ShipmentRepository(db)
    _load_shipment(repo, shipment_id)
    upload = _load_upload(repo, shipment_id, upload_id)
    rows = _upload_sku_rows(repo, upload_id)

    code, record = _require_catalog_ship_to(db, str(upload.get("ship_to") or ""))

    reference_number = str(upload.get("amazon_shipment_id") or "")
    address = ship_to_address_from_catalog(code, record)
    try:
        workbook_bytes = build_order_import_workbook(
            rows,
            reference_number=reference_number,
            address=address,
        )
        text_bytes = build_order_import_text(
            rows,
            reference_number=reference_number,
            address=address,
        )
    except ShipmentManagerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    filename = (
        _header_safe(order_import_filename(reference_number, code)) or "ORDER IMPORT.xlsx"
    )
    total_units = sum(item.total_units for item in rows)
    box_count = int(upload.get("box_count") or 0)
    txt_name = _header_safe(
        order_import_text_filename(
            reference_number, box_count=box_count, total_units=total_units
        )
    ) or "WR Order Import.txt"
    bundle = _zip_import_pair(
        workbook_name=filename,
        workbook_bytes=workbook_bytes,
        text_name=txt_name,
        text_bytes=text_bytes,
    )
    logger.info(
        "Shipment %s upload %s order import built by %s: %s line(s) to %s",
        shipment_id,
        upload_id,
        current_user.get("email"),
        len(rows),
        code,
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{_bundle_filename(filename)}"',
        "X-Shipment-Filename": filename,
        "X-Shipment-Text-Filename": txt_name,
        "X-Shipment-Reference-Number": _header_safe(reference_number),
        "X-Shipment-Ship-To-Code": _header_safe(code),
        "X-Shipment-Sku-Count": str(len(rows)),
    }
    return Response(content=bundle, media_type=_ZIP_MEDIA_TYPE, headers=headers)
