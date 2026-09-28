"""SMW Shipment Analyzer API — basic pair check and advanced multi-file analysis."""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response

from app.dependencies import get_shipment_analyzer_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.services.smw_shipment_analyzer import (
    MAX_FILES,
    MAX_UPLOAD_BYTES,
    AnalyzerResult,
    SmwShipmentAnalyzerError,
    analyze_advanced,
    analyze_basic,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_ACCEPTED_SUFFIXES = (".xls", ".xlsx", ".xlsm", ".csv", ".txt", ".tsv")


async def _read_uploads(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    if not files:
        raise HTTPException(status_code=400, detail="No files were uploaded.")
    if len(files) > MAX_FILES:
        raise HTTPException(
            status_code=400, detail=f"Upload at most {MAX_FILES} files at a time."
        )

    uploads: list[tuple[str, bytes]] = []
    for file in files:
        name = file.filename or "upload"
        if not name.lower().endswith(_ACCEPTED_SUFFIXES):
            raise HTTPException(
                status_code=400,
                detail=(
                    f'"{name}" is not a supported file. Upload the box contents request '
                    "(.xls/.xlsx) and the pack list (.csv/.xlsx)."
                ),
            )
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail=f'"{name}" is empty.')
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail=f'"{name}" is too large (max 15 MB).')
        uploads.append((name, raw))
    return uploads


def _analysis_response(result: AnalyzerResult) -> Response:
    return Response(
        content=result.file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{result.filename}"',
            "X-Smw-Filename": result.filename,
            "X-Smw-Shipment-Id": result.shipment_id,
            "X-Smw-Shipment-Count": str(result.shipment_count),
            "X-Smw-File-Count": str(result.file_count),
            "X-Smw-Upc-Count": str(result.upc_count),
            "X-Smw-Total-Units": str(result.total_units),
            "X-Smw-Discrepancy-Count": str(result.discrepancy_count),
            "X-Smw-Resolved-Count": str(result.resolved_count),
            "X-Smw-Unresolved-Count": str(result.unresolved_count),
        },
    )


@router.post("/smw-shipment-analyzer/basic", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("run the basic SMW shipment analysis")
async def analyze_basic_pair(
    request: Request,
    files: list[UploadFile] = File(..., description="Box contents request + pack list"),
    current_user=Depends(get_shipment_analyzer_user),
):
    """Basic — one box contents request against one pack list for a single shipment."""
    _ = current_user
    uploads = await _read_uploads(files)
    if len(uploads) != 2:
        raise HTTPException(
            status_code=400,
            detail=(
                "Basic analysis takes exactly two files: the box contents request and the "
                "pack list for one shipment."
            ),
        )
    try:
        result = analyze_basic(uploads)
    except SmwShipmentAnalyzerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _analysis_response(result)


@router.post("/smw-shipment-analyzer/advanced", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("run the advanced SMW shipment analysis")
async def analyze_advanced_set(
    request: Request,
    files: list[UploadFile] = File(..., description="Any number of requests and pack lists"),
    current_user=Depends(get_shipment_analyzer_user),
):
    """Advanced — many shipments at once, with differences chased across shipment ids."""
    _ = current_user
    uploads = await _read_uploads(files)
    if len(uploads) < 2:
        raise HTTPException(
            status_code=400,
            detail="Advanced analysis needs at least two files.",
        )
    try:
        result = analyze_advanced(uploads)
    except SmwShipmentAnalyzerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _analysis_response(result)
