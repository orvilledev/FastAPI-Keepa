"""LTL Label Format Checker API — verify Amazon FBA LTL box label PDFs and their box (B) order."""
# NOTE: do not add ``from __future__ import annotations`` here — with the decorators below it
# turns ``UploadFile`` into a ForwardRef and FastAPI crashes on boot (see commit 9a23c05).
import base64
import logging
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from starlette.concurrency import run_in_threadpool

from app.middleware.rate_limiter import RateLimits, limiter
from app.services.ltl_label_format_checker import (
    MAX_UPLOAD_BYTES,
    LtlLabelFormatCheckerError,
    build_report_xlsx,
    check_uploads,
    extract_pdf_from_upload,
    reorder_pdf_by_box_number,
    report_filename,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_ACCEPTED_SUFFIXES = (".pdf", ".zip")


@router.post("/ltl-label-format-checker/check", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("check LTL label formats")
async def check_ltl_label_formats(
    request: Request,
    files: List[UploadFile] = File(
        ...,
        description="One or more LTL box label .pdf files and/or .zip archives of them",
    ),
):
    """Check one or more LTL label PDFs (or every PDF in each ZIP) against the LTL box label
    format and verify the box tags run B1, B2, B3, ... in page order.

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
    except LtlLabelFormatCheckerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = run.to_dict()
    payload["report_filename"] = report_filename(run)
    payload["report_xlsx_base64"] = base64.b64encode(report).decode("ascii")
    return payload


@router.post("/ltl-label-format-checker/reorder", response_model=None)
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("reorder LTL label PDF")
async def reorder_ltl_label_pdf(
    request: Request,
    file: UploadFile = File(..., description="The LTL label .pdf, or the .zip that contains it"),
    member: Optional[str] = Form(None, description="Path of the PDF inside the .zip"),
):
    """Return the PDF with its pages rearranged so the box tags run B1, B2, B3, ...

    Pages are moved, never redrawn, so the content and layout of every label is unchanged.
    """
    name = file.filename or "upload"
    if not name.lower().endswith(_ACCEPTED_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail=f'"{name}" is not supported. Upload a .pdf label file or a .zip of them.',
        )
    raw = await file.read()
    try:
        pdf_name, pdf_bytes = await run_in_threadpool(extract_pdf_from_upload, name, raw, member)
        result = await run_in_threadpool(reorder_pdf_by_box_number, pdf_name, pdf_bytes)
    except LtlLabelFormatCheckerError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    ascii_name = result.filename.encode("ascii", "replace").decode("ascii").replace("?", "_").replace('"', "")
    return Response(
        content=result.pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(result.filename)}'
            ),
            "X-Ltl-Reorder-Filename": quote(result.filename),
            "X-Ltl-Reorder-Pages": str(len(result.page_order)),
            "X-Ltl-Reorder-Moved": str(result.moved_pages),
            "X-Ltl-Reorder-First-Box": str(result.first_box or ""),
            "X-Ltl-Reorder-Last-Box": str(result.last_box or ""),
            "X-Ltl-Reorder-Missing": ",".join(str(m) for m in result.missing),
        },
    )
