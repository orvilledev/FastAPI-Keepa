"""Sentry error tracking configuration."""
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
import logging
import os


def init_sentry():
    """
    Initialize Sentry error tracking.

    This should be called once at application startup.
    Sentry will automatically capture unhandled exceptions,
    errors, and performance data.
    """
    # Get configuration from environment
    sentry_dsn = os.getenv("SENTRY_DSN")
    environment = os.getenv("ENVIRONMENT", "development")

    # Only initialize if DSN is provided
    if not sentry_dsn:
        logging.info("Sentry DSN not configured. Error tracking disabled.")
        return

    # Configure Sentry
    sentry_sdk.init(
        dsn=sentry_dsn,
        environment=environment,

        # Performance Monitoring
        traces_sample_rate=0.1 if environment == "production" else 1.0,

        # Error Sampling
        sample_rate=1.0,  # Capture 100% of errors

        # Integrations
        integrations=[
            FastApiIntegration(
                transaction_style="endpoint",  # Group by endpoint
                failed_request_status_codes=[500, 599],  # Only track 5xx errors
            ),
            LoggingIntegration(
                level=logging.INFO,  # Capture info and above
                event_level=logging.ERROR  # Send errors to Sentry
            ),
        ],

        # Additional options
        attach_stacktrace=True,
        send_default_pii=False,  # Don't send personally identifiable info

        # Release tracking (optional - set via CI/CD)
        release=os.getenv("SENTRY_RELEASE", None),

        # Configure which exceptions to ignore
        ignore_errors=[
            KeyboardInterrupt,
        ],

        # Before send hook to filter/modify events
        before_send=before_send_filter,
    )

    logging.info(f"Sentry initialized for environment: {environment}")


def before_send_filter(event, hint):
    """
    Filter or modify events before sending to Sentry.

    This allows you to:
    - Remove sensitive data
    - Add custom context
    - Filter out specific errors
    - Modify event data

    Args:
        event: The error event dictionary
        hint: Additional context about the error

    Returns:
        Modified event or None to drop the event
    """
    # Example: Don't send 404 errors
    if event.get("level") == "info":
        return None

    # Example: Remove sensitive headers
    if "request" in event and "headers" in event["request"]:
        sensitive_headers = ["Authorization", "Cookie", "X-API-Key"]
        for header in sensitive_headers:
            if header in event["request"]["headers"]:
                event["request"]["headers"][header] = "[Filtered]"

    # Example: Add custom tags
    event.setdefault("tags", {})
    event["tags"]["processed_by"] = "before_send_filter"

    return event


def capture_exception(exception: Exception, context: dict = None):
    """
    Manually capture an exception with optional context.

    Args:
        exception: The exception to capture
        context: Additional context to include

    Example:
        try:
            risky_operation()
        except Exception as e:
            capture_exception(e, {
                "user_id": user.id,
                "operation": "data_processing"
            })
    """
    if context:
        with sentry_sdk.push_scope() as scope:
            for key, value in context.items():
                scope.set_tag(key, value)
            sentry_sdk.capture_exception(exception)
    else:
        sentry_sdk.capture_exception(exception)


def capture_message(message: str, level: str = "info", context: dict = None):
    """
    Capture a custom message in Sentry.

    Args:
        message: The message to log
        level: Severity level (debug, info, warning, error, fatal)
        context: Additional context

    Example:
        capture_message(
            "Unusual activity detected",
            level="warning",
            context={"user_id": user.id}
        )
    """
    if context:
        with sentry_sdk.push_scope() as scope:
            for key, value in context.items():
                scope.set_tag(key, value)
            sentry_sdk.capture_message(message, level=level)
    else:
        sentry_sdk.capture_message(message, level=level)


def set_user_context(user_id: str, email: str = None, username: str = None):
    """
    Set user context for error tracking.

    This helps identify which user experienced an error.

    Args:
        user_id: Unique user identifier
        email: User email (optional)
        username: Display name (optional)
    """
    sentry_sdk.set_user({
        "id": user_id,
        "email": email,
        "username": username,
    })


def add_breadcrumb(message: str, category: str = "default", level: str = "info", data: dict = None):
    """
    Add a breadcrumb to the current scope.

    Breadcrumbs are a trail of events that led to an error.

    Args:
        message: Breadcrumb message
        category: Category (e.g., "database", "api", "auth")
        level: Severity level
        data: Additional data

    Example:
        add_breadcrumb(
            "User logged in",
            category="auth",
            level="info",
            data={"user_id": user.id}
        )
    """
    sentry_sdk.add_breadcrumb(
        message=message,
        category=category,
        level=level,
        data=data or {}
    )
