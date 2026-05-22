"""Error handling utilities for API endpoints."""
from functools import wraps
from fastapi import HTTPException
import inspect
import logging

logger = logging.getLogger(__name__)


def handle_api_errors(operation_name: str):
    """
    Decorator to handle common API errors for both sync and async route functions.

    Usage:
        @handle_api_errors("create job")
        def create_job(...):
            ...

        @handle_api_errors("stream data")
        async def stream_data(...):
            ...
    """
    def decorator(func):
        if inspect.iscoroutinefunction(func):
            @wraps(func)
            async def async_wrapper(*args, **kwargs):
                try:
                    return await func(*args, **kwargs)
                except HTTPException:
                    raise
                except Exception as e:
                    logger.error(f"Failed to {operation_name}: {e}", exc_info=True)
                    raise HTTPException(
                        status_code=500,
                        detail=f"Failed to {operation_name}: {str(e)}"
                    )
            return async_wrapper
        else:
            @wraps(func)
            def sync_wrapper(*args, **kwargs):
                try:
                    return func(*args, **kwargs)
                except HTTPException:
                    raise
                except Exception as e:
                    logger.error(f"Failed to {operation_name}: {e}", exc_info=True)
                    raise HTTPException(
                        status_code=500,
                        detail=f"Failed to {operation_name}: {str(e)}"
                    )
            return sync_wrapper
    return decorator
