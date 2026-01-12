"""Tasks API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from uuid import UUID
from app.dependencies import get_current_user
from app.models.task import TaskCreate, TaskUpdate, TaskResponse
from app.models.subtask import SubtaskCreate, SubtaskUpdate, SubtaskResponse
from app.database import get_supabase
from app.utils.error_handler import handle_api_errors
from app.utils.notifications import create_notification
from app.services.email_service import EmailService
from supabase import Client
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/tasks", response_model=List[TaskResponse])
@handle_api_errors("get tasks")
async def get_tasks(
    status: Optional[str] = Query(None, description="Filter by status: pending, in_progress, completed"),
    priority: Optional[str] = Query(None, description="Filter by priority: low, medium, high"),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all tasks visible to the team (all authenticated users can see all tasks), optionally filtered by status or priority."""
    # Get all tasks - team-wide view where everyone can see all tasks
    query = db.table("tasks").select("*")
    
    if status:
        query = query.eq("status", status)
    if priority:
        query = query.eq("priority", priority)
    
    # Execute query
    try:
        response = query.order("created_at", desc=True).execute()
    except Exception as e:
        # If ordering fails, try without ordering
        response = query.execute()
    
    response_data = response.data or []
    
    if not response_data:
        return []
    
    # Sort tasks: those with due_date first (sorted by due_date), then those without due_date
    tasks = response_data
    tasks_with_due = [t for t in tasks if t.get("due_date")]
    tasks_without_due = [t for t in tasks if not t.get("due_date")]
    
    # Sort tasks with due_date by due_date ascending
    tasks_with_due.sort(key=lambda x: x.get("due_date") or "")
    
    # Combine: tasks with due_date first, then tasks without due_date
    sorted_tasks = tasks_with_due + tasks_without_due
    
    # Convert to response models, handling any data issues
    result = []
    for task in sorted_tasks:
        try:
            result.append(TaskResponse(**task))
        except Exception as e:
            # Log but don't fail - skip invalid tasks
            print(f"Error parsing task {task.get('id')}: {e}")
            continue
    
    return result


