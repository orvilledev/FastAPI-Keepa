"""
Centralized permission utilities for the application.
Provides consistent permission checking across all API endpoints.
"""

from typing import Optional


class PermissionChecker:
    """
    Permission checker utility for tasks and other resources.
    """
    
    def __init__(self, current_user: dict):
        self.user_id = current_user.get("id")
        self.can_assign_tasks = current_user.get("can_assign_tasks", False)
        self.can_manage_tools = current_user.get("can_manage_tools", False)
        self.has_keepa_access = current_user.get("has_keepa_access", False)
        self.role = current_user.get("role", "user")
    
    def can_delete_task(self, task: dict) -> bool:
        """Check if user can delete a task."""
        return (
            task.get("user_id") == self.user_id or
            task.get("assigned_to") == self.user_id or
            self.can_assign_tasks
        )
    
    def can_edit_task(self, task: dict) -> bool:
        """Check if user can edit a task."""
        return (
            task.get("user_id") == self.user_id or
            task.get("assigned_to") == self.user_id or
            self.can_assign_tasks
        )
    
    def can_review_task(self, task: dict) -> bool:
        """Check if user can review validations for a task."""
        return (
            task.get("user_id") == self.user_id or
            self.can_assign_tasks
        )
    
    def can_upload_validation(self, task: dict) -> bool:
        """Check if user can upload validation for a task."""
        return task.get("assigned_to") == self.user_id
    
    def can_change_assignment(self, task: dict) -> bool:
        """Check if user can change task assignment."""
        return (
            task.get("user_id") == self.user_id or
            self.can_assign_tasks
        )
    
    def can_access_task_attachments(self, task: dict) -> bool:
        """Check if user can access task attachments."""
        return (
            task.get("user_id") == self.user_id or
            task.get("assigned_to") == self.user_id or
            self.can_assign_tasks
        )
    
    def can_upload_task_attachment(self, task: dict) -> bool:
        """Check if user can upload task attachments."""
        return (
            task.get("user_id") == self.user_id or
            task.get("assigned_to") == self.user_id or
            self.can_assign_tasks
        )
    
    def can_delete_attachment(self, attachment: dict) -> bool:
        """Check if user can delete an attachment."""
        return attachment.get("uploaded_by") == self.user_id
    
    def can_delete_validation(self, validation: dict) -> bool:
        """Check if user can delete a validation."""
        return validation.get("submitted_by") == self.user_id
    
    # Note permissions
    def can_access_note(self, note: dict) -> bool:
        """Check if user can access a note."""
        return note.get("user_id") == self.user_id
    
    def can_edit_note(self, note: dict) -> bool:
        """Check if user can edit a note."""
        return note.get("user_id") == self.user_id
    
    def can_delete_note(self, note: dict) -> bool:
        """Check if user can delete a note."""
        return note.get("user_id") == self.user_id


def get_permission_checker(current_user: dict) -> PermissionChecker:
    """Factory function to create a permission checker."""
    return PermissionChecker(current_user)
