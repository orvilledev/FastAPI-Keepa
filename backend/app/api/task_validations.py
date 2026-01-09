"""Task Validations API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import List, Optional
from uuid import UUID
from app.dependencies import get_current_user
from app.models.task_validation import TaskValidationCreate, TaskValidationUpdate, TaskValidationResponse
from app.database import get_supabase
from app.utils.error_handler import handle_api_errors
from supabase import Client
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/tasks/{task_id}/validations", response_model=List[TaskValidationResponse])
@handle_api_errors("get task validations")
async def get_task_validations(
    task_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all validations for a task."""
    # Verify user has access to this task
    task_check = db.table("tasks").select("id, user_id, assigned_to").eq("id", str(task_id)).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = task_check.data[0]
    if task.get("user_id") != current_user["id"] and task.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You don't have access to this task")
    
    response = db.table("task_validations").select("*").eq("task_id", str(task_id)).order("created_at", desc=True).execute()
    
    validations = []
    for validation in response.data or []:
        try:
            validations.append(TaskValidationResponse(**validation))
        except Exception as e:
            logger.warning(f"Error parsing validation {validation.get('id')}: {e}")
            continue
    
    return validations


@router.post("/tasks/{task_id}/validations/file", response_model=TaskValidationResponse, status_code=201)
@handle_api_errors("upload file validation")
async def upload_file_validation(
    task_id: UUID,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Upload a file for task validation."""
    # Verify task exists and is assigned to user
    task_check = db.table("tasks").select("id, assigned_to").eq("id", str(task_id)).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = task_check.data[0]
    if task.get("assigned_to") != current_user["id"]:
        raise HTTPException(
            status_code=403,
            detail="You can only submit validations for tasks assigned to you"
        )
    
    # Upload file to Supabase Storage
    try:
        file_content = await file.read()
        file_size = len(file_content)
        
        # Generate unique file path
        file_path = f"task-validations/{task_id}/{current_user['id']}/{datetime.utcnow().timestamp()}-{file.filename}"
        
        # Try to create bucket if it doesn't exist (this may fail due to permissions, but that's okay)
        try:
            db.storage.create_bucket("task-validations", {"public": True})
        except Exception as bucket_error:
            # Bucket might already exist or we don't have permission - that's fine
            logger.debug(f"Bucket creation attempt: {bucket_error}")
        
        # Upload to Supabase Storage
        storage_response = db.storage.from_("task-validations").upload(
            file_path,
            file_content,
            file_options={"content-type": file.content_type or "application/octet-stream", "upsert": "false"}
        )
        
        if not storage_response:
            raise HTTPException(status_code=500, detail="Failed to upload file")
        
        # Get public URL
        try:
            file_url_response = db.storage.from_("task-validations").get_public_url(file_path)
            file_url = file_url_response if isinstance(file_url_response, str) else file_url_response.get("publicUrl", "")
        except Exception as url_error:
            # If get_public_url fails, construct URL manually
            logger.warning(f"Failed to get public URL, constructing manually: {url_error}")
            from app.config import settings
            file_url = f"{settings.supabase_url}/storage/v1/object/public/task-validations/{file_path}"
        
    except Exception as e:
        logger.error(f"File upload error: {e}")
        # Provide helpful error message
        error_msg = str(e)
        if "bucket" in error_msg.lower() or "not found" in error_msg.lower():
            raise HTTPException(
                status_code=500,
                detail="Storage bucket 'task-validations' not found. Please create it in Supabase Dashboard > Storage."
            )
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {error_msg}")
    
    # Create validation record
    validation_data = {
        "task_id": str(task_id),
        "submitted_by": current_user["id"],
        "validation_type": "file",
        "file_name": file.filename,
        "file_url": file_url,
        "file_size": file_size,
        "status": "pending"
    }
    
    response = db.table("task_validations").insert(validation_data).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create validation")
    
    return TaskValidationResponse(**response.data[0])


@router.post("/tasks/{task_id}/validations/text", response_model=TaskValidationResponse, status_code=201)
@handle_api_errors("submit text validation")
async def submit_text_validation(
    task_id: UUID,
    text_content: str = Form(...),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Submit text content for task validation."""
    # Verify task exists and is assigned to user
    task_check = db.table("tasks").select("id, assigned_to").eq("id", str(task_id)).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = task_check.data[0]
    if task.get("assigned_to") != current_user["id"]:
        raise HTTPException(
            status_code=403,
            detail="You can only submit validations for tasks assigned to you"
        )
    
    if not text_content or not text_content.strip():
        raise HTTPException(status_code=400, detail="Text content cannot be empty")
    
    # Create validation record
    validation_data = {
        "task_id": str(task_id),
        "submitted_by": current_user["id"],
        "validation_type": "text",
        "text_content": text_content.strip(),
        "status": "pending"
    }
    
    response = db.table("task_validations").insert(validation_data).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create validation")
    
    return TaskValidationResponse(**response.data[0])


@router.put("/task-validations/{validation_id}/review", response_model=TaskValidationResponse)
@handle_api_errors("review validation")
async def review_validation(
    validation_id: UUID,
    validation_update: TaskValidationUpdate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Approve or reject a task validation."""
    # Get validation and task
    validation_check = db.table("task_validations").select("*").eq("id", str(validation_id)).execute()
    
    if not validation_check.data:
        raise HTTPException(status_code=404, detail="Validation not found")
    
    validation = validation_check.data[0]
    
    # Get task to check permissions
    task_check = db.table("tasks").select("id, user_id").eq("id", validation["task_id"]).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = task_check.data[0]
    
    # Check if user can review (task creator or user with can_assign_tasks)
    can_review = False
    
    if task.get("user_id") == current_user["id"]:
        can_review = True
    else:
        # Check if user has can_assign_tasks permission
        profile_response = db.table("profiles").select("can_assign_tasks").eq("id", current_user["id"]).execute()
        if profile_response.data and profile_response.data[0].get("can_assign_tasks"):
            can_review = True
    
    if not can_review:
        raise HTTPException(
            status_code=403,
            detail="You don't have permission to review this validation"
        )
    
    if validation["status"] != "pending":
        raise HTTPException(status_code=400, detail="This validation has already been reviewed")
    
    # Update validation
    update_data = {
        "status": validation_update.status,
        "reviewed_by": current_user["id"],
        "reviewed_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    
    if validation_update.review_notes:
        update_data["review_notes"] = validation_update.review_notes
    
    response = db.table("task_validations").update(update_data).eq("id", str(validation_id)).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to update validation")
    
    return TaskValidationResponse(**response.data[0])


@router.delete("/task-validations/{validation_id}")
@handle_api_errors("delete validation")
async def delete_validation(
    validation_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Delete a task validation (only by submitter if pending)."""
    validation_check = db.table("task_validations").select("*").eq("id", str(validation_id)).execute()
    
    if not validation_check.data:
        raise HTTPException(status_code=404, detail="Validation not found")
    
    validation = validation_check.data[0]
    
    # Only allow deletion if user is the submitter and status is pending
    if validation["submitted_by"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="You can only delete your own validations")
    
    if validation["status"] != "pending":
        raise HTTPException(status_code=400, detail="Cannot delete reviewed validations")
    
    # Delete file from storage if it's a file validation
    if validation.get("validation_type") == "file" and validation.get("file_url"):
        try:
            # Extract file path from URL
            file_path = validation["file_url"].split("/task-validations/")[-1] if "/task-validations/" in validation["file_url"] else None
            if file_path:
                db.storage.from_("task-validations").remove([file_path])
        except Exception as e:
            logger.warning(f"Failed to delete file from storage: {e}")
    
    # Delete validation record
    db.table("task_validations").delete().eq("id", str(validation_id)).execute()
    
    return {"message": "Validation deleted successfully"}

