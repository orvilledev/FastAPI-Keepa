# Sentry Error Tracking Setup Guide

## Overview

Sentry has been configured for comprehensive error tracking and performance monitoring in Metro Hub. This guide covers setup, configuration, and usage.

## What is Sentry?

Sentry is an error tracking and performance monitoring platform that helps you:
- Capture and analyze application errors
- Track performance metrics
- Monitor user experience
- Get real-time alerts for critical issues
- Debug production issues with detailed context

## Setup Instructions

### 1. Create a Sentry Account

1. Go to [sentry.io](https://sentry.io)
2. Sign up for a free account (10,000 events/month free)
3. Create a new project
4. Select **Python** as the platform
5. Select **FastAPI** as the framework
6. Copy your DSN (Data Source Name)

### 2. Configure Environment Variables

Add these variables to your `.env` file:

```bash
# Sentry Configuration
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
SENTRY_RELEASE=1.0.0  # Optional: Track releases
ENVIRONMENT=production  # or development, staging
```

Add to `.env.example`:

```bash
# Sentry Configuration (optional - for error tracking)
SENTRY_DSN=your_sentry_dsn_here
SENTRY_RELEASE=1.0.0
ENVIRONMENT=production
```

### 3. Integrate with FastAPI

Update `backend/app/main.py`:

```python
"""FastAPI application entry point."""
from fastapi import FastAPI
from app.utils.sentry_config import init_sentry
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Sentry BEFORE creating FastAPI app
init_sentry()

# Initialize FastAPI app
app = FastAPI(
    title="Metro API",
    description="API for Metro Hub productivity platform",
    version="1.0.0",
)

# ... rest of your app configuration
```

### 4. Install Dependencies

```bash
cd backend
pip install sentry-sdk[fastapi]==2.19.2
```

## Usage Examples

### Automatic Error Capture

Sentry automatically captures unhandled exceptions:

```python
@router.get("/example")
async def example_endpoint():
    # This error will automatically be sent to Sentry
    raise ValueError("Something went wrong!")
```

### Manual Error Capture

For handled exceptions you want to track:

```python
from app.utils.sentry_config import capture_exception

@router.post("/jobs")
async def create_job(job: JobCreate):
    try:
        result = process_job(job)
        return result
    except Exception as e:
        # Capture with additional context
        capture_exception(e, context={
            "job_id": job.id,
            "user_id": current_user["id"],
            "operation": "job_creation"
        })
        raise HTTPException(status_code=500, detail="Job creation failed")
```

### Capture Custom Messages

For logging important events:

```python
from app.utils.sentry_config import capture_message

@router.post("/scheduler/trigger")
async def trigger_scheduler():
    capture_message(
        "Manual scheduler trigger",
        level="info",
        context={
            "triggered_by": current_user["id"],
            "timestamp": datetime.now().isoformat()
        }
    )
    # ... trigger logic
```

### Set User Context

Associate errors with specific users:

```python
from app.utils.sentry_config import set_user_context
from app.dependencies import get_current_user

@router.get("/api/v1/auth/me")
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    # Set user context for all subsequent errors
    set_user_context(
        user_id=current_user["id"],
        email=current_user["email"],
        username=current_user.get("display_name")
    )

    return current_user
```

### Add Breadcrumbs

Create a trail of events leading to errors:

```python
from app.utils.sentry_config import add_breadcrumb

@router.post("/jobs")
async def create_job(job: JobCreate):
    add_breadcrumb("Starting job creation", category="jobs", level="info")

    # Validate job
    add_breadcrumb("Validating job data", category="jobs", data={"job_name": job.job_name})

    # Create job
    add_breadcrumb("Inserting job into database", category="database")

    # If error occurs, breadcrumbs will show in Sentry
    result = db.table("jobs").insert(job.dict()).execute()

    add_breadcrumb("Job created successfully", category="jobs", level="info")
    return result
```

## Configuration Options

### Environment-Specific Settings

The Sentry configuration automatically adjusts based on `ENVIRONMENT`:

**Development**:
- `traces_sample_rate=1.0` (100% of transactions)
- More verbose logging
- Errors logged to console

**Production**:
- `traces_sample_rate=0.1` (10% of transactions to save quota)
- Only critical errors logged
- PII filtering enabled

### Filtering Sensitive Data

Sensitive headers are automatically filtered in `before_send_filter`:
- Authorization tokens
- Cookies
- API keys
- Custom headers

To add more filters, edit `backend/app/utils/sentry_config.py`:

```python
def before_send_filter(event, hint):
    # Add custom filtering logic
    if "password" in str(event):
        return None  # Drop event

    return event
```

## Frontend Integration (React)

Install Sentry for React:

```bash
cd frontend
npm install @sentry/react
```

Configure in `frontend/src/main.tsx`:

```typescript
import * as Sentry from "@sentry/react";

if (import.meta.env.PROD) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}
```

Add to `frontend/.env.example`:

```bash
# Sentry Configuration (optional)
VITE_SENTRY_DSN=your_sentry_frontend_dsn_here
```

## Monitoring Best Practices

### 1. Set Up Alerts

In Sentry dashboard:
- Go to **Alerts** → **Create Alert**
- Set up email/Slack notifications for:
  - Critical errors (5xx responses)
  - High error rate (> 10 errors/minute)
  - Performance degradation

### 2. Monitor Key Metrics

Track these in Sentry:
- Error rate by endpoint
- Response time trends
- User-impacting errors
- Failed background jobs

### 3. Organize with Tags

Add custom tags to categorize errors:

```python
import sentry_sdk

with sentry_sdk.push_scope() as scope:
    scope.set_tag("feature", "keepa_integration")
    scope.set_tag("critical", "true")
    sentry_sdk.capture_exception(exception)
```

### 4. Create Releases

Track which version caused errors:

```bash
# In CI/CD pipeline
export SENTRY_RELEASE="metro-hub@$(git rev-parse --short HEAD)"
```

## Testing Sentry Integration

Create a test endpoint to verify Sentry works:

```python
@router.get("/test/sentry")
async def test_sentry():
    """Test endpoint to verify Sentry integration."""
    # This will send a test error to Sentry
    try:
        1 / 0
    except Exception as e:
        capture_exception(e, context={"test": True})
        raise HTTPException(
            status_code=500,
            detail="Sentry test error - check your Sentry dashboard"
        )
```

Visit `/api/v1/test/sentry` and check Sentry dashboard for the error.

## Troubleshooting

### Errors Not Appearing in Sentry

1. **Check DSN**: Ensure `SENTRY_DSN` is set correctly
2. **Check Network**: Ensure firewall allows sentry.io
3. **Check Logs**: Look for Sentry initialization message
4. **Test Manually**:
   ```python
   from sentry_sdk import capture_message
   capture_message("Test message")
   ```

### Too Many Events

If you're hitting quota limits:

1. **Adjust Sample Rate**:
   ```python
   traces_sample_rate=0.05  # 5% instead of 10%
   ```

2. **Filter Errors**:
   ```python
   # In before_send_filter
   if event.get("exception"):
       if "KeyError" in str(event["exception"]):
           return None  # Don't send KeyError
   ```

3. **Ignore Specific Errors**:
   ```python
   ignore_errors=[
       KeyboardInterrupt,
       BrokenPipeError,
       ConnectionResetError,
   ]
   ```

## Performance Monitoring

Sentry automatically tracks:
- API endpoint response times
- Database query performance
- External API calls (Keepa, Supabase)

View in Sentry dashboard under **Performance**.

## Cost Considerations

**Free Tier** (10,000 events/month):
- Suitable for small teams
- ~330 errors/day

**Paid Tiers** (starting at $26/month):
- 50,000 events/month
- Advanced features (replays, profiling)

**Tips to Stay Under Quota**:
- Use sampling (10% trace rate)
- Filter non-critical errors
- Only enable in production

## Next Steps

1. ✅ Install Sentry SDK
2. ✅ Create configuration utilities
3. ⬜ Add SENTRY_DSN to `.env`
4. ⬜ Integrate `init_sentry()` in `main.py`
5. ⬜ Test with `/test/sentry` endpoint
6. ⬜ Set up alerts in Sentry dashboard
7. ⬜ Configure frontend Sentry
8. ⬜ Add user context to auth endpoints
9. ⬜ Add breadcrumbs to critical operations

## Resources

- [Sentry FastAPI Documentation](https://docs.sentry.io/platforms/python/guides/fastapi/)
- [Sentry Best Practices](https://docs.sentry.io/product/best-practices/)
- [Sentry React Documentation](https://docs.sentry.io/platforms/javascript/guides/react/)
- [Performance Monitoring](https://docs.sentry.io/product/performance/)
