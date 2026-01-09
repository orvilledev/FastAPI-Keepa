"""Tasks API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from uuid import UUID
from app.dependencies import get_current_user
from app.models.task import TaskCreate, TaskUpdate, TaskResponse
from app.models.subtask import SubtaskCreate, SubtaskUpdate, SubtaskResponse
from app.database import get_supabase
from app.utils.error_handler import handle_api_errors
from supabase import Client

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
    
    return TaskResponse(**response.data[0])


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
    
    update_data["updated_at"] = "now()"
    
    # Update task - RLS policies handle permissions
    response = db.table("tasks").update(update_data).eq("id", str(task_id)).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to update task")
    
    return TaskResponse(**response.data[0])


@router.delete("/tasks/{task_id}")
@handle_api_errors("delete task")
async def delete_task(
    task_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Delete a task (user can only delete their own tasks)."""
    response = db.table("tasks").delete().eq("id", str(task_id)).eq("user_id", current_user["id"]).execute()
    
    if not response.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return {"message": "Task deleted successfully"}


# Subtasks endpoints
@router.get("/tasks/{task_id}/subtasks", response_model=List[SubtaskResponse])
@handle_api_errors("get subtasks")
async def get_subtasks(
    task_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all subtasks for a task (user can only view subtasks for their own tasks)."""
    # Verify task belongs to user
    task_check = db.table("tasks").select("id").eq("id", str(task_id)).eq("user_id", current_user["id"]).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    response = db.table("subtasks").select("*").eq("task_id", str(task_id)).order("display_order", desc=False).order("created_at", desc=False).execute()
    
    # Ensure UUIDs are strings before creating response models
    subtasks = []
    for subtask in response.data:
        subtask_data = subtask.copy()
        for key in ['id', 'task_id']:
            if key in subtask_data and not isinstance(subtask_data[key], str):
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
    """Create a new subtask for a task (user can only add subtasks to their own tasks)."""
    # Verify task belongs to user
    task_check = db.table("tasks").select("id").eq("id", str(task_id)).eq("user_id", current_user["id"]).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    subtask_dict = subtask_data.model_dump()
    subtask_dict["task_id"] = str(task_id)
    
    response = db.table("subtasks").insert(subtask_dict).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create subtask")
    
    # Supabase returns UUIDs as strings, ensure they're properly formatted
    subtask_data = response.data[0].copy()
    # Convert any UUID objects to strings if needed
    for key in ['id', 'task_id']:
        if key in subtask_data and not isinstance(subtask_data[key], str):
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
    """Update a subtask (user can only update subtasks for their own tasks)."""
    # Verify task belongs to user
    task_check = db.table("tasks").select("id").eq("id", str(task_id)).eq("user_id", current_user["id"]).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Check if subtask exists and belongs to task
    check_response = db.table("subtasks").select("*").eq("id", str(subtask_id)).eq("task_id", str(task_id)).execute()
    
    if not check_response.data:
        raise HTTPException(status_code=404, detail="Subtask not found")
    
    # Update subtask
    update_data = {k: v for k, v in subtask_data.model_dump().items() if v is not None}
    update_data["updated_at"] = "now()"
    
    response = db.table("subtasks").update(update_data).eq("id", str(subtask_id)).eq("task_id", str(task_id)).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to update subtask")
    
    # Ensure UUIDs are strings
    subtask_data = response.data[0].copy()
    for key in ['id', 'task_id']:
        if key in subtask_data and not isinstance(subtask_data[key], str):
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
    """Delete a subtask (user can only delete subtasks for their own tasks)."""
    # Verify task belongs to user
    task_check = db.table("tasks").select("id").eq("id", str(task_id)).eq("user_id", current_user["id"]).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    response = db.table("subtasks").delete().eq("id", str(subtask_id)).eq("task_id", str(task_id)).execute()
    
    if not response.data:
        raise HTTPException(status_code=404, detail="Subtask not found")
    
    return {"message": "Subtask deleted successfully"}

