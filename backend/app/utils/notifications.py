"""Utility functions for creating notifications."""
from uuid import UUID
from supabase import Client
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


def create_notification(
    db: Client,
    user_id: UUID,
    notification_type: str,
    title: str,
    message: str,
    related_id: Optional[UUID] = None,
    related_type: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Create a notification for a user.
    
    Args:
        db: Supabase client
        user_id: ID of the user to notify
        notification_type: Type of notification (e.g., 'task_completed', 'task_assigned')
        title: Notification title
        message: Notification message
        related_id: ID of related entity (task, validation, etc.)
        related_type: Type of related entity ('task', 'validation', etc.)
        metadata: Additional metadata as dictionary
        
    Returns:
        True if notification created successfully, False otherwise
    """
    try:
        notification_data = {
            "user_id": str(user_id),
            "type": notification_type,
            "title": title,
            "message": message,
            "is_read": False
        }
        
        if related_id:
            notification_data["related_id"] = str(related_id)
        if related_type:
            notification_data["related_type"] = related_type
        if metadata:
            notification_data["metadata"] = metadata
        
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
