"""FBA Order Checker — store yellow fields from the official shipment TSV."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from supabase import Client

from app.database import get_supabase
from app.dependencies import get_fba_order_checker_user, is_superadmin_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.models.fba_shipment_library import (
    FbaBoxNumberRequest,
    FbaBoxUnitUpdate,
    FbaShipmentAccessRequest,
    FbaShipmentDetailResponse,
    FbaShipmentUnitsResponse,
    FbaShipmentImportResult,
    FbaShipmentLineResponse,
    FbaShipmentScanRequest,
    FbaShipmentScanResult,
    FbaShipmentUploadListResponse,
    FbaShipmentUploadResponse,
)
from app.repositories.fba_shipment_library_repository import FbaShipmentLibraryRepository
from app.services.fba_shipment_library import (
    MAX_BOX_NUMBER,
    FbaShipmentParseError,
    build_accounting_workbook,
    choose_line_for_scan,
    is_fully_accounted,
    parse_fba_shipment_tsv,
    strip_upc_label,
    units_for_count,
)
from app.utils.error_handler import handle_api_errors
from app.utils.user_display_name import given_name, profile_display_name

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
            .select("display_name, email")
            .eq("id", current_user["id"])
            .limit(1)
            .execute()
        )
        if response.data:
            profile = response.data[0]
    except Exception:
        logger.debug("FBA shipment library profile lookup failed", exc_info=True)
    email = (current_user.get("email") or profile.get("email") or "").strip().lower()
    name = given_name(profile_display_name(profile, current_user)) or ""
    return str(current_user["id"]), email, name


def _given_names_by_user(db: Client, user_ids: list[str]) -> dict[str, str]:
    """Live first names from profiles, so older uploads do not keep the email handle."""
    ids = list(dict.fromkeys(user_id for user_id in user_ids if user_id))
    if not ids:
        return {}
    try:
        response = (
            db.table("profiles")
            .select("id, display_name, email")
            .in_("id", ids)
            .execute()
        )
    except Exception:
        logger.debug("FBA shipment uploader name lookup failed", exc_info=True)
        return {}
    names: dict[str, str] = {}
    for row in response.data or []:
        name = given_name(profile_display_name(row, {}))
        if name:
            names[str(row.get("id") or "")] = name
    return names


def _search_term(search: Optional[str]) -> str:
    return " ".join((search or "").strip().replace(",", " ").split()).casefold()


def _matches_sku_search(row: dict, search: Optional[str]) -> bool:
    """True when this line or unknown scan is the merchant SKU / external-id being searched."""
    term = _search_term(search)
    if not term:
        return True
    merchant = str(row.get("merchant_sku") or "").casefold()
    external = str(row.get("external_id") or "")
    bare = strip_upc_label(external).casefold()
    return term in merchant or term in bare or term in external.casefold()


def _unknown_line(row: dict) -> FbaShipmentLineResponse:
    return FbaShipmentLineResponse(
        id=row["id"],
        line_number=0,
        merchant_sku="",
        external_id=row.get("external_id") or "",
        shipped=0,
        counted=int(row.get("counted") or 0),
        box_counted=row.get("box_counted"),
        not_in_list=True,
    )


def _upload_response(
    row: dict,
    current_user: dict,
    *,
    can_manage_any: bool,
    uploader_names: Optional[dict[str, str]] = None,
) -> FbaShipmentUploadResponse:
    created_by = str(row.get("created_by") or "")
    owned = created_by == str(current_user.get("id") or "") or can_manage_any
    stored = given_name(row.get("created_by_name")) or given_name(row.get("created_by_email")) or ""
    name = (uploader_names or {}).get(created_by) or stored
    return FbaShipmentUploadResponse(
        id=row["id"],
        shipment_id=row.get("shipment_id") or "",
        source_filename=row.get("source_filename") or "",
        line_count=int(row.get("line_count") or 0),
        total_shipped=int(row.get("total_shipped") or 0),
        created_by=row.get("created_by"),
        created_by_email=row.get("created_by_email") or "",
        created_by_name=name,
        created_at=row["created_at"],
        owned_by_me=owned,
        is_locked=bool(row.get("is_locked")),
        archived_at=row.get("archived_at"),
        trashed_at=row.get("trashed_at"),
        fully_accounted=bool(row.get("fully_accounted")),
    )


def _owns_upload(upload: dict, current_user: dict, can_manage_any: bool) -> bool:
    return str(upload.get("created_by") or "") == str(current_user.get("id") or "") or can_manage_any


def _require_visible(upload: dict, current_user: dict, can_manage_any: bool) -> None:
    if upload.get("trashed_at") and not _owns_upload(upload, current_user, can_manage_any):
        raise HTTPException(status_code=404, detail="That shipment upload was not found.")
    if upload.get("is_locked") and not _owns_upload(upload, current_user, can_manage_any):
        raise HTTPException(
            status_code=403,
            detail="This shipment is locked. Only the owner can open it.",
        )


def _is_accounted(repo: FbaShipmentLibraryRepository, upload_id: str) -> bool:
    """True when everyone's scans together account for every line."""
    rows = repo.list_line_quantities(upload_id)
    counts = repo.counts_for_lines([str(row.get("id") or "") for row in rows])
    pairs = [
        (int(row.get("shipped") or 0), counts.get(str(row.get("id") or ""), 0))
        for row in rows
    ]
    return is_fully_accounted(pairs)


