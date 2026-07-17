"""Off-price analytics API (web app; independent of dashboard/reports)."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
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
from app.services.off_price_analytics_service import OffPriceAnalyticsService
from app.services.off_price_analytics_vendors import VENDOR_CODES
from app.utils.error_handler import handle_api_errors

router = APIRouter()

PeriodParam = Literal["daily", "weekly", "monthly", "yearly"]

_DEFAULT_ANALYTICS_ALLOWED = frozenset(
    {
        "remote@metroshoewarehouse.com",
        "stephanie@metroshoewarehouse.com",
        "sunshine@metroshoewarehouse.com",
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
