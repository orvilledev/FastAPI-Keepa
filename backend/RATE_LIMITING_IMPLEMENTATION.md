# Rate Limiting Implementation Guide

This document provides instructions for applying rate limits to all API endpoints in the Metro Hub application.

## Overview

Rate limiting has been configured using SlowAPI with the following setup:
- ✅ Dependencies added to `requirements.txt`
- ✅ Rate limiter middleware created in `app/middleware/rate_limiter.py`
- ✅ Integrated with FastAPI in `app/main.py`
- ✅ Custom 429 error handler configured
- ✅ Rate limit constants defined in `RateLimits` class

## How to Apply Rate Limits

To apply rate limits to an endpoint, import the limiter and use the `@limiter.limit()` decorator:

```python
from app.middleware.rate_limiter import limiter, RateLimits
from fastapi import Request

@router.post("/endpoint")
@limiter.limit(RateLimits.WRITE_OPERATIONS)
async def my_endpoint(request: Request, ...):
    # Your endpoint logic
    pass
```

**Important**: The `Request` parameter must be included in the function signature for the rate limiter to work.

## Recommended Rate Limits by Endpoint

### Authentication Endpoints (`app/api/auth.py`)

```python
from app.middleware.rate_limiter import limiter, RateLimits
from fastapi import Request

# Note: Supabase handles auth, but these are for profile management

@router.get("/me")
@limiter.limit(RateLimits.READ_OPERATIONS)
async def get_current_user_info(
    request: Request,  # ADD THIS
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    ...

@router.patch("/me/display-name")
@limiter.limit(RateLimits.WRITE_OPERATIONS)
async def update_display_name(
    request: Request,  # ADD THIS
    display_name_data: DisplayNameUpdate = Body(...),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    ...

@router.get("/users")
@limiter.limit(RateLimits.READ_OPERATIONS)
async def get_all_users(
    request: Request,  # ADD THIS
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    ...

@router.put("/users/{user_id}/keepa-access")
@limiter.limit(RateLimits.ADMIN_OPERATIONS)
async def update_user_keepa_access(
    request: Request,  # ADD THIS
    user_id: str,
    has_keepa_access: bool = Body(..., embed=True),
    current_user: dict = Depends(get_superadmin_user),
    db: Client = Depends(get_supabase)
):
    ...
```

### Job Management Endpoints (`app/api/jobs.py`)

```python
from app.middleware.rate_limiter import limiter, RateLimits
from fastapi import Request

@router.post("/jobs", response_model=BatchJobResponse, status_code=201)
@limiter.limit(RateLimits.JOB_CREATE)  # 10/hour - expensive operation
async def create_job(
    request: Request,  # ADD THIS
    job_data: BatchJobCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    ...

@router.get("/jobs", response_model=List[BatchJobResponse])
@limiter.limit(RateLimits.READ_OPERATIONS)
async def list_jobs(
    request: Request,  # ADD THIS
    limit: int = 15,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    ...

@router.post("/jobs/{job_id}/trigger")
@limiter.limit(RateLimits.JOB_TRIGGER)  # 20/hour
async def trigger_job(
    request: Request,  # ADD THIS
    job_id: UUID,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    ...

@router.delete("/jobs/{job_id}")
@limiter.limit(RateLimits.WRITE_OPERATIONS)
async def delete_job(
    request: Request,  # ADD THIS
    job: dict = Depends(verify_job_access),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    ...
```

### Batch Endpoints (`app/api/batches.py`)

```python
@router.post("/batches/{batch_id}/stop")
@limiter.limit(RateLimits.BATCH_STOP)  # 30/minute
async def stop_batch(
    request: Request,  # ADD THIS
    batch_id: UUID,
    current_user: dict = Depends(get_admin_user),
    db: Client = Depends(get_supabase)
):
    ...
```

### Notes Endpoints (`app/api/notes.py`)