@router.post("/tasks", response_model=TaskResponse, status_code=201)
@handle_api_errors("create task")
async def create_task(
    task_data: TaskCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Create a new task. Anyone can create tasks and assign them to others (Team Tasks)."""
    # Use mode='json' to automatically serialize UUIDs and datetimes to strings
    task_dict = task_data.model_dump(mode='json')
    task_dict["user_id"] = current_user["id"]
    
    # Anyone can assign tasks to others - no permission check needed
    
    response = db.table("tasks").insert(task_dict).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create task")
    
    created_task = response.data[0]
    task_id = UUID(created_task["id"])
    
    # Create notification if task is assigned to someone
    assigned_to = task_dict.get("assigned_to")
    logger.info(f"Task creation - assigned_to value: {assigned_to}, type: {type(assigned_to)}, current_user_id: {current_user['id']}")
    
    # Check if assigned_to is a valid non-empty value and different from creator
    if assigned_to and str(assigned_to).strip() and str(assigned_to) != str(current_user["id"]):
        try:
            logger.info(f"Creating assignment notification: task_id={task_id}, assigned_to={assigned_to}, creator={current_user['id']}")
            
            # Get creator's name
            creator_response = db.table("profiles").select("email, display_name, full_name").eq("id", str(current_user["id"])).execute()
            creator_name = current_user.get("email", "Unknown User")
            if creator_response.data and len(creator_response.data) > 0:
                creator_name = (
                    creator_response.data[0].get("display_name") or 
                    creator_response.data[0].get("full_name") or 
                    creator_response.data[0].get("email") or 
                    "Unknown User"
                )
            
            task_title = created_task.get("title", "Untitled Task")
            
            # Convert assigned_to to UUID (handle both string and UUID)
            assigned_user_id = UUID(str(assigned_to)) if not isinstance(assigned_to, UUID) else assigned_to
            
            logger.info(f"Calling create_notification with user_id={assigned_user_id}, type=task_assigned")
            notification_created = create_notification(
                db=db,
                user_id=assigned_user_id,
                notification_type="task_assigned",
                title="New Task Assigned",
                message=f'You have been assigned a new task: "{task_title}" by {creator_name}.',
                related_id=task_id,
                related_type="task",
                metadata={
                    "task_title": task_title,
                    "assigned_by": creator_name,
                    "assigned_by_id": str(current_user["id"]),
                    "priority": created_task.get("priority", "medium"),
                    "due_date": created_task.get("due_date")
                }
            )
            
            if notification_created:
                logger.info(f"Successfully created assignment notification for user {assigned_user_id}")
            else:
                logger.error(f"Failed to create assignment notification for user {assigned_user_id}")
                
        except Exception as e:
            logger.error(f"Failed to create assignment notification: {e}", exc_info=True)
    else:
        logger.info(f"Skipping notification creation - assigned_to check failed: assigned_to={assigned_to}, is_empty={not assigned_to or not str(assigned_to).strip()}, is_self={assigned_to and str(assigned_to) == str(current_user['id'])}")
    
    return TaskResponse(**created_task)


@router.put("/tasks/{task_id}", response_model=TaskResponse)
@handle_api_errors("update task")
async def update_task(
    task_id: UUID,
    task_data: TaskUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Update a task (all authenticated users can update tasks due to team-wide visibility)."""
    # Check if task exists - RLS policies handle permissions
    check_response = db.table("tasks").select("*").eq("id", str(task_id)).execute()
    
    if not check_response.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = check_response.data[0]
    # Use mode='json' to automatically serialize UUIDs and datetimes to strings
    update_data = {k: v for k, v in task_data.model_dump(mode='json').items() if v is not None}
    
    # Check if user is trying to change assigned_to
    if "assigned_to" in update_data and update_data["assigned_to"] != task.get("assigned_to"):
        # Only task creator can change assignment
        if task.get("user_id") != current_user["id"]:
            raise HTTPException(
                status_code=403,
                detail="Only the task creator can change task assignment."
            )
        
        # Create notification for new assignment
        new_assigned_to = update_data.get("assigned_to")
        logger.info(f"Task update - assigned_to value: {new_assigned_to}, type: {type(new_assigned_to)}, current_user_id: {current_user['id']}")
        
        # Check if new_assigned_to is a valid non-empty value and different from creator
        if new_assigned_to and str(new_assigned_to).strip() and str(new_assigned_to) != str(current_user["id"]):
            try:
                logger.info(f"Creating assignment notification (update): task_id={task_id}, assigned_to={new_assigned_to}, creator={current_user['id']}")
                
                # Get creator's name
                creator_response = db.table("profiles").select("email, display_name, full_name").eq("id", str(current_user["id"])).execute()
                creator_name = current_user.get("email", "Unknown User")
                if creator_response.data and len(creator_response.data) > 0:
                    creator_name = (
                        creator_response.data[0].get("display_name") or 
                        creator_response.data[0].get("full_name") or 
                        creator_response.data[0].get("email") or 
                        "Unknown User"
                    )
                
                task_title = task.get("title", "Untitled Task")
                
                # Convert new_assigned_to to UUID (handle both string and UUID)
                assigned_user_id = UUID(str(new_assigned_to)) if not isinstance(new_assigned_to, UUID) else new_assigned_to
                
                notification_created = create_notification(
                    db=db,
                    user_id=assigned_user_id,
                    notification_type="task_assigned",
                    title="Task Assigned to You",
                    message=f'Task "{task_title}" has been assigned to you by {creator_name}.',
                    related_id=UUID(str(task_id)),
                    related_type="task",
                    metadata={
                        "task_title": task_title,
                        "assigned_by": creator_name,
                        "assigned_by_id": str(current_user["id"]),
                        "priority": task.get("priority", "medium"),
                        "due_date": task.get("due_date")
                    }
                )
                
                if notification_created:
                    logger.info(f"Successfully created assignment notification (update) for user {assigned_user_id}")
                else:
                    logger.error(f"Failed to create assignment notification (update) for user {assigned_user_id}")
                    
            except Exception as e:
                logger.error(f"Failed to create assignment notification (update): {e}", exc_info=True)
    
    # Check if task is being marked as completed by the assigned user
    was_completed = task.get("status") == "completed"
    will_be_completed = update_data.get("status") == "completed"
    is_assigned_user = task.get("assigned_to") == current_user["id"]
    is_creator = task.get("user_id") == current_user["id"]
    
    # Send notification if:
    # 1. Task is being marked as completed (wasn't completed before)
    # 2. Current user is the assigned user (not the creator)
    # 3. Task has a creator (user_id exists)
    should_notify = (
        not was_completed and 
        will_be_completed and 
        is_assigned_user and 
        not is_creator and
        task.get("user_id")
    )
    
    update_data["updated_at"] = "now()"
    
    # Update task - RLS policies handle permissions
    response = db.table("tasks").update(update_data).eq("id", str(task_id)).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to update task")
    
    # Create notification and send email if needed
    if should_notify:
        try:
            creator_id = UUID(task.get("user_id"))
            task_id = UUID(str(task_id))
            task_title = task.get("title", "Untitled Task")
            
            # Get assigned user's name/email for notification
            assigned_user_response = db.table("profiles").select("email, display_name, full_name").eq("id", str(current_user["id"])).execute()
            assigned_user_name = current_user.get("email", "Unknown User")
            if assigned_user_response.data and len(assigned_user_response.data) > 0:
                assigned_user_name = (
                    assigned_user_response.data[0].get("display_name") or 
                    assigned_user_response.data[0].get("full_name") or 
                    assigned_user_response.data[0].get("email") or 
                    "Unknown User"
                )
            
            # Create in-app notification
            create_notification(
                db=db,
                user_id=creator_id,
                notification_type="task_completed",
                title="Task Completed",
                message=f'Task "{task_title}" has been marked as completed by {assigned_user_name}.',
                related_id=task_id,
                related_type="task",
                metadata={
                    "task_title": task_title,
                    "completed_by": assigned_user_name,
                    "completed_by_id": str(current_user["id"])
                }
            )
            
            # Also send email notification
            try:
                creator_response = db.table("profiles").select("email").eq("id", str(creator_id)).execute()
                creator_email = None
                if creator_response.data and len(creator_response.data) > 0:
                    creator_email = creator_response.data[0].get("email")
                
                if creator_email:
                    email_service = EmailService()
                    subject = f"Task Completed: {task_title}"
                    body = f"""
Hello,

The task "{task_title}" has been marked as completed by {assigned_user_name}.

Task Details:
- Title: {task_title}
- Assigned To: {assigned_user_name}
- Status: Completed

You can view the task details in the application.

Best regards,
Keepa Alert Service
"""
                    email_service.send_email(
                        to_email=creator_email,
                        subject=subject,
                        body=body
                    )
                    logger.info(f"Notification email sent to {creator_email} for task completion")
            except Exception as email_err:
                logger.error(f"Failed to send completion notification email: {email_err}", exc_info=True)
                
        except Exception as e:
            # Log error but don't fail the request
            logger.error(f"Failed to create completion notification: {e}", exc_info=True)
    
    return TaskResponse(**response.data[0])


@router.delete("/tasks/{task_id}")
@handle_api_errors("delete task")
async def delete_task(
    task_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Delete a task (user can delete tasks they created or are assigned to)."""
    # First check if the task exists and user has permission to delete it
    task_check = db.table("tasks").select("id, user_id, assigned_to").eq("id", str(task_id)).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = task_check.data[0]
    user_id = current_user["id"]
    
    # Allow delete if user created the task OR is assigned to it OR has can_assign_tasks permission
    can_delete = (
        task["user_id"] == user_id or 
        task.get("assigned_to") == user_id or
        current_user.get("can_assign_tasks", False)
    )
    
    if not can_delete:
        raise HTTPException(status_code=403, detail="You don't have permission to delete this task")
    
    # Delete the task
    db.table("tasks").delete().eq("id", str(task_id)).execute()

    return {"message": "Task deleted successfully"}


# Subtasks endpoints
@router.get("/tasks/{task_id}/subtasks", response_model=List[SubtaskResponse])
@handle_api_errors("get subtasks")
async def get_subtasks(
    task_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all subtasks for a task (all authenticated users can view subtasks for all tasks)."""
    # Verify task exists (team-wide visibility)
    task_check = db.table("tasks").select("id").eq("id", str(task_id)).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    response = db.table("subtasks").select("*").eq("task_id", str(task_id)).order("display_order", desc=False).order("created_at", desc=False).execute()
    
    # Ensure UUIDs are strings before creating response models
    subtasks = []
    for subtask in response.data:
        subtask_data = subtask.copy()
        for key in ['id', 'task_id', 'assigned_to']:
            if key in subtask_data and subtask_data[key] is not None and not isinstance(subtask_data[key], str):
                subtask_data[key] = str(subtask_data[key])
        subtasks.append(SubtaskResponse(**subtask_data))
    
    return subtasks


@router.post("/tasks/{task_id}/subtasks", response_model=SubtaskResponse, status_code=201)
@handle_api_errors("create subtask")
async def create_subtask(
    task_id: UUID,
    subtask_data: SubtaskCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Create a new subtask for a task (all authenticated users can create subtasks for any task)."""
    # Verify task exists (team-wide access)
    task_check = db.table("tasks").select("id").eq("id", str(task_id)).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    subtask_dict = subtask_data.model_dump()
    subtask_dict["task_id"] = str(task_id)
    # Convert assigned_to UUID to string if present
    if "assigned_to" in subtask_dict and subtask_dict["assigned_to"] is not None:
        subtask_dict["assigned_to"] = str(subtask_dict["assigned_to"])
    
    response = db.table("subtasks").insert(subtask_dict).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create subtask")
    
    # Supabase returns UUIDs as strings, ensure they're properly formatted
    subtask_data = response.data[0].copy()
    # Convert any UUID objects to strings if needed
    for key in ['id', 'task_id', 'assigned_to']:
        if key in subtask_data and subtask_data[key] is not None and not isinstance(subtask_data[key], str):
            subtask_data[key] = str(subtask_data[key])
    
    return SubtaskResponse(**subtask_data)


@router.put("/tasks/{task_id}/subtasks/{subtask_id}", response_model=SubtaskResponse)
@handle_api_errors("update subtask")
async def update_subtask(
    task_id: UUID,
    subtask_id: UUID,
    subtask_data: SubtaskUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Update a subtask (all authenticated users can update subtasks for any task)."""
    # Verify task exists (team-wide access)
    task_check = db.table("tasks").select("id").eq("id", str(task_id)).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Check if subtask exists and belongs to task
    check_response = db.table("subtasks").select("*").eq("id", str(subtask_id)).eq("task_id", str(task_id)).execute()
    
    if not check_response.data:
        raise HTTPException(status_code=404, detail="Subtask not found")
    
    # Update subtask
    update_data = {k: v for k, v in subtask_data.model_dump().items() if v is not None}
    update_data["updated_at"] = "now()"
    # Convert assigned_to UUID to string if present
    if "assigned_to" in update_data and update_data["assigned_to"] is not None:
        update_data["assigned_to"] = str(update_data["assigned_to"])
    
    response = db.table("subtasks").update(update_data).eq("id", str(subtask_id)).eq("task_id", str(task_id)).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to update subtask")
    
    # Ensure UUIDs are strings
    subtask_data = response.data[0].copy()
    for key in ['id', 'task_id', 'assigned_to']:
        if key in subtask_data and subtask_data[key] is not None and not isinstance(subtask_data[key], str):
            subtask_data[key] = str(subtask_data[key])
    
    return SubtaskResponse(**subtask_data)


@router.delete("/tasks/{task_id}/subtasks/{subtask_id}")
@handle_api_errors("delete subtask")
async def delete_subtask(
    task_id: UUID,
    subtask_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Delete a subtask (all authenticated users can delete subtasks for any task)."""
    # Verify task exists (team-wide access)
    task_check = db.table("tasks").select("id").eq("id", str(task_id)).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    response = db.table("subtasks").delete().eq("id", str(subtask_id)).eq("task_id", str(task_id)).execute()
    
    if not response.data:
        raise HTTPException(status_code=404, detail="Subtask not found")
    
    return {"message": "Subtask deleted successfully"}

