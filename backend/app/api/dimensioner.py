"""QBOID M2 dimensioner API.

Two routers live here because they are authenticated differently:

* ``receiver_router`` is called by the M2 itself. The device cannot sign in, so it
  proves who it is with a shared secret in the ``Authorization`` header
  (``DIMENSIONER_API_KEY``). It only ever stores a scan.
* ``router`` is called by the web app. Only Orville, Stephanie, Sunshine, Paolo,
  John Bernard, and superadmin accounts may list, delete, or save a camera test scan.

Nothing here touches any other table or tool.
"""
import asyncio
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from supabase import Client

from app.config import settings
from app.database import get_supabase
from app.dependencies import get_dimensioner_user
from app.middleware.rate_limiter import limiter
from app.repositories.dimensioner_scan_repository import (
    DimensionerScanRepository,
    DimensionerStorageError,
)
from app.services.dimensioner_scans import (
    MAX_BODY_BYTES,
    DimensionerPayloadError,
    DimensionerTestInputError,
    api_key_matches,
    build_camera_test_scan,
    parse_scan_payload,
    present_scan,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

receiver_router = APIRouter()
router = APIRouter()

# A handful of devices scanning a few items a minute; this only blunts abuse.
_RECEIVE_LIMIT = "300/minute"
_RECEIVE_PATH = "/dimensioner/new-entry"


def _receiver_configured() -> bool:
    return bool((settings.dimensioner_api_key or "").strip())


async def _read_body_capped(request: Request) -> bytes | None:
    """Read the request body, or return None once it passes ``MAX_BODY_BYTES``."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return None
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_BODY_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


@receiver_router.post(_RECEIVE_PATH)
@limiter.limit(_RECEIVE_LIMIT)
async def receive_scan(
    request: Request,
    db: Client = Depends(get_supabase),
):
    """Store one dimensioning record posted by a QBOID M2.

    Replies 200 for anything the device does not need to resend (stored, already
    stored, or a record with nothing in it). Replies 5xx when storage fails so the
    device keeps the scan in its upload queue and tries again.
    """
    if not _receiver_configured():
        return JSONResponse(
            status_code=503,
            content={"detail": "The dimensioner receiver is not configured on this server."},
        )

    if not api_key_matches(request.headers.get("authorization"), settings.dimensioner_api_key):
        logger.warning(
            "Dimensioner upload rejected: bad or missing Authorization header (client=%s)",
            request.client.host if request.client else "unknown",
        )
        return JSONResponse(status_code=401, content={"detail": "Invalid Authorization header."})

    body = await _read_body_capped(request)
    if body is None:
        return JSONResponse(status_code=413, content={"detail": "Request body is too large."})

    try:
        parsed = parse_scan_payload(body)
    except DimensionerPayloadError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    if parsed is None:
        return {"status": "ok", "stored": False, "duplicate": False, "reason": "empty record"}

    try:
        saved = await asyncio.to_thread(DimensionerScanRepository(db).insert, parsed.to_row())
    except DimensionerStorageError as exc:
        # 503 (not 400) so the device treats it as temporary and retries later.
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    if saved is None:
        return {"status": "ok", "stored": False, "duplicate": True}
    return {"status": "ok", "stored": True, "duplicate": False, "id": str(saved.get("id") or "")}


@router.get("/dimensioner/scans")
@handle_api_errors("list dimensioner scans")
def list_scans(
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None, max_length=128),
    current_user: dict = Depends(get_dimensioner_user),
    db: Client = Depends(get_supabase),
):
    """Newest scans first, plus what the page needs to explain device setup."""
    _ = current_user
    try:
        rows = DimensionerScanRepository(db).list_recent(limit, search)
    except DimensionerStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "scans": [present_scan(row) for row in rows],
        "receiver_configured": _receiver_configured(),
        "receive_path": f"{settings.api_v1_str}{_RECEIVE_PATH}",
    }


class CameraTestScanBody(BaseModel):
    """A practice scan. Sizes and weight are optional and are inches and pounds."""

    barcode: str
    length_in: float | None = None
    width_in: float | None = None
    height_in: float | None = None
    weight_lb: float | None = None


@router.post("/dimensioner/scans/test")
@handle_api_errors("save a camera test scan")
def create_camera_test_scan(
    body: CameraTestScanBody,
    current_user: dict = Depends(get_dimensioner_user),
    db: Client = Depends(get_supabase),
):
    """Store one scan typed in from the page's camera test. Does not use the M2 key."""
    _ = current_user
    try:
        parsed = build_camera_test_scan(
            barcode=body.barcode,
            length_in=body.length_in,
            width_in=body.width_in,
            height_in=body.height_in,
            weight_lb=body.weight_lb,
        )
    except DimensionerTestInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        saved = DimensionerScanRepository(db).insert(parsed.to_row())
    except DimensionerStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not saved or not saved.get("id"):
        raise HTTPException(status_code=503, detail="The test scan was not saved.")
    return present_scan(saved)


@router.delete("/dimensioner/scans/{scan_id}")
@handle_api_errors("delete dimensioner scan")
def delete_scan(
    scan_id: UUID,
    current_user: dict = Depends(get_dimensioner_user),
    db: Client = Depends(get_supabase),
):
    """Remove one scan, for example a mis-measured item."""
    _ = current_user
    try:
        removed = DimensionerScanRepository(db).delete(str(scan_id))
    except DimensionerStorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="Scan not found.")
    return {"deleted": True}