```python
from app.middleware.rate_limiter import limiter, RateLimits
from fastapi import Request

@router.post("/notes", response_model=NoteResponse, status_code=201)
@limiter.limit(RateLimits.NOTES_WRITE)  # 50/minute
async def create_note(
    request: Request,  # ADD THIS
    note: NoteCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    ...

@router.get("/notes", response_model=dict)
@limiter.limit(RateLimits.NOTES_READ)  # 100/minute
async def list_notes(
    request: Request,  # ADD THIS
    page: int = Query(0, ge=0, description="Page number (0-indexed)"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    search: Optional[str] = Query(None, description="Search term for title or content"),
    category: Optional[str] = Query(None, description="Filter by category"),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    ...

@router.put("/notes/{note_id}", response_model=NoteResponse)
@limiter.limit(RateLimits.NOTES_WRITE)
async def update_note(
    request: Request,  # ADD THIS
    note_id: UUID,
    note: NoteUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    ...

@router.delete("/notes/{note_id}", status_code=204)
@limiter.limit(RateLimits.NOTES_WRITE)
async def delete_note(
    request: Request,  # ADD THIS
    note_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    ...
```

### Tasks Endpoints (`app/api/tasks.py`)

```python
from app.middleware.rate_limiter import limiter, RateLimits

@router.get("/tasks")
@limiter.limit(RateLimits.TASKS_READ)  # 100/minute
async def list_tasks(request: Request, ...):
    ...

@router.post("/tasks")
@limiter.limit(RateLimits.TASKS_WRITE)  # 50/minute
async def create_task(request: Request, ...):
    ...

@router.put("/tasks/{task_id}")
@limiter.limit(RateLimits.TASKS_WRITE)
async def update_task(request: Request, ...):
    ...

@router.delete("/tasks/{task_id}")
@limiter.limit(RateLimits.TASKS_WRITE)
async def delete_task(request: Request, ...):
    ...
```

### File Upload Endpoints (`app/api/task_attachments.py`)

```python
from app.middleware.rate_limiter import limiter, RateLimits

@router.post("/tasks/{task_id}/attachments")
@limiter.limit(RateLimits.FILE_UPLOAD)  # 20/hour - prevent storage abuse
async def upload_attachment(
    request: Request,  # ADD THIS
    task_id: UUID,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    ...
```

### UPC Management Endpoints (`app/api/upcs.py`)

```python
from app.middleware.rate_limiter import limiter, RateLimits

@router.get("/upcs")
@limiter.limit(RateLimits.READ_OPERATIONS)
async def get_upcs(request: Request, ...):
    ...

@router.post("/upcs")
@limiter.limit(RateLimits.UPC_CRUD)  # 60/minute
async def create_upc(request: Request, ...):
    ...

@router.post("/upcs/upload")
@limiter.limit(RateLimits.UPC_UPLOAD)  # 10/hour - bulk operation
async def upload_upcs(request: Request, ...):
    ...

@router.delete("/upcs/{upc_id}")
@limiter.limit(RateLimits.UPC_CRUD)
async def delete_upc(request: Request, ...):
    ...
```

### Scheduler Endpoints (`app/api/scheduler.py`)

```python
from app/middleware.rate_limiter import limiter, RateLimits

@router.put("/scheduler/settings")
@limiter.limit(RateLimits.SCHEDULER_UPDATE)  # 10/minute
async def update_scheduler_settings(request: Request, ...):
    ...

@router.get("/scheduler/status")
@limiter.limit(RateLimits.READ_OPERATIONS)
async def get_scheduler_status(request: Request, ...):
    ...
```

### Notifications Endpoints (`app/api/notifications.py`)

```python
from app.middleware.rate_limiter import limiter, RateLimits

@router.get("/notifications")
@limiter.limit(RateLimits.NOTIFICATIONS_READ)  # 120/minute - high limit for real-time
async def get_notifications(request: Request, ...):
    ...

@router.put("/notifications/{notification_id}/read")
@limiter.limit(RateLimits.WRITE_OPERATIONS)
async def mark_notification_read(request: Request, ...):
    ...
```

### Tools Endpoints (`app/api/tools.py`)

```python
from app.middleware.rate_limiter import limiter, RateLimits

@router.get("/tools/public")
@limiter.limit(RateLimits.PUBLIC_READ)  # 60/minute
async def get_public_tools(request: Request, ...):
    ...

@router.post("/tools/public")
@limiter.limit(RateLimits.ADMIN_OPERATIONS)  # Admin only
async def create_public_tool(request: Request, ...):
    ...
```

