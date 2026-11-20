"""Label Format Checker API — verify Amazon FBA box labels (Thermal Printing - 4x6 inches)."""
# NOTE: do not add ``from __future__ import annotations`` here — with the decorators below it
# turns ``UploadFile`` into a ForwardRef and FastAPI crashes on boot (see commit 9a23c05).
import base64
import logging
from typing import List

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.middleware.rate_limiter import RateLimits, limiter
from app.services.label_format_checker import (
    MAX_UPLOAD_BYTES,
    LabelFormatCheckerError,
    build_report_xlsx,
    check_uploads,
    report_filename,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_ACCEPTED_SUFFIXES = (".pdf", ".zip")


@router.post("/label-format-checker/check", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("check label formats")
async def check_label_formats(
    request: Request,
    files: List[UploadFile] = File(
        ...,
        description="One or more box label .pdf files and/or .zip archives of them",
    ),
):
    """Check one or more PDFs (or every PDF in each ZIP) against the Amazon box label format.

    Returns the per-file / per-check results for the on-screen preview together with the
    Excel report (base64) so the Download button needs no second upload.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files were uploaded.")

    items = []
    for upload in files:
        name = upload.filename or "upload"
        if not name.lower().endswith(_ACCEPTED_SUFFIXES):
            raise HTTPException(
                status_code=400,
                detail=(
                    f'"{name}" is not supported. Upload .pdf label files or .zip archives '
                    "containing .pdf labels."
                ),
            )
        raw = await upload.read()
        if not raw:
            raise HTTPException(status_code=400, detail=f'"{name}" is empty.')
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f'"{name}" is too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).',
            )
        items.append((name, raw))

    try:
        run = await run_in_threadpool(check_uploads, items)
        report = await run_in_threadpool(build_report_xlsx, run)
    except LabelFormatCheckerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = run.to_dict()
    payload["report_filename"] = report_filename(run)
    payload["report_xlsx_base64"] = base64.b64encode(report).decode("ascii")
    return payload
