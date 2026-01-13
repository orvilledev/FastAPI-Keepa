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
    keepa_api_url: str = "https://api.keepa.com/"
    
    # Supabase Configuration
    supabase_url: str
    supabase_key: str
    
    # Email Configuration
    email_smtp_host: str = "smtp.gmail.com"
    email_smtp_port: int = 587
    email_from: str
    email_from_name: str = "Keepa Alert Service"  # Display name for emails
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
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Convert CORS origins string to list."""
        return [origin.strip() for origin in self.cors_origins.split(",")]
    
    class Config:
        # Use absolute path to .env file relative to backend directory
        # Falls back to ".env" in current directory if backend/.env doesn't exist
        env_file = str(ENV_FILE) if ENV_FILE.exists() else ".env"
        case_sensitive = False


# Global settings instance
settings = Settings()

