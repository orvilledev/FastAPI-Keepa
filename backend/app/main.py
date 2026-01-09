"""FastAPI application entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import init_db
from app.api import auth, jobs, batches, reports, upcs, scheduler, tools, quick_access, tasks, task_validations, task_attachments, dashboard, map, notes
from app.scheduler import setup_scheduler, start_scheduler, shutdown_scheduler
import logging

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


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    logger.info("Initializing database connection...")
    init_db()
    logger.info("Setting up scheduler...")
    # Try to load scheduler settings from database
    try:
        from app.database import get_supabase
        db = get_supabase()
        settings_response = db.table("scheduler_settings").select("*").eq("id", "00000000-0000-0000-0000-000000000000").execute()
        if settings_response.data:
            settings = settings_response.data[0]
            setup_scheduler(
                timezone_str=settings.get("timezone", "Asia/Taipei"),
                hour=settings.get("hour", 20),
                minute=settings.get("minute", 0)
            )
        else:
            setup_scheduler()  # Use defaults
    except Exception as e:
        logger.warning(f"Failed to load scheduler settings, using defaults: {e}")
        setup_scheduler()  # Use defaults
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

