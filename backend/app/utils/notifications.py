"""Utility functions for creating notifications."""
from uuid import UUID
from supabase import Client
from typing import Optional, Dict, Any, List
import logging

logger = logging.getLogger(__name__)

# Types shown in the in-app Notifications feed (completed Express + Daily runs only).
COMPLETION_NOTIFICATION_TYPES = frozenset(
    {"run_completed", "run_completed_clean", "run_completed_with_violations"}
)


def create_notification(
    db: Client,
    user_id: UUID,
    notification_type: str,
    title: str,
    message: str,
    priority: str = "info",
    related_id: Optional[UUID] = None,
    related_type: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    action_label: Optional[str] = None,
    action_url: Optional[str] = None,
    expires_at: Optional[str] = None,
) -> bool:
    """
    Create a notification for a user.
    
    Args:
        db: Supabase client
        user_id: ID of the user to notify
        notification_type: Type of notification (e.g., 'task_completed', 'task_assigned')
        title: Notification title
        message: Notification message
        priority: Severity level ('critical', 'warning', 'info')
        related_id: ID of related entity (task, validation, etc.)
        related_type: Type of related entity ('task', 'validation', etc.)
        metadata: Additional metadata as dictionary
        action_label: Optional action button text for UI
        action_url: Optional URL/path to navigate when action is clicked
        expires_at: Optional ISO timestamp for soft expiration
        
    Returns:
        True if notification created successfully, False otherwise
    """
    try:
        notification_data = {
            "user_id": str(user_id),
            "type": notification_type,
            "title": title,
            "message": message,
            "priority": priority,
            "is_read": False
        }
        
        if related_id:
            notification_data["related_id"] = str(related_id)
        if related_type:
            notification_data["related_type"] = related_type
        if metadata:
            notification_data["metadata"] = metadata
        if action_label:
            notification_data["action_label"] = action_label
        if action_url:
            notification_data["action_url"] = action_url
        if expires_at:
            notification_data["expires_at"] = expires_at
        
        logger.info(f"Attempting to create notification: {notification_data}")
        
        # Check if notifications table exists by trying to query it first
        try:
            test_query = db.table("notifications").select("id").limit(1).execute()
            logger.debug("Notifications table exists and is accessible")
        except Exception as table_err:
            logger.error(f"Notifications table may not exist or is not accessible: {table_err}")
            logger.error("Please run the database migration: backend/database/notifications_schema.sql")
            return False
        
        logger.info(f"Inserting notification into database...")
        response = db.table("notifications").insert(notification_data).execute()
        logger.info(f"Insert response received: has_data={bool(response.data)}, data_length={len(response.data) if response.data else 0}")
        
        if response.data and len(response.data) > 0:
            logger.info(f"Notification created successfully for user {user_id}: {title} (id: {response.data[0].get('id')})")
            return True
        else:
            logger.error(f"Failed to create notification for user {user_id}: No data returned from insert")
            logger.error(f"Response: {response}")
            return False
            
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Error creating notification for user {user_id}: {type(e).__name__}: {error_msg}", exc_info=True)
        
        # Check for common errors
        if "permission denied" in error_msg.lower() or "policy" in error_msg.lower():
            logger.error("RLS policy may be blocking notification creation. Check that service role key is configured.")
        elif "relation" in error_msg.lower() and "does not exist" in error_msg.lower():
            logger.error("Notifications table does not exist. Please run: backend/database/notifications_schema.sql")
        
        return False


def create_completion_notifications_for_all_profiles(
    db: Client,
    notification_type: str,
    title: str,
    message: str,
    priority: str = "info",
    related_id: Optional[UUID] = None,
    related_type: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    action_label: Optional[str] = None,
    action_url: Optional[str] = None,
    expires_at: Optional[str] = None,
) -> int:
    """
    Insert the same completion notification once per profile so every user sees completed runs.

    notification_type must be one of COMPLETION_NOTIFICATION_TYPES.
    Returns number of rows inserted (0 on failure / no profiles).
    """
    if notification_type not in COMPLETION_NOTIFICATION_TYPES:
        logger.error(
            "create_completion_notifications_for_all_profiles: invalid type %r (expected one of %s)",
            notification_type,
            sorted(COMPLETION_NOTIFICATION_TYPES),
        )
        return 0
    try:
        prof = db.table("profiles").select("id").execute()
        user_ids: List[str] = [str(p["id"]) for p in (prof.data or []) if p.get("id")]
        if not user_ids:
            logger.warning("No profiles found; skipping team completion notifications")
            return 0

        base: Dict[str, Any] = {
            "type": notification_type,
            "title": title,
            "message": message,
            "priority": priority,
            "is_read": False,
        }
        if related_id:
            base["related_id"] = str(related_id)
        if related_type:
            base["related_type"] = related_type
        if metadata:
            base["metadata"] = metadata
        if action_label:
            base["action_label"] = action_label
        if action_url:
            base["action_url"] = action_url
        if expires_at:
            base["expires_at"] = expires_at

        inserted = 0
        chunk_size = 150
        for i in range(0, len(user_ids), chunk_size):
            chunk = user_ids[i : i + chunk_size]
            rows = [{**base, "user_id": uid} for uid in chunk]
            resp = db.table("notifications").insert(rows).execute()
            inserted += len(resp.data or [])

        logger.info(
            "Team completion notifications inserted: type=%s title=%r recipients=%s",
            notification_type,
            title,
            inserted,
        )
        return inserted
    except Exception as e:
        logger.error(
            "create_completion_notifications_for_all_profiles failed: %s",
            e,
            exc_info=True,
        )
        return 0