## Rate Limit Constants

Available rate limit constants from `RateLimits` class:

```python
# Authentication (strict to prevent brute force)
AUTH_LOGIN = "5/minute"
AUTH_SIGNUP = "3/minute"
AUTH_PASSWORD_RESET = "3/minute"

# Job operations (expensive Keepa API calls)
JOB_CREATE = "10/hour"
JOB_TRIGGER = "20/hour"
BATCH_STOP = "30/minute"

# File uploads (prevent storage abuse)
FILE_UPLOAD = "20/hour"
FILE_UPLOAD_BURST = "5/minute"

# CRUD operations
READ_OPERATIONS = "100/minute"
WRITE_OPERATIONS = "50/minute"

# Admin operations
ADMIN_OPERATIONS = "120/minute"

# Public endpoints
PUBLIC_READ = "60/minute"

# Notes and tasks
NOTES_READ = "100/minute"
NOTES_WRITE = "50/minute"
TASKS_READ = "100/minute"
TASKS_WRITE = "50/minute"

# UPC management
UPC_UPLOAD = "10/hour"
UPC_CRUD = "60/minute"

# Notifications (high limit for real-time)
NOTIFICATIONS_READ = "120/minute"

# Scheduler
SCHEDULER_UPDATE = "10/minute"
```

## Testing Rate Limits

To test rate limiting:

1. **Install slowapi** (already done):
   ```bash
   pip install slowapi==0.1.9
   ```

2. **Test an endpoint** by making rapid requests:
   ```bash
   # Using curl
   for i in {1..10}; do curl http://localhost:8000/api/v1/notes; done
   ```

3. **Check for 429 response** after exceeding limit:
   ```json
   {
     "error": "rate_limit_exceeded",
     "message": "Too many requests. Please slow down and try again later.",
     "details": "Rate limit has been exceeded for this endpoint..."
   }
   ```

4. **Verify rate limit headers** in response:
   - `X-RateLimit-Limit`: Maximum requests allowed
   - `X-RateLimit-Remaining`: Remaining requests
   - `X-RateLimit-Reset`: Time when limit resets
   - `Retry-After`: Seconds to wait before retrying

## Production Considerations

### Redis Backend (Recommended for Production)

For production deployment with multiple workers, use Redis instead of in-memory storage:

1. **Install Redis client**:
   ```bash
   pip install redis
   ```

2. **Update rate limiter configuration** in `app/middleware/rate_limiter.py`:
   ```python
   from app.config import settings

   limiter = Limiter(
       key_func=get_rate_limit_key,
       storage_uri=settings.redis_url,  # e.g., "redis://localhost:6379"
       ...
   )
   ```

3. **Add Redis URL to config** in `app/config.py`:
   ```python
   class Settings(BaseSettings):
       ...
       redis_url: str = "redis://localhost:6379"
   ```

4. **Add to environment variables**:
   ```env
   REDIS_URL=redis://your-redis-host:6379
   ```

### Monitoring

Rate limit violations are automatically logged:
```
WARNING - Rate limit exceeded - User: user123, IP: 192.168.1.1, Endpoint: /api/v1/notes, Method: POST
```

Set up alerts for repeated violations to detect potential abuse.

### Adjusting Limits

To adjust rate limits for specific use cases:

1. Update constants in `app/middleware/rate_limiter.py`
2. Or apply custom limits directly to endpoints:
   ```python
   @router.post("/custom-endpoint")
   @limiter.limit("15/minute")  # Custom limit
   async def custom_endpoint(request: Request, ...):
       ...
   ```

## Next Steps

1. ✅ Apply rate limits to all critical endpoints (auth, job creation, file uploads)
2. ✅ Apply rate limits to standard CRUD endpoints
3. ⏳ Set up Redis for production (optional but recommended)
4. ⏳ Monitor rate limit logs and adjust as needed
5. ⏳ Update frontend to handle 429 errors gracefully

## Frontend Integration

See `UPDATE_FRONTEND_FOR_RATE_LIMITING.md` for instructions on handling rate limit errors in the frontend.
