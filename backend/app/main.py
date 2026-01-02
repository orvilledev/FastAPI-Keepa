"""FastAPI application entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import init_db
from app.api import auth, jobs, batches, reports
from app.scheduler import setup_scheduler, start_scheduler, shutdown_scheduler
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Keepa Dashboard API",
    description="API for Keepa data processing and reporting",
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
    setup_scheduler()
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
    return {"message": "Keepa Dashboard API", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


# Include API routers
app.include_router(auth.router, prefix=settings.api_v1_str, tags=["auth"])
app.include_router(jobs.router, prefix=settings.api_v1_str, tags=["jobs"])
app.include_router(batches.router, prefix=settings.api_v1_str, tags=["batches"])
app.include_router(reports.router, prefix=settings.api_v1_str, tags=["reports"])

