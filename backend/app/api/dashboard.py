"""Dashboard widgets API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from uuid import UUID
from app.dependencies import get_current_user
from app.models.dashboard_widget import (
    DashboardWidgetCreate,
    DashboardWidgetUpdate,
    DashboardWidgetResponse,
    DashboardWidgetOrderUpdate
)
from app.database import get_supabase
from app.services.report_service import ReportService
from app.utils.error_handler import handle_api_errors
from supabase import Client

router = APIRouter()


@router.get("/dashboard/widgets", response_model=List[DashboardWidgetResponse])
@handle_api_errors("get dashboard widgets")
async def get_dashboard_widgets(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all dashboard widget preferences for the current user."""
    try:
        response = db.table("dashboard_widgets").select("*").eq("user_id", str(current_user["id"])).order("display_order", desc=False).execute()
        
        # Ensure UUIDs are strings
        widgets = []
        for widget in response.data:
            widget_data = widget.copy()
            for key in ['id', 'user_id']:
                if key in widget_data and not isinstance(widget_data[key], str):
                    widget_data[key] = str(widget_data[key])
            widgets.append(DashboardWidgetResponse(**widget_data))
        
        return widgets
    except Exception as e:
        # If table doesn't exist, return empty list
        error_msg = str(e)
        if "PGRST205" in error_msg or "Could not find the table" in error_msg:
            return []
        raise


@router.post("/dashboard/widgets/order", response_model=List[DashboardWidgetResponse])
@handle_api_errors("update dashboard widget order")
async def update_dashboard_widget_order(
    order_data: DashboardWidgetOrderUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Update dashboard widget order in bulk."""
    user_id = current_user["id"]
    
    # Upsert widget orders
    for widget in order_data.widgets:
        widget_id = widget.get("widget_id")
        display_order = widget.get("display_order")
        
        if widget_id is None or display_order is None:
            continue
        
        # Check if widget preference exists
        check_response = db.table("dashboard_widgets").select("*").eq("user_id", str(user_id)).eq("widget_id", widget_id).execute()
        
        if check_response.data:
            # Update existing
            update_response = db.table("dashboard_widgets").update({
                "display_order": display_order,
                "updated_at": "now()"
            }).eq("user_id", str(user_id)).eq("widget_id", widget_id).execute()
            
            if not update_response.data:
                raise HTTPException(status_code=500, detail=f"Failed to update widget {widget_id}")
        else:
            # Create new
            insert_response = db.table("dashboard_widgets").insert({
                "user_id": str(user_id),
                "widget_id": widget_id,
                "display_order": display_order,
                "is_visible": True
            }).execute()
            
            if not insert_response.data:
                raise HTTPException(status_code=500, detail=f"Failed to create widget {widget_id}")
    
    # Return updated widgets
    response = db.table("dashboard_widgets").select("*").eq("user_id", str(user_id)).order("display_order", desc=False).execute()
    
    # Ensure UUIDs are strings
    widgets = []
    for widget in response.data:
        widget_data = widget.copy()
        for key in ['id', 'user_id']:
            if key in widget_data and not isinstance(widget_data[key], str):
                widget_data[key] = str(widget_data[key])
        widgets.append(DashboardWidgetResponse(**widget_data))
    
    return widgets


def _is_daily_run_name_for_category(job_name: str, category: str) -> bool:
    """Check whether a job name belongs to a category daily run."""
    if not job_name:
        return False
    normalized = job_name.lower()
    category_prefix = f"daily {category.lower()} "
    return normalized.startswith(category_prefix) and (
        "off price report" in normalized or "metro report" in normalized
    )


@router.get("/dashboard/off-price-seller-stats")
@handle_api_errors("get off-price seller stats")
async def get_off_price_seller_stats(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """
    Return off-price seller counts based on the latest completed daily run per category.

    Uses the same report-row logic as report exports, then aggregates seller names.
    """
    response = (
        db.table("batch_jobs")
        .select("id, job_name, completed_at, created_at")
        .eq("status", "completed")
        .ilike("job_name", "Daily %")
        .order("completed_at", desc=True)
        .limit(300)
        .execute()
    )

    jobs = response.data or []
    latest_by_category = {"dnk": None, "clk": None}
    for job in jobs:
        job_name = job.get("job_name", "")
        if latest_by_category["dnk"] is None and _is_daily_run_name_for_category(job_name, "dnk"):
            latest_by_category["dnk"] = job
        if latest_by_category["clk"] is None and _is_daily_run_name_for_category(job_name, "clk"):
            latest_by_category["clk"] = job
        if latest_by_category["dnk"] and latest_by_category["clk"]:
            break

    report_service = ReportService(db)

    def build_category_stats(job: dict | None) -> dict:
        if not job:
            return {
                "job_id": None,
                "job_name": None,
                "run_at": None,
                "distinct_seller_count": 0,
                "top_sellers": [],
                "_seller_keys": [],
            }

        rows = report_service.get_comprehensive_report_rows_for_job(UUID(str(job["id"])))
        seller_counts: dict[str, int] = {}
        seller_key_to_name: dict[str, str] = {}
        for row in rows:
            seller_name = (row.get("Seller") or "").strip()
            if not seller_name:
                continue
            key = seller_name.lower()
            seller_key_to_name.setdefault(key, seller_name)
            seller_counts[key] = seller_counts.get(key, 0) + 1

        top_sellers = sorted(
            [
                {"seller_name": seller_key_to_name[key], "count": count}
                for key, count in seller_counts.items()
            ],
            key=lambda item: item["count"],
            reverse=True,
        )[:5]

        return {
            "job_id": str(job["id"]),
            "job_name": job.get("job_name"),
            "run_at": job.get("completed_at") or job.get("created_at"),
            "distinct_seller_count": len(seller_counts),
            "top_sellers": top_sellers,
            "_seller_keys": list(seller_counts.keys()),
        }

    dnk_stats = build_category_stats(latest_by_category["dnk"])
    clk_stats = build_category_stats(latest_by_category["clk"])

    combined_sellers = set(dnk_stats.get("_seller_keys", [])) | set(clk_stats.get("_seller_keys", []))
    dnk_stats.pop("_seller_keys", None)
    clk_stats.pop("_seller_keys", None)

    return {
        "dnk": dnk_stats,
        "clk": clk_stats,
        "total_distinct_sellers": len(combined_sellers),
    }

