"""Public (unauthenticated) endpoints for web and Electron clients."""
from fastapi import APIRouter

from app.config import settings

router = APIRouter()


@router.get("/public/client-config")
async def get_client_config():
    """Non-sensitive client hints (desktop installer URL, etc.)."""
    return {
        "desktop_app_download_url": (settings.desktop_app_download_url or "").strip(),
        "mfa_exempt_emails": settings.mfa_exempt_emails_list,
    }
