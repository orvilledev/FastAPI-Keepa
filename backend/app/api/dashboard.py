"""Dashboard widgets API endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from app.dependencies import get_current_user
from app.models.dashboard_widget import (
    DashboardWidgetCreate,
    DashboardWidgetUpdate,
    DashboardWidgetResponse,
    DashboardWidgetOrderUpdate
)
from app.database import get_supabase
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

