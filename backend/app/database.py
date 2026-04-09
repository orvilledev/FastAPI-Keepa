"""Supabase database client setup."""
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions
from app.config import settings
import logging

logger = logging.getLogger(__name__)

# Global Supabase client
supabase: Client | None = None


def get_supabase() -> Client:
    """Get or create Supabase client instance."""
    global supabase
    if supabase is None:
        try:
            supabase = create_client(
                settings.supabase_url,
                settings.supabase_key,
                options=ClientOptions(
                    postgrest_client_timeout=settings.supabase_postgrest_timeout_seconds,
                ),
            )
            logger.info("Supabase client initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {e}")
            raise
    return supabase


def init_db():
    """Initialize database connection."""
    return get_supabase()

