"""FastAPI application entry point."""
from fastapi import Depends, FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from slowapi.errors import RateLimitExceeded
from app.config import settings
from app.database import init_db
from app.api import auth, jobs, batches, reports, upcs, scheduler, tools, quick_access, dashboard, map, notifications, sellers, email_recipients, cli_chat, public, feedback, tracking_scanner, warehouse_products
from app.scheduler import setup_scheduler, start_scheduler, shutdown_scheduler
from app.dependencies import require_app_access
from app.maintenance import get_maintenance_state
from app.middleware.rate_limiter import limiter, log_rate_limit_exceeded, RATE_LIMIT_ERROR_MESSAGE
import logging
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Field names whose values must never be written to logs even on validation failures.
# Matched case-insensitively against the *last* path segment of each error location.
_SENSITIVE_FIELD_NAMES = frozenset({
    "password",
    "current_password",
    "new_password",
    "old_password",
    "confirm_password",
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "jwt",
    "authorization",
    "api_key",
    "apikey",
    "secret",
    "client_secret",
    "private_key",
    "credentials",
    "otp",
    "code",
})

# Maximum characters of a single string value to keep in a logged body.
_MAX_LOGGED_STRING_LEN = 256


def _redact_for_logging(value, key: str | None = None):
    """Return a copy of ``value`` with sensitive fields masked and large strings truncated.

    Used only by the validation error logger so unexpected payloads (which can include
    passwords or tokens) never end up in application logs in plaintext.
    """
    if key is not None and key.lower() in _SENSITIVE_FIELD_NAMES:
        return "***REDACTED***"
    if isinstance(value, dict):
        # Pydantic validation error items carry the offending value under ``input`` and
        # the field path under ``loc``; redact the input when the field name at the tail
        # of the path is sensitive, regardless of the input's type.
        loc = value.get("loc") if "input" in value else None
        sensitive_loc = (
            isinstance(loc, (list, tuple))
            and loc
            and isinstance(loc[-1], str)
            and loc[-1].lower() in _SENSITIVE_FIELD_NAMES
        )
        result = {}
        for k, v in value.items():
            if sensitive_loc and k == "input":
                result[k] = "***REDACTED***"
            else:
                result[k] = _redact_for_logging(v, k)
        return result
    if isinstance(value, list):
        return [_redact_for_logging(item, key) for item in value]
    if isinstance(value, str) and len(value) > _MAX_LOGGED_STRING_LEN:
        return f"{value[:_MAX_LOGGED_STRING_LEN]}...<truncated {len(value) - _MAX_LOGGED_STRING_LEN} chars>"
    return value

# Initialize FastAPI app
app = FastAPI(
    title="MSW Overwatch API",
    description="API for MSW Overwatch productivity platform",
    version="2.0.0",
)

