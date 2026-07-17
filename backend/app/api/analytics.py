"""Off-price analytics API (web app; independent of dashboard/reports)."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from typing import List, Literal, Optional

from supabase import Client

from app.config import settings
from app.database import get_supabase
from app.dependencies import get_current_user
from app.repositories.off_price_analytics_download_log_repository import (
    OffPriceAnalyticsDownloadLogRepository,
)
from app.repositories.off_price_analytics_user_tracking_repository import (
    OffPriceAnalyticsUserTrackingRepository,
)
from app.services.email_service import EmailService
from app.services.off_price_analytics_service import OffPriceAnalyticsService
from app.services.off_price_analytics_vendors import VENDOR_CODES
from app.utils.email_recipient_utils import parse_recipient_csv
from app.utils.error_handler import handle_api_errors

router = APIRouter()

PeriodParam = Literal["daily", "weekly", "monthly", "yearly"]

# Cap Analytics email attachments so this endpoint cannot be abused as a bulk mailer.
_MAX_ANALYTICS_EMAIL_BYTES = 25 * 1024 * 1024

_DEFAULT_ANALYTICS_ALLOWED = frozenset(
    {
        "remote@metroshoewarehouse.com",
        "stephanie@metroshoewarehouse.com",
        "sunshine@metroshoewarehouse.com",
        "orvillebarba@gmail.com",
    }
)


def _analytics_allowed_emails() -> set[str]:
    configured = set(settings.analytics_allowed_emails_list)
    return configured or set(_DEFAULT_ANALYTICS_ALLOWED)


def require_analytics_access(current_user: dict = Depends(get_current_user)) -> dict:
    """Restrict Analytics API to the approved email allowlist."""
    email = (current_user.get("email") or "").strip().lower()
    if email not in _analytics_allowed_emails():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Off-Price Analytics is restricted to authorized users",
        )
    return current_user


def _require_dev_seed() -> None:
    """Demo history seeding stays local/development-only."""
    env = (settings.environment or "").strip().lower()
    if env not in {"development", "dev", "local"}:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Demo history seeding is only available in development",
        )


def _user_id(current_user: dict) -> str:
    uid = current_user.get("id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return str(uid)


def _display_name(current_user: dict, db: Client) -> Optional[str]:
    uid = current_user.get("id")
    if uid:
        try:
            profile = (
                db.table("profiles")
                .select("display_name, email")
                .eq("id", str(uid))
                .limit(1)
                .execute()
            )
            row = (profile.data or [None])[0]
            if row:
                name = (row.get("display_name") or "").strip()
                if name:
                    return name
                email = (row.get("email") or current_user.get("email") or "").strip()
                if email:
                    return email.split("@")[0]
        except Exception:
            pass
    meta = current_user.get("user_metadata") or {}
    return (
        (meta.get("display_name") or "").strip()
        or (current_user.get("email") or "").split("@")[0]
        or None
    )


class DownloadLogCreate(BaseModel):
    vendor_codes: List[str] = Field(default_factory=list)
    filename: Optional[str] = None
    period: Optional[str] = None


@router.get("/analytics/off-price")
@handle_api_errors("get off-price analytics")
def get_off_price_analytics(
    period: PeriodParam = Query("weekly"),
    offset: int = Query(0, ge=0, le=120),
    persist: bool = Query(True),
    current_user: dict = Depends(require_analytics_access),
    db: Client = Depends(get_supabase),
):
    """Period counts using the current user's personal tracking preferences."""
    service = OffPriceAnalyticsService(db)
    return service.get_off_price_summary(
        period,
        offset=offset,
        persist=persist,
        user_id=_user_id(current_user),
    )


@router.get("/analytics/off-price/archives")
@handle_api_errors("list off-price analytics archives")
def list_off_price_analytics_archives(
    period_type: Optional[PeriodParam] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    current_user: dict = Depends(require_analytics_access),
    db: Client = Depends(get_supabase),
):
    service = OffPriceAnalyticsService(db)
    return service.list_archives(period_type=period_type, limit=limit)


@router.get("/analytics/off-price/archives/{period_type}/{period_key}")
@handle_api_errors("get off-price analytics archive")
def get_off_price_analytics_archive(
    period_type: PeriodParam,
    period_key: str,
    current_user: dict = Depends(require_analytics_access),
    db: Client = Depends(get_supabase),
):
    service = OffPriceAnalyticsService(db)
    row = service.get_archive(period_type, period_key)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No archived analytics for {period_type}/{period_key}",
        )
    return row


@router.post("/analytics/off-price/seed-demo-history")
@handle_api_errors("seed demo off-price analytics history")
def seed_demo_off_price_history(
    current_user: dict = Depends(require_analytics_access),
    db: Client = Depends(get_supabase),
):
    _require_dev_seed()
    service = OffPriceAnalyticsService(db)
    return service.seed_demo_history()


@router.get("/analytics/off-price/tracking")
@handle_api_errors("list personal analytics tracking settings")
def list_analytics_tracking(
    current_user: dict = Depends(require_analytics_access),
    db: Client = Depends(get_supabase),
):
    """List this user's personal per-vendor analytics tracking toggles."""
    repo = OffPriceAnalyticsUserTrackingRepository(db)
    return {"vendors": repo.list_settings(_user_id(current_user))}


