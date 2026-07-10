"""Application configuration settings."""
from pydantic_settings import BaseSettings
from typing import List
from pathlib import Path
import os

# Find .env file relative to backend directory, not current working directory
# This ensures .env is found regardless of where the command is run from
BACKEND_DIR = Path(__file__).parent.parent
ENV_FILE = BACKEND_DIR / ".env"

# Production frontend origins that must always be allowed even when the host
# ``CORS_ORIGINS`` env var is missing or stale. Keep this list short and only
# include canonical first-party origins.
_ALWAYS_ALLOWED_CORS_ORIGINS = (
    "https://www.mswoverwatch.com",
    "https://mswoverwatch.com",
)

class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Keepa API Configuration
    keepa_api_key: str
    keepa_api_keys: str = ""
    # Optional dedicated key pool for the Keepa Import File tool only. When set
    # (comma-separated), that tool uses ONLY these keys instead of the full
    # keepa_api_keys pool; Express Jobs and daily runs are unaffected. Use this
    # to point Import File at the few high-refill keys so large vendor builds
    # finish in one pass. Leave empty to fall back to the full key pool.
    keepa_import_api_keys: str = ""
    keepa_api_url: str = "https://api.keepa.com/"
    # Keepa request-shape tuning for performance
    keepa_domain: str = "1"
    keepa_stats_window_days: int = 180
    keepa_include_history: bool = False
    keepa_offers_limit: int = 50
    keepa_include_buybox: bool = True
    keepa_rate_limit_delay_seconds: float = 0.8
    keepa_min_rate_limit_delay_seconds: float = 0.15
    keepa_delay_offers_reference: int = 50
    keepa_max_retries: int = 3
    keepa_retry_delay_seconds: float = 2.0
    keepa_retry_max_delay_seconds: float = 30.0
    keepa_retry_jitter_seconds: float = 0.5
    keepa_429_cooldown_max_delay_seconds: float = 5.0
    keepa_cancel_check_every_items: int = 10
    batch_inter_delay_seconds: float = 0.0

    # Keepa offer-level filters used when merging offers[] into the unified
    # seller list (backend/app/services/keepa_sellers.py). These eliminate
    # false-positive "off-price" sellers that are not actually listing the UPC
    # right now (used/refurb, addon-only, scam, out of stock, stale). Gates
    # apply only to entries from offers[]; current_sellers entries are trusted.
    # Defaults are permissive when Keepa omits the underlying field, so legit
    # offers without these fields are not lost. Set to false to disable a gate.
    keepa_offer_require_new_condition: bool = True
    keepa_offer_drop_disqualifying_flags: bool = True
    keepa_offer_drop_zero_stock: bool = True
    # Reject offers whose Keepa lastSeen is older than this many minutes.
    # Default: 48h. Set to 0 to disable freshness gating.
    keepa_offer_max_age_minutes: int = 60 * 24 * 2
    
    @property
    def keepa_api_keys_list(self) -> List[str]:
        """Return deduplicated Keepa keys, always including primary key."""
        keys: List[str] = []
        seen = set()

        for raw in (self.keepa_api_keys or "").split(","):
            key = raw.strip()
            if key and key not in seen:
                seen.add(key)
                keys.append(key)

        primary = (self.keepa_api_key or "").strip()
        if primary and primary not in seen:
            keys.append(primary)

        # Keep at least one value for downstream client construction.
        return keys if keys else [self.keepa_api_key]

    @property
    def keepa_import_api_keys_list(self) -> List[str]:
        """Dedicated Keepa Import File keys, or [] when not configured.

        Returns an empty list (not the full pool) when ``keepa_import_api_keys``
        is unset, so callers can explicitly fall back to the full key pool.
        """
        keys: List[str] = []
        seen = set()
        for raw in (self.keepa_import_api_keys or "").split(","):
            key = raw.strip()
            if key and key not in seen:
                seen.add(key)
                keys.append(key)
        return keys

    # Supabase Configuration
    supabase_url: str
    supabase_key: str
    # PostgREST read timeout (seconds); large reports need more than the library default (5s).
    supabase_postgrest_timeout_seconds: int = 180
    
    # Email Configuration
    email_smtp_host: str = "smtp.gmail.com"
    email_smtp_port: int = 587
    email_from: str  # Bare mailbox only, e.g. user@gmail.com (not "Name <addr>")
    email_from_name: str = "Keepa Alert Service"  # Display name shown in the From header
    email_password: str
    email_to: str  # Can be comma-separated for multiple recipients
    
    # Application Configuration
    environment: str = "development"
    api_v1_str: str = "/api/v1"

    # Optional: HTTPS URL to the Windows desktop installer (.exe). Exposed via
    # GET /api/v1/public/client-config so the navbar download link works without
    # rebuilding the frontend (set on Render/host env as DESKTOP_APP_DOWNLOAD_URL).
    desktop_app_download_url: str = ""
    
    # CORS Configuration
    # CORS_ORIGINS may be overridden on the host (Render env var). The canonical
    # production frontend origins in ``_ALWAYS_ALLOWED_CORS_ORIGINS`` below are
    # appended in ``cors_origins_list`` so the live UI keeps working even if the
    # env var is missing or stale.
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    
    # Scheduler Configuration
    scheduler_hour: int = 2  # Default: 2 AM
    scheduler_minute: int = 0
    # Uploaded-report runs use the latest file regardless of upload date/timezone.
    # This guard prevents accidentally running against very old files.
    scheduler_uploaded_report_max_age_days: int = 7

    # CLI chat (OpenAI + Supabase session memory); optional until OPENAI_API_KEY is set
    openai_api_key: str = ""
    cli_chat_model: str = "gpt-4o-mini"
    cli_chat_history_limit: int = 30

    # Maintenance mode controls
    maintenance_mode: bool = False
    maintenance_message: str = "App is currently under maintenance. Please try again later."
    maintenance_allowlist_emails: str = ""

    # Comma-separated emails that skip TOTP MFA (password-only sign-in for shared stations).
    mfa_exempt_emails: str = "warehouse1@metroshoewarehouse.com,hello@warehouserepublic.com"

    # Report: comma-separated substrings matched case-insensitively (after removing
    # spaces/punctuation) against resolved seller display text. Rows for matching
    # sellers are omitted from off-price Excel/CSV. Default drops MetroShoe variants.
    # Set empty to disable: REPORT_EXCLUDED_SELLER_SUBSTRINGS=
    report_excluded_seller_substrings: str = "metroshoe"
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Convert CORS origins string to an explicit allowlist.

        We refuse the wildcard ``*`` here because the API is mounted with
        ``allow_credentials=True``; combining the two would let any origin make
        authenticated cross-origin calls and is forbidden by the CORS spec.
        Any ``*`` token in ``CORS_ORIGINS`` is dropped with a warning.

        The canonical production frontend origins are always appended so a
        missing/stale ``CORS_ORIGINS`` env var on the host does not break the
        live UI.
        """
        import logging

        logger = logging.getLogger(__name__)
        raw_origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        safe_origins = [origin for origin in raw_origins if origin != "*"]
        if len(safe_origins) != len(raw_origins):
            logger.warning(
                "CORS_ORIGINS contained '*'; ignoring because allow_credentials=True. "
                "Set explicit origins like https://your-frontend.example.com."
            )
        seen = {origin for origin in safe_origins}
        for origin in _ALWAYS_ALLOWED_CORS_ORIGINS:
            if origin not in seen:
                safe_origins.append(origin)
                seen.add(origin)
        return safe_origins

    @property
    def report_excluded_seller_pattern_list(self) -> List[str]:
        """Non-empty substring patterns for seller exclusion in reports."""
        raw = (self.report_excluded_seller_substrings or "").strip()
        if not raw:
            return []
        return [p.strip() for p in raw.split(",") if p.strip()]

    @property
    def maintenance_allowlist_emails_list(self) -> List[str]:
        """Normalized allowlist emails that bypass maintenance mode."""
        raw = (self.maintenance_allowlist_emails or "").strip()
        if not raw:
            return []
        return [email.strip().lower() for email in raw.split(",") if email.strip()]

    @property
    def mfa_exempt_emails_list(self) -> List[str]:
        """Normalized emails that skip TOTP MFA enrollment and verification."""
        raw = (self.mfa_exempt_emails or "").strip()
        if not raw:
            return []
        return [email.strip().lower() for email in raw.split(",") if email.strip()]

    class Config:
        # Use absolute path to .env file relative to backend directory
        # Falls back to ".env" in current directory if backend/.env doesn't exist
        env_file = str(ENV_FILE) if ENV_FILE.exists() else ".env"
        case_sensitive = False


# Global settings instance
settings = Settings()

