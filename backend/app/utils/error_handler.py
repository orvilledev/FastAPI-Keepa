"""Error handling utilities for API endpoints."""
from functools import wraps
from fastapi import HTTPException
import logging

logger = logging.getLogger(__name__)


def handle_api_errors(operation_name: str):
    """
    Decorator to handle common API errors.
    
    Args:
        operation_name: Name of the operation for error messages (e.g., "create job")
    
    Usage:
        @handle_api_errors("create job")
        async def create_job(...):
            ...
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except HTTPException:
                # Re-raise HTTP exceptions as-is
                raise
            except Exception as e:
                logger.error(f"Failed to {operation_name}: {e}", exc_info=True)
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to {operation_name}: {str(e)}"
                )
        return wrapper
    return decorator