@router.put("/analytics/off-price/tracking/{vendor_code}")
@handle_api_errors("update personal analytics tracking setting")
def update_analytics_tracking(
    vendor_code: str,
    enabled: bool = Query(..., description="true = start tracking, false = stop tracking"),
    current_user: dict = Depends(require_analytics_access),
    db: Client = Depends(get_supabase),
):
    """
    Start/stop analytics tracking for one vendor for the current user only.

    Does not change other users' preferences, Daily Run scheduler, Express Jobs,
    or historical shared archives.
    """
    repo = OffPriceAnalyticsUserTrackingRepository(db)
    try:
        return repo.set_tracking(_user_id(current_user), vendor_code, enabled)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Could not save personal tracking. Apply migration "
                "create_off_price_analytics_user_tracking_and_download_logs.sql. "
                f"({exc})"
            ),
        ) from exc


@router.get("/analytics/off-price/download-logs")
@handle_api_errors("list analytics download logs")
def list_analytics_download_logs(
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(require_analytics_access),
    db: Client = Depends(get_supabase),
):
    """Shared audit trail of who downloaded which vendor analytics and when."""
    repo = OffPriceAnalyticsDownloadLogRepository(db)
    try:
        return {"logs": repo.list_logs(limit=limit), "available": True}
    except Exception as exc:
        return {"logs": [], "available": False, "detail": str(exc)}


@router.post("/analytics/off-price/download-logs")
@handle_api_errors("record analytics download log")
def record_analytics_download_log(
    body: DownloadLogCreate,
    current_user: dict = Depends(require_analytics_access),
    db: Client = Depends(get_supabase),
):
    """Record that the current user downloaded an analytics Excel report."""
    codes = [c.strip().lower() for c in body.vendor_codes if c.strip().lower() in VENDOR_CODES]
    repo = OffPriceAnalyticsDownloadLogRepository(db)
    try:
        return repo.record_download(
            user_id=_user_id(current_user),
            user_display_name=_display_name(current_user, db),
            user_email=current_user.get("email"),
            vendor_codes=codes,
            filename=body.filename,
            period=body.period,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Could not record download log. Apply migration "
                "create_off_price_analytics_user_tracking_and_download_logs.sql. "
                f"({exc})"
            ),
        ) from exc


@router.post("/analytics/off-price/email-report")
@handle_api_errors("email off-price analytics report")
async def email_off_price_analytics_report(
    file: UploadFile = File(..., description="Analytics Excel workbook generated by the web UI"),
    email_recipients: str = Form(""),
    email_bcc_recipients: str = Form(""),
    vendor_codes: str = Form(""),
    period: str = Form(""),
    filename: str = Form("off-price-analytics.xlsx"),
    current_user: dict = Depends(require_analytics_access),
    db: Client = Depends(get_supabase),
):
    """
    Email an Analytics Excel report to chosen To/BCC recipients.

    Isolated from Daily Run / Express / Keepa Import completion emails — this only
    sends the workbook the web UI already built and does not create jobs or claims.
    """
    to_list = parse_recipient_csv(email_recipients)
    bcc_list = parse_recipient_csv(email_bcc_recipients)
    if not to_list and not bcc_list:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one To or BCC recipient",
        )

    safe_name = (filename or "off-price-analytics.xlsx").strip() or "off-price-analytics.xlsx"
    if not safe_name.lower().endswith((".xlsx", ".xls", ".csv")):
        safe_name = f"{safe_name}.xlsx"
    # Prevent path tricks in Content-Disposition
    safe_name = safe_name.replace("\\", "_").replace("/", "_").replace('"', "")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty report file")
    if len(file_bytes) > _MAX_ANALYTICS_EMAIL_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Report is too large to email (max 25 MB)",
        )

    codes = [
        c.strip().lower()
        for c in (vendor_codes or "").split(",")
        if c.strip().lower() in VENDOR_CODES
    ]
    period_label = (period or "").strip() or "analytics"
    vendor_note = (
        "all vendors"
        if len(codes) >= len(VENDOR_CODES)
        else (", ".join(c.upper() for c in codes) if codes else "selected vendors")
    )
    sender_name = _display_name(current_user, db) or current_user.get("email") or "Analytics user"
    subject = f"Off-Price Analytics Report — {period_label}"
    body = (
        f"Hi,\n\n"
        f"{sender_name} sent an Off-Price Analytics Excel report from MSW Overwatch.\n\n"
        f"Period: {period_label}\n"
        f"Vendors: {vendor_note}\n"
        f"Filename: {safe_name}\n\n"
        "This message was sent from the Analytics page only and is not a Daily Run "
        "or Express Job completion email.\n"
    )

    email_service = EmailService()
    sent = email_service.send_binary_attachment(
        file_bytes=file_bytes,
        filename=safe_name,
        subject=subject,
        body=body,
        recipient_email=",".join(to_list) if to_list else None,
        bcc_emails=bcc_list,
        mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_default_recipients=False,
    )
    if not sent:
        detail = email_service.last_error or "Failed to send analytics email"
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)

    log_filename = f"emailed:{safe_name}"
    try:
        OffPriceAnalyticsDownloadLogRepository(db).record_download(
            user_id=_user_id(current_user),
            user_display_name=_display_name(current_user, db),
            user_email=current_user.get("email"),
            vendor_codes=codes,
            filename=log_filename,
            period=period_label,
        )
    except Exception:
        # Email already sent; logging failure must not undo delivery.
        pass

    return {
        "sent": True,
        "filename": safe_name,
        "to_count": len(to_list),
        "bcc_count": len(bcc_list),
        "vendor_codes": codes,
    }
