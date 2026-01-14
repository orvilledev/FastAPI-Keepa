"""FastAPI application entry point."""
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from app.config import settings
from app.database import init_db
from app.api import auth, jobs, batches, reports, upcs, scheduler, tools, quick_access, tasks, task_validations, task_attachments, dashboard, map, notes, notifications
from app.scheduler import setup_scheduler, start_scheduler, shutdown_scheduler
import logging
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Orbit API",
    description="API for Orbit productivity platform",
    version="1.0.0",
)

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
    """Handle validation errors with detailed logging for debugging."""
    errors = exc.errors()

    # Get request body for debugging
    try:
        body = await request.body()
        body_json = json.loads(body) if body else {}
        logger.error(f"Validation error for {request.method} {request.url.path}")
        logger.error(f"Request body: {json.dumps(body_json, indent=2)}")
        logger.error(f"Validation errors: {json.dumps(errors, indent=2)}")
    except Exception as e:
        logger.error(f"Could not parse request body: {e}")

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": errors}
    )


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    logger.info("Initializing database connection...")
    init_db()
    logger.info("Setting up scheduler...")
    # Try to load scheduler settings from database for both DNK and CLK
    try:
        from app.database import get_supabase
        db = get_supabase()

        # Load DNK settings
        dnk_settings_response = db.table("scheduler_settings").select("*").eq("category", "dnk").execute()
        if dnk_settings_response.data:
            dnk_settings = dnk_settings_response.data[0]
            setup_scheduler(
                timezone_str=dnk_settings.get("timezone", "America/Chicago"),
                hour=dnk_settings.get("hour", 6),
                minute=dnk_settings.get("minute", 0),
                category='dnk'
            )
        else:
            setup_scheduler(category='dnk')  # Use DNK defaults

        # Load CLK settings
        clk_settings_response = db.table("scheduler_settings").select("*").eq("category", "clk").execute()
        if clk_settings_response.data:
            clk_settings = clk_settings_response.data[0]
            setup_scheduler(
                timezone_str=clk_settings.get("timezone", "America/Chicago"),
                hour=clk_settings.get("hour", 6),
                minute=clk_settings.get("minute", 0),
                category='clk'
            )
        else:
            setup_scheduler(category='clk')  # Use CLK defaults
    except Exception as e:
        logger.warning(f"Failed to load scheduler settings, using defaults: {e}")
        setup_scheduler(category='dnk')  # Use DNK defaults
        setup_scheduler(category='clk')  # Use CLK defaults
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
    return {"message": "Orbit API", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


# Include API routers
app.include_router(auth.router, prefix=f"{settings.api_v1_str}/auth", tags=["auth"])
app.include_router(jobs.router, prefix=settings.api_v1_str, tags=["jobs"])
app.include_router(batches.router, prefix=settings.api_v1_str, tags=["batches"])
app.include_router(reports.router, prefix=settings.api_v1_str, tags=["reports"])
app.include_router(upcs.router, prefix=settings.api_v1_str, tags=["upcs"])
app.include_router(map.router, prefix=settings.api_v1_str, tags=["map"])
app.include_router(scheduler.router, prefix=settings.api_v1_str, tags=["scheduler"])
app.include_router(tools.router, prefix=settings.api_v1_str, tags=["tools"])
app.include_router(quick_access.router, prefix=settings.api_v1_str, tags=["quick-access"])
app.include_router(tasks.router, prefix=settings.api_v1_str, tags=["tasks"])
app.include_router(task_validations.router, prefix=settings.api_v1_str, tags=["task-validations"])
app.include_router(task_attachments.router, prefix=settings.api_v1_str, tags=["task-attachments"])
app.include_router(dashboard.router, prefix=settings.api_v1_str, tags=["dashboard"])
app.include_router(notes.router, prefix=settings.api_v1_str, tags=["notes"])
app.include_router(notifications.router, prefix=settings.api_v1_str, tags=["notifications"])

