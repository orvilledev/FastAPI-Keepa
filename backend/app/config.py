"""Application configuration settings."""
from pydantic_settings import BaseSettings
from typing import List
from pathlib import Path
import os

# Find .env file relative to backend directory, not current working directory
# This ensures .env is found regardless of where the command is run from
BACKEND_DIR = Path(__file__).parent.parent
ENV_FILE = BACKEND_DIR / ".env"

class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Keepa API Configuration
    keepa_api_key: str
    keepa_api_keys: str = ""
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
    keepa_cancel_check_every_items: int = 10
    batch_inter_delay_seconds: float = 0.0
    
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
    
    # CORS Configuration
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    
    # Scheduler Configuration
    scheduler_hour: int = 2  # Default: 2 AM
    scheduler_minute: int = 0

    # Report: comma-separated substrings matched case-insensitively (after removing
    # spaces/punctuation) against resolved seller display text. Rows for matching
    # sellers are omitted from off-price Excel/CSV. Default drops MetroShoe variants.
    # Set empty to disable: REPORT_EXCLUDED_SELLER_SUBSTRINGS=
    report_excluded_seller_substrings: str = "metroshoe"
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Convert CORS origins string to list."""
        return [origin.strip() for origin in self.cors_origins.split(",")]

    @property
    def report_excluded_seller_pattern_list(self) -> List[str]:
        """Non-empty substring patterns for seller exclusion in reports."""
        raw = (self.report_excluded_seller_substrings or "").strip()
        if not raw:
            return []
        return [p.strip() for p in raw.split(",") if p.strip()]
    
    class Config:
        # Use absolute path to .env file relative to backend directory
        # Falls back to ".env" in current directory if backend/.env doesn't exist
        env_file = str(ENV_FILE) if ENV_FILE.exists() else ".env"
        case_sensitive = False


# Global settings instance
settings = Settings()