@router.get("/fba-shipment-library", response_model=FbaShipmentUploadListResponse)
@handle_api_errors("list FBA shipment library")
def list_fba_shipments(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None),
    mine: bool = Query(False),
    archived: bool = Query(False),
    trashed: bool = Query(False),
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    repo = FbaShipmentLibraryRepository(db)
    can_manage_any = is_superadmin_user(current_user, db)
    try:
        items, total = repo.list_uploads(
            limit=limit,
            offset=offset,
            search=search,
            created_by=str(current_user["id"]) if mine or (trashed and not can_manage_any) else None,
            archived=archived,
            trashed=trashed,
            viewer_id=str(current_user["id"]),
            see_locked=can_manage_any,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    uploader_names = _given_names_by_user(db, [str(row.get("created_by") or "") for row in items])
    return FbaShipmentUploadListResponse(
        items=[
            _upload_response(
                row,
                current_user,
                can_manage_any=can_manage_any,
                uploader_names=uploader_names,
            )
            for row in items
        ],
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
    box: Optional[int] = Query(None, ge=1, le=MAX_BOX_NUMBER),
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    repo = FbaShipmentLibraryRepository(db)
    can_manage_any = is_superadmin_user(current_user, db)
    try:
        upload = repo.get_upload(upload_id)
        if not upload:
            raise HTTPException(status_code=404, detail="That shipment upload was not found.")
        _require_visible(upload, current_user, can_manage_any)
        line_ids = None
        unknown_codes: Optional[set] = None
        box_units: Optional[int] = None
        if box is not None:
            line_ids, unknown_codes = repo.box_scan_keys(upload_id, box)
        lines, total = repo.list_lines(
            upload_id,
            limit=limit,
            offset=offset,
            search=search,
            line_ids=line_ids,
        )
        counts = repo.counts_for_lines(
            list(line_ids) if box is not None and line_ids is not None else [str(row.get("id") or "") for row in lines]
        )
        unknown_rows = repo.list_unknown_scans(upload_id)
        if unknown_codes is not None:
            unknown_rows = [
                row
                for row in unknown_rows
                if strip_upc_label(str(row.get("external_id") or "")) in unknown_codes
            ]
        if _search_term(search):
            unknown_rows = [row for row in unknown_rows if _matches_sku_search(row, search)]
        for row in lines:
            row["counted"] = counts.get(str(row.get("id") or ""), 0)
        if box is not None:
            in_box_lines, in_box_unknown = repo.counted_in_box(
                upload_id,
                box,
                {line_id: int(counts.get(line_id) or 0) for line_id in (line_ids or [])},
                {
                    strip_upc_label(str(row.get("external_id") or "")): int(row.get("counted") or 0)
                    for row in unknown_rows
                },
            )
            kept_lines = []
            for row in lines:
                counted = in_box_lines.get(str(row.get("id") or ""), 0)
                if counted <= 0:
                    continue
                row["box_counted"] = counted
                kept_lines.append(row)
            total -= len(lines) - len(kept_lines)
            lines = kept_lines
            kept_unknown = []
            for row in unknown_rows:
                code = strip_upc_label(str(row.get("external_id") or ""))
                counted = in_box_unknown.get(code, 0)
                if counted <= 0:
                    continue
                row["box_counted"] = counted
                kept_unknown.append(row)
            unknown_rows = kept_unknown
            box_units = sum(in_box_lines.values()) + sum(in_box_unknown.values())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    upload["fully_accounted"] = _is_accounted(repo, upload_id)
    return FbaShipmentDetailResponse(
        upload=_upload_response(
            upload,
            current_user,
            can_manage_any=can_manage_any,
            uploader_names=_given_names_by_user(db, [str(upload.get("created_by") or "")]),
        ),
        lines=[FbaShipmentLineResponse(**row) for row in lines],
        unknown_lines=[_unknown_line(row) for row in unknown_rows],
        total=total,
        limit=limit,
        offset=offset,
        box_units=box_units,
    )


@router.post("/fba-shipment-library/{upload_id}/scan", response_model=FbaShipmentScanResult)
@handle_api_errors("scan FBA shipment barcode")
def scan_fba_shipment(
    upload_id: str,
    body: FbaShipmentScanRequest,
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    """Count one unit for the scanned external-id. Counts are shared by everyone on the shipment."""
    barcode = strip_upc_label(body.barcode or "")
    if not barcode:
        raise HTTPException(status_code=400, detail="Scan an external-id barcode.")
    if body.box_number is None:
        raise HTTPException(
            status_code=400,
            detail="Enter the box number first (1 to 99999), then scan.",
        )
    box_number = body.box_number
    repo = FbaShipmentLibraryRepository(db)
    try:
        upload = repo.get_upload(upload_id)
        if not upload:
            raise HTTPException(status_code=404, detail="That shipment upload was not found.")
        _require_visible(upload, current_user, is_superadmin_user(current_user, db))
        if upload.get("trashed_at"):
            raise HTTPException(status_code=400, detail="This shipment is in Trash. Restore it before scanning.")
        if upload.get("archived_at"):
            raise HTTPException(status_code=400, detail="This shipment is archived and can no longer be scanned.")
        user_id = str(current_user["id"])
        matches = repo.lines_for_barcode(upload_id, barcode)
        if not matches:
            # The box row is saved first so a missing table stops the scan before it is counted.
            box_scan_id = repo.record_box_scan(upload_id, user_id, barcode, box_number)
            try:
                saved = repo.increment_unknown_scan(upload_id, user_id, barcode)
            except Exception:
                if box_scan_id:
                    repo.delete_box_scan(box_scan_id)
                raise
            # Show the shipment-wide total, not only this person's scans of the barcode.
            for shared in repo.list_unknown_scans(upload_id):
                if str(shared.get("external_id") or "") == barcode:
                    saved = {**saved, "counted": int(shared.get("counted") or 0)}
                    break
            _, in_box = repo.counted_in_box(upload_id, box_number, {}, {barcode: int(saved.get("counted") or 0)})
            return FbaShipmentScanResult(
                barcode=barcode,
                box_number=box_number,
                box_counted=in_box.get(barcode, 0),
                line=_unknown_line(saved),
                fully_accounted=_is_accounted(repo, upload_id),
            )
        counts = repo.counts_for_lines([str(row.get("id") or "") for row in matches])
        for row in matches:
            row["counted"] = counts.get(str(row.get("id") or ""), 0)
        target = choose_line_for_scan(matches)
        box_scan_id = repo.record_box_scan(
            upload_id,
            user_id,
            strip_upc_label(target.get("external_id") or barcode),
            box_number,
            str(target["id"]),
        )
        try:
            counted = repo.increment_count(upload_id, str(target["id"]), user_id)
        except Exception:
            if box_scan_id:
                repo.delete_box_scan(box_scan_id)
            raise
        # Show the shipment-wide total, not only this person's scans of the line.
        counted = repo.counts_for_lines([str(target["id"])]).get(str(target["id"]), counted)
        in_box, _ = repo.counted_in_box(upload_id, box_number, {str(target["id"]): counted}, {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    target["counted"] = counted
    return FbaShipmentScanResult(
        barcode=barcode,
        box_number=box_number,
        box_counted=in_box.get(str(target["id"]), 0),
        line=FbaShipmentLineResponse(**target),
        fully_accounted=_is_accounted(repo, upload_id),
    )


def _box_edit_context(
    repo: FbaShipmentLibraryRepository,
    upload_id: str,
    line_id: str,
    *,
    not_in_list: bool,
    current_user: dict,
    db: Client,
) -> tuple[str, Optional[str], int, list[dict]]:
    """Return external id, line id, counted units, and the box rows that fill them."""
    upload = repo.get_upload(upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="That shipment upload was not found.")
    _require_visible(upload, current_user, is_superadmin_user(current_user, db))
    if upload.get("trashed_at"):
        raise HTTPException(status_code=400, detail="Restore this shipment from Trash before changing a box.")
    if not_in_list:
        found = repo.unknown_scan_total(upload_id, line_id)
        if not found:
            raise HTTPException(status_code=404, detail="That counted item was not found.")
        external_id = strip_upc_label(found[0])
        return external_id, None, found[1], repo.list_unknown_box_scans(upload_id, external_id)
    line = repo.get_line(upload_id, line_id)
    if not line:
        raise HTTPException(status_code=404, detail="That counted item was not found.")
    external_id = strip_upc_label(str(line.get("external_id") or ""))
    counted = repo.counts_for_lines([line_id]).get(line_id, 0)
    return external_id, line_id, counted, repo.list_line_box_scans(upload_id, line_id)


@router.get("/fba-shipment-library/{upload_id}/lines/{line_id}/units", response_model=FbaShipmentUnitsResponse)
@handle_api_errors("list FBA box units")
def list_fba_box_units(
    upload_id: str,
    line_id: str,
    not_in_list: bool = Query(False),
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    """Each counted unit on a line, with the box it was placed in."""
    repo = FbaShipmentLibraryRepository(db)
    try:
        _, _, counted, scans = _box_edit_context(
            repo, upload_id, line_id, not_in_list=not_in_list, current_user=current_user, db=db
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FbaShipmentUnitsResponse(units=units_for_count(counted, scans))


@router.post("/fba-shipment-library/{upload_id}/lines/{line_id}/units", response_model=FbaBoxUnitUpdate)
@handle_api_errors("assign FBA box")
def assign_fba_box_unit(
    upload_id: str,
    line_id: str,
    body: FbaBoxNumberRequest,
    not_in_list: bool = Query(False),
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    """Give a box number to one counted unit that does not have one yet. The count stays the same."""
    repo = FbaShipmentLibraryRepository(db)
    try:
        external_id, stored_line_id, counted, scans = _box_edit_context(
            repo, upload_id, line_id, not_in_list=not_in_list, current_user=current_user, db=db
        )
        if len(scans) >= counted:
            raise HTTPException(status_code=400, detail="Every counted unit on this item already has a box.")
        scan_id = repo.record_box_scan(
            upload_id, str(current_user["id"]), external_id, body.box_number, stored_line_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FbaBoxUnitUpdate(unit_number=len(scans) + 1, scan_id=scan_id, box_number=body.box_number)


@router.patch("/fba-shipment-library/{upload_id}/box-scans/{scan_id}", response_model=FbaBoxUnitUpdate)
@handle_api_errors("edit FBA box")
def update_fba_box_unit(
    upload_id: str,
    scan_id: str,
    body: FbaBoxNumberRequest,
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    """Change the box number on one already counted unit."""
    repo = FbaShipmentLibraryRepository(db)
    try:
        upload = repo.get_upload(upload_id)
        if not upload:
            raise HTTPException(status_code=404, detail="That shipment upload was not found.")
        _require_visible(upload, current_user, is_superadmin_user(current_user, db))
        if upload.get("trashed_at"):
            raise HTTPException(status_code=400, detail="Restore this shipment from Trash before changing a box.")
        repo.update_box_number(upload_id, scan_id, body.box_number)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FbaBoxUnitUpdate(unit_number=0, scan_id=scan_id, box_number=body.box_number)


@router.delete("/fba-shipment-library/{upload_id}/lines/{line_id}/units", status_code=204)
@handle_api_errors("delete FBA counted unit")
def delete_fba_unit(
    upload_id: str,
    line_id: str,
    scan_id: Optional[str] = Query(None),
    not_in_list: bool = Query(False),
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    """Remove one counted unit. The shared count for that UPC goes down by 1."""
    repo = FbaShipmentLibraryRepository(db)
    try:
        upload = repo.get_upload(upload_id)
        if not upload:
            raise HTTPException(status_code=404, detail="That shipment upload was not found.")
        _require_visible(upload, current_user, is_superadmin_user(current_user, db))
        if upload.get("trashed_at"):
            raise HTTPException(status_code=400, detail="Restore this shipment from Trash before removing a unit.")
        if upload.get("archived_at"):
            raise HTTPException(status_code=400, detail="This shipment is archived and can no longer be changed.")
        scan = repo.get_box_scan(upload_id, scan_id) if scan_id else None
        if scan_id and not scan:
            raise HTTPException(status_code=404, detail="That unit was not found.")
        user_id = str(scan.get("user_id") or "") if scan else None
        if not_in_list:
            found = repo.unknown_scan_total(upload_id, line_id)
            if not found:
                raise HTTPException(status_code=404, detail="That counted item was not found.")
            external_id = strip_upc_label(found[0])
            if scan and strip_upc_label(str(scan.get("external_id") or "")) != external_id:
                raise HTTPException(status_code=400, detail="That unit does not belong to this item.")
            repo.decrement_unknown_scan(upload_id, external_id, user_id)
        else:
            line = repo.get_line(upload_id, line_id)
            if not line:
                raise HTTPException(status_code=404, detail="That counted item was not found.")
            if scan and str(scan.get("line_id") or "") != line_id:
                raise HTTPException(status_code=400, detail="That unit does not belong to this item.")
            repo.decrement_count(line_id, user_id)
        if scan_id:
            try:
                repo.remove_box_scan(upload_id, scan_id)
            except Exception:
                if not_in_list:
                    repo.increment_unknown_scan(upload_id, user_id or str(current_user["id"]), external_id)
                else:
                    repo.increment_count(upload_id, line_id, user_id or str(current_user["id"]))
                raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/fba-shipment-library/{upload_id}/access", response_model=FbaShipmentUploadResponse)
@handle_api_errors("change FBA shipment access")
def set_fba_shipment_access(
    upload_id: str,
    body: FbaShipmentAccessRequest,
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    """Owner locks a shipment so only they can open it, or shares it with other workers."""
    repo = FbaShipmentLibraryRepository(db)
    can_manage_any = is_superadmin_user(current_user, db)
    try:
        upload = repo.get_upload(upload_id)
        if not upload:
            raise HTTPException(status_code=404, detail="That shipment upload was not found.")
        if not _owns_upload(upload, current_user, can_manage_any):
            raise HTTPException(status_code=403, detail="Only the owner can lock or share this shipment.")
        if upload.get("trashed_at"):
            raise HTTPException(status_code=400, detail="Restore this shipment from Trash before changing access.")
        saved = repo.set_locked(upload_id, body.locked)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _upload_response(
        saved,
        current_user,
        can_manage_any=can_manage_any,
        uploader_names=_given_names_by_user(db, [str(saved.get("created_by") or "")]),
    )


@router.post("/fba-shipment-library/{upload_id}/archive", response_model=FbaShipmentUploadResponse)
@handle_api_errors("archive FBA shipment")
def archive_fba_shipment(
    upload_id: str,
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    """Move a fully accounted shipment into the completed archive."""
    repo = FbaShipmentLibraryRepository(db)
    can_manage_any = is_superadmin_user(current_user, db)
    try:
        upload = repo.get_upload(upload_id)
        if not upload:
            raise HTTPException(status_code=404, detail="That shipment upload was not found.")
        if not _owns_upload(upload, current_user, can_manage_any):
            raise HTTPException(status_code=403, detail="Only the owner can archive this shipment.")
        if upload.get("trashed_at"):
            raise HTTPException(status_code=400, detail="Restore this shipment from Trash before archiving it.")
        if upload.get("archived_at"):
            raise HTTPException(status_code=400, detail="This shipment is already archived.")
        if not _is_accounted(repo, upload_id):
            raise HTTPException(
                status_code=400,
                detail="Archive is available after every line is All Accounted.",
            )
        saved = repo.archive_upload(upload_id, str(current_user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    saved["fully_accounted"] = True
    return _upload_response(
        saved,
        current_user,
        can_manage_any=can_manage_any,
        uploader_names=_given_names_by_user(db, [str(saved.get("created_by") or "")]),
    )


@router.get("/fba-shipment-library/{upload_id}/report")
@handle_api_errors("download FBA accounting report")
def download_fba_accounting_report(
    upload_id: str,
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    """Download the accounting workbook with everyone's counts for the shipment."""
    repo = FbaShipmentLibraryRepository(db)
    can_manage_any = is_superadmin_user(current_user, db)
    try:
        upload = repo.get_upload(upload_id)
        if not upload:
            raise HTTPException(status_code=404, detail="That shipment upload was not found.")
        _require_visible(upload, current_user, can_manage_any)
        rows = repo.list_line_quantities(upload_id)
        counts = repo.counts_for_lines([str(row.get("id") or "") for row in rows])
        for row in rows:
            row["counted"] = counts.get(str(row.get("id") or ""), 0)
        unknown_rows = repo.list_unknown_scans(upload_id)
        box_scans = repo.list_box_scans(upload_id)
        counter_ids = repo.counter_user_ids(upload_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _, _, name = _creator_snapshot(db, current_user)
    counter_names = _given_names_by_user(db, counter_ids)
    counted_by = ", ".join(
        dict.fromkeys(counter_names[user] for user in counter_ids if counter_names.get(user))
    )
    try:
        content = build_accounting_workbook(
            shipment_id=upload.get("shipment_id") or "shipment",
            counted_by=counted_by or name or (current_user.get("email") or ""),
            lines=rows,
            unknown_lines=unknown_rows,
            box_scans=box_scans,
        )
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    filename = f"{upload.get('shipment_id') or 'shipment'} Accounting.xlsx"
    return StreamingResponse(
        iter([content]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/fba-shipment-library/import", response_model=FbaShipmentImportResult)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("import FBA shipment")
async def import_fba_shipment(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_fba_order_checker_user),
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
            uploader_names=_given_names_by_user(db, [str(saved.get("created_by") or "")]),
        )
    )


def _require_owner(upload: dict, current_user: dict, db: Client) -> None:
    owner = str(upload.get("created_by") or "")
    if owner != str(current_user.get("id") or "") and not is_superadmin_user(current_user, db):
        raise HTTPException(
            status_code=403,
            detail="You can remove only shipments you uploaded.",
        )


@router.post("/fba-shipment-library/trash/empty")
@handle_api_errors("empty FBA shipment trash")
def empty_fba_trash(
    mine: bool = Query(False),
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    repo = FbaShipmentLibraryRepository(db)
    can_manage_any = is_superadmin_user(current_user, db)
    owner = str(current_user["id"]) if mine or not can_manage_any else None
    try:
        deleted = repo.empty_trash(created_by=owner)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deleted": deleted}


@router.post("/fba-shipment-library/{upload_id}/trash", response_model=FbaShipmentUploadResponse)
@handle_api_errors("trash FBA shipment")
def trash_fba_shipment(
    upload_id: str,
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    repo = FbaShipmentLibraryRepository(db)
    can_manage_any = is_superadmin_user(current_user, db)
    try:
        upload = repo.get_upload(upload_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not upload:
        raise HTTPException(status_code=404, detail="That shipment upload was not found.")
    _require_owner(upload, current_user, db)
    if upload.get("trashed_at"):
        raise HTTPException(status_code=400, detail="That shipment is already in Trash.")
    try:
        saved = repo.trash_upload(upload_id, str(current_user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _upload_response(
        saved,
        current_user,
        can_manage_any=can_manage_any,
        uploader_names=_given_names_by_user(db, [str(saved.get("created_by") or "")]),
    )


@router.post("/fba-shipment-library/{upload_id}/restore", response_model=FbaShipmentUploadResponse)
@handle_api_errors("restore FBA shipment")
def restore_fba_shipment(
    upload_id: str,
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    repo = FbaShipmentLibraryRepository(db)
    can_manage_any = is_superadmin_user(current_user, db)
    try:
        upload = repo.get_upload(upload_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not upload:
        raise HTTPException(status_code=404, detail="That shipment upload was not found.")
    _require_owner(upload, current_user, db)
    if not upload.get("trashed_at"):
        raise HTTPException(status_code=400, detail="That shipment is not in Trash.")
    try:
        saved = repo.restore_upload(upload_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _upload_response(
        saved,
        current_user,
        can_manage_any=can_manage_any,
        uploader_names=_given_names_by_user(db, [str(saved.get("created_by") or "")]),
    )


@router.delete("/fba-shipment-library/{upload_id}")
@handle_api_errors("delete FBA shipment")
def delete_fba_shipment(
    upload_id: str,
    current_user: dict = Depends(get_fba_order_checker_user),
    db: Client = Depends(get_supabase),
):
    repo = FbaShipmentLibraryRepository(db)
    try:
        upload = repo.get_upload(upload_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not upload:
        raise HTTPException(status_code=404, detail="That shipment upload was not found.")
    _require_owner(upload, current_user, db)
    if not upload.get("trashed_at"):
        raise HTTPException(
            status_code=400,
            detail="Move the shipment to Trash before removing it for good.",
        )
    try:
        repo.delete_upload(upload_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deleted": True}