# Attach rate limiter to app state
app.state.limiter = limiter

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom exception handler for validation errors
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle validation errors with detailed logging for debugging.

    Request bodies and Pydantic error payloads can contain user-supplied passwords,
    tokens, and other secrets. We mask known-sensitive field names and truncate
    long string values before they reach the log pipeline.
    """
    errors = exc.errors()

    redacted_errors = _redact_for_logging(errors)

    body_repr: object = "<unavailable>"
    try:
        body = await request.body()
        if body:
            try:
                body_json = json.loads(body)
                body_repr = _redact_for_logging(body_json)
            except json.JSONDecodeError:
                body_repr = f"<non-json body, {len(body)} bytes>"
        else:
            body_repr = "<empty>"
    except Exception as e:
        body_repr = f"<could not read body: {e}>"

    logger.error(
        "Validation error for %s %s | body=%s | errors=%s",
        request.method,
        request.url.path,
        json.dumps(body_repr, default=str),
        json.dumps(redacted_errors, default=str),
    )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": errors}
    )


# Custom exception handler for rate limit exceeded
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    """Handle rate limit exceeded errors with user-friendly messages."""
    # Log the rate limit violation
    log_rate_limit_exceeded(request)

    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content=RATE_LIMIT_ERROR_MESSAGE,
        headers={
            "Retry-After": str(exc.retry_after) if hasattr(exc, 'retry_after') else "60"
        }
    )


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    logger.info("Initializing database connection...")
    init_db()
    logger.info("Setting up scheduler...")
    # Try to load scheduler settings from database for DNK, CLK, OBZ, REF, BOR, SFF, TEV, and CHA
    try:
        from app.database import get_supabase
        db = get_supabase()

        for category in ("dnk", "clk", "obz", "ref", "bor", "sff", "tev", "cha"):
            settings_response = (
                db.table("scheduler_settings").select("*").eq("category", category).execute()
            )
            if settings_response.data:
                category_settings = settings_response.data[0]
                if category_settings.get("enabled", True):
                    setup_scheduler(
                        timezone_str=category_settings.get("timezone", "America/Chicago"),
                        hour=category_settings.get("hour", 6),
                        minute=category_settings.get("minute", 0),
                        category=category,
                        run_mode=category_settings.get("run_mode", "daily"),
                        custom_days=category_settings.get("custom_days", []),
                        anchor_date=category_settings.get("anchor_date"),
                    )
                else:
                    logger.info(f"{category.upper()} scheduler is disabled, skipping setup")
            else:
                setup_scheduler(category=category)  # Use category defaults
    except Exception as e:
        logger.warning(f"Failed to load scheduler settings, using defaults: {e}")
        setup_scheduler(category='dnk')  # Use DNK defaults
        setup_scheduler(category='clk')  # Use CLK defaults
        setup_scheduler(category='obz')  # Use OBZ defaults
        setup_scheduler(category='ref')  # Use REF defaults
        setup_scheduler(category='bor')  # Use BOR defaults
        setup_scheduler(category='sff')  # Use SFF defaults
        setup_scheduler(category='tev')  # Use TEV defaults
        setup_scheduler(category='cha')  # Use CHA defaults
    start_scheduler()
    logger.info("Application startup complete")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("Shutting down scheduler...")
    shutdown_scheduler()
    logger.info("Application shutdown")


@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "MSW Overwatch API", "version": "2.0.0"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get(f"{settings.api_v1_str}/system/maintenance-status")
async def maintenance_status():
    """Public maintenance status for frontend routing."""
    return get_maintenance_state()


# Include API routers
app.include_router(public.router, prefix=settings.api_v1_str, tags=["public"])
app.include_router(auth.router, prefix=f"{settings.api_v1_str}/auth", tags=["auth"])
app.include_router(jobs.router, prefix=settings.api_v1_str, tags=["jobs"], dependencies=[Depends(require_app_access)])
app.include_router(batches.router, prefix=settings.api_v1_str, tags=["batches"], dependencies=[Depends(require_app_access)])
app.include_router(reports.router, prefix=settings.api_v1_str, tags=["reports"], dependencies=[Depends(require_app_access)])
app.include_router(upcs.router, prefix=settings.api_v1_str, tags=["upcs"], dependencies=[Depends(require_app_access)])
app.include_router(map.router, prefix=settings.api_v1_str, tags=["map"], dependencies=[Depends(require_app_access)])
app.include_router(scheduler.router, prefix=settings.api_v1_str, tags=["scheduler"], dependencies=[Depends(require_app_access)])
app.include_router(tools.router, prefix=settings.api_v1_str, tags=["tools"], dependencies=[Depends(require_app_access)])
app.include_router(quick_access.router, prefix=settings.api_v1_str, tags=["quick-access"], dependencies=[Depends(require_app_access)])
app.include_router(dashboard.router, prefix=settings.api_v1_str, tags=["dashboard"], dependencies=[Depends(require_app_access)])
app.include_router(notifications.router, prefix=settings.api_v1_str, tags=["notifications"], dependencies=[Depends(require_app_access)])
app.include_router(sellers.router, prefix=settings.api_v1_str, tags=["sellers"], dependencies=[Depends(require_app_access)])
app.include_router(email_recipients.router, prefix=settings.api_v1_str, tags=["email-recipients"], dependencies=[Depends(require_app_access)])
app.include_router(cli_chat.router, prefix=settings.api_v1_str, tags=["cli-chat"], dependencies=[Depends(require_app_access)])
app.include_router(feedback.router, prefix=settings.api_v1_str, tags=["feedback"], dependencies=[Depends(require_app_access)])
app.include_router(tracking_scanner.router, prefix=settings.api_v1_str, tags=["tracking-scanner"], dependencies=[Depends(require_app_access)])
app.include_router(warehouse_products.router, prefix=settings.api_v1_str, tags=["warehouse-products"], dependencies=[Depends(require_app_access)])

