"""Rate limiting configuration for the Metro Hub API.

This module configures rate limiting using SlowAPI to protect against:
- Brute force attacks on authentication endpoints
- API abuse and DDoS attacks
- Resource exhaustion from expensive operations
- Storage abuse from file uploads

Rate limits are applied per-IP for unauthenticated requests and per-user for authenticated requests.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request
import logging

logger = logging.getLogger(__name__)


def get_rate_limit_key(request: Request) -> str:
    """
    Generate rate limit key based on user authentication status.

    For authenticated requests: Uses user ID from token
    For unauthenticated requests: Uses IP address

    This provides per-user rate limiting for logged-in users and
    per-IP rate limiting for anonymous users.
    """
    # Try to get user ID from request state (set by auth dependency)
    user_id = getattr(request.state, "user_id", None)

    if user_id:
        # Authenticated user - rate limit by user ID
        return f"user:{user_id}"

    # Unauthenticated - rate limit by IP address
    return f"ip:{get_remote_address(request)}"


# Initialize rate limiter
limiter = Limiter(
    key_func=get_rate_limit_key,
    default_limits=["100/minute"],  # Default limit for all endpoints
    storage_uri="memory://",  # Use in-memory storage (for production, consider Redis)
    strategy="fixed-window",  # Fixed window counting strategy
    headers_enabled=True,  # Include rate limit headers in responses
)


# Rate limit constants for different endpoint types
class RateLimits:
    """Rate limit constants organized by endpoint category."""

    # Authentication endpoints (strict limits to prevent brute force)
    AUTH_LOGIN = "5/minute"  # Login attempts
    AUTH_SIGNUP = "3/minute"  # Registration attempts
    AUTH_PASSWORD_RESET = "3/minute"  # Password reset requests

    # Job creation and management (limit expensive Keepa API operations)
    JOB_CREATE = "10/hour"  # Creating new jobs
    JOB_TRIGGER = "20/hour"  # Manually triggering jobs
    BATCH_STOP = "30/minute"  # Stopping batches

    # File upload endpoints (prevent storage abuse)
    FILE_UPLOAD = "20/hour"  # File attachment uploads
    FILE_UPLOAD_BURST = "5/minute"  # Allow burst uploads

    # CRUD operations (standard limits)
    READ_OPERATIONS = "100/minute"  # GET requests
    WRITE_OPERATIONS = "50/minute"  # POST, PUT, PATCH, DELETE

    # Admin operations (higher limits for administrative users)
    ADMIN_OPERATIONS = "120/minute"  # Admin-only endpoints

    # Public endpoints
    PUBLIC_READ = "60/minute"  # Public tool browsing, etc.

    # Notes and tasks (user-specific data)
    NOTES_READ = "100/minute"
    NOTES_WRITE = "50/minute"
    TASKS_READ = "100/minute"
    TASKS_WRITE = "50/minute"

    # UPC management (moderate limits for bulk operations)
    UPC_UPLOAD = "10/hour"  # Bulk UPC uploads
    UPC_CRUD = "60/minute"  # Individual UPC operations

    # Notifications
    NOTIFICATIONS_READ = "120/minute"  # High limit for real-time checks

    # Scheduler operations
    SCHEDULER_UPDATE = "10/minute"  # Scheduler configuration changes


def log_rate_limit_exceeded(request: Request):
    """Log when rate limits are exceeded for monitoring purposes."""
    user_id = getattr(request.state, "user_id", "anonymous")
    ip_address = get_remote_address(request)
    endpoint = request.url.path

    logger.warning(
        f"Rate limit exceeded - User: {user_id}, IP: {ip_address}, "
        f"Endpoint: {endpoint}, Method: {request.method}"
    )


# Custom error message for rate limit exceeded
RATE_LIMIT_ERROR_MESSAGE = {
    "error": "rate_limit_exceeded",
    "message": "Too many requests. Please slow down and try again later.",
    "details": "Rate limit has been exceeded for this endpoint. "
              "Please wait a moment before making another request."
}
