"""Notifications API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from uuid import UUID
from app.dependencies import get_current_user
from app.models.notification import NotificationResponse, NotificationUpdate
from app.database import get_supabase
from app.utils.error_handler import handle_api_errors
from supabase import Client
from datetime import datetime

router = APIRouter()

NOTIFICATION_CATALOG = [
    {
        "type": "run_failed",
        "priority": "critical",
        "title_template": "Daily Run failed: {vendor}",
        "message_template": "Scheduled run at {time} failed. Reason: {error_summary}.",
    },
    {
        "type": "run_missed",
        "priority": "critical",
        "title_template": "Missed schedule: {vendor}",
        "message_template": "No run was executed at {scheduled_time}.",
    },
    {
        "type": "api_quota_low",
        "priority": "critical",
        "title_template": "Keepa quota low",
        "message_template": "{remaining}% quota remaining. Runs may fail soon.",
    },
    {
        "type": "import_missing_file",
        "priority": "critical",
        "title_template": "Import Mode blocked: no file",
        "message_template": "{vendor} is set to Import Mode but no valid report is available.",
    },
    {
        "type": "run_completed_with_violations",
        "priority": "warning",
        "title_template": "Run completed with violations: {vendor}",
        "message_template": "{violations} off-MAP listings detected from {scanned} items.",
    },
    {
        "type": "import_completed_with_errors",
        "priority": "warning",
        "title_template": "Import completed with issues",
        "message_template": "{invalid_rows} invalid rows were skipped; {valid_rows} processed.",
    },
    {
        "type": "recipients_missing",
        "priority": "warning",
        "title_template": "No recipients configured",
        "message_template": "Run reports for {vendor} cannot be emailed until recipients are set.",
    },
    {
        "type": "run_completed_clean",
        "priority": "info",
        "title_template": "Run completed: {vendor}",
        "message_template": "{scanned} items checked, no off-MAP violations found.",
    },
    {
        "type": "schedule_updated",
        "priority": "info",
        "title_template": "Schedule updated: {vendor}",
        "message_template": "Next run set to {next_run_time} ({mode}).",
    },
    {
        "type": "report_sent",
        "priority": "info",
        "title_template": "Report sent: {vendor}",
        "message_template": "Report emailed to {recipient_count} recipients.",
    },
]


@router.get("/notifications/catalog", response_model=dict)
@handle_api_errors("get notifications catalog")
async def get_notifications_catalog(
    current_user: dict = Depends(get_current_user),
):
    """Get recommended notification types and template metadata for clients/admin tooling."""
    _ = current_user
    return {"items": NOTIFICATION_CATALOG}


@router.get("/notifications", response_model=List[NotificationResponse])
@handle_api_errors("get notifications")
async def get_notifications(
    unread_only: Optional[bool] = Query(False, description="Filter to show only unread notifications"),
    limit: Optional[int] = Query(50, description="Maximum number of notifications to return"),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all notifications for the current user."""
    user_id = current_user["id"]
    
    query = db.table("notifications").select("*").eq("user_id", str(user_id))
    
    if unread_only:
        query = query.eq("is_read", False)
    
    query = query.order("created_at", desc=True).limit(limit)
    
    response = query.execute()
    
    notifications = []
    for notification in response.data or []:
        # Ensure UUIDs are strings
        notification_data = notification.copy()
        for key in ['id', 'user_id', 'related_id']:
            if key in notification_data and notification_data[key] and not isinstance(notification_data[key], str):
                notification_data[key] = str(notification_data[key])
        notifications.append(NotificationResponse(**notification_data))
    
    return notifications


@router.get("/notifications/unread-count", response_model=dict)
@handle_api_errors("get unread notification count")
async def get_unread_count(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get count of unread notifications for the current user."""
    user_id = current_user["id"]
    
    response = db.table("notifications").select("id", count="exact").eq("user_id", str(user_id)).eq("is_read", False).execute()
    
    count = response.count if hasattr(response, 'count') else len(response.data or [])
    
    return {"count": count}


@router.put("/notifications/{notification_id}/read", response_model=NotificationResponse)
@handle_api_errors("mark notification as read")
async def mark_notification_read(
    notification_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Mark a notification as read."""
    user_id = current_user["id"]
    
    # Verify notification belongs to user
    check_response = db.table("notifications").select("*").eq("id", str(notification_id)).eq("user_id", str(user_id)).execute()
    
    if not check_response.data:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    # Update notification
    update_data = {
        "is_read": True,
        "read_at": datetime.utcnow().isoformat()
    }
    
    response = db.table("notifications").update(update_data).eq("id", str(notification_id)).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to update notification")
    
    notification = response.data[0]
    # Ensure UUIDs are strings
    notification_data = notification.copy()
    for key in ['id', 'user_id', 'related_id']:
        if key in notification_data and notification_data[key] and not isinstance(notification_data[key], str):
            notification_data[key] = str(notification_data[key])
    
    return NotificationResponse(**notification_data)


@router.put("/notifications/read-all", response_model=dict)
@handle_api_errors("mark all notifications as read")
async def mark_all_notifications_read(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Mark all notifications as read for the current user."""
    user_id = current_user["id"]
    
    update_data = {
        "is_read": True,
        "read_at": datetime.utcnow().isoformat()
    }
    
    db.table("notifications").update(update_data).eq("user_id", str(user_id)).eq("is_read", False).execute()
    
    return {"message": "All notifications marked as read"}


@router.delete("/notifications/{notification_id}")
@handle_api_errors("delete notification")
async def delete_notification(
    notification_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Delete a notification."""
    user_id = current_user["id"]
    
    # Verify notification belongs to user
    check_response = db.table("notifications").select("id").eq("id", str(notification_id)).eq("user_id", str(user_id)).execute()
    
    if not check_response.data:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    db.table("notifications").delete().eq("id", str(notification_id)).execute()
    
    return {"message": "Notification deleted successfully"}


@router.delete("/notifications")
@handle_api_errors("clear notifications")
async def clear_notifications(
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Delete all notifications for the current user."""
    user_id = current_user["id"]

    db.table("notifications").delete().eq("user_id", str(user_id)).execute()

    return {"message": "All notifications cleared"}
