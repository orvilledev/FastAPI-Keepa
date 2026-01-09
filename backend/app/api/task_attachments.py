"""Task Attachments API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from typing import List
from uuid import UUID
from app.dependencies import get_current_user
from app.models.task_attachment import TaskAttachmentResponse
from app.database import get_supabase
from app.utils.error_handler import handle_api_errors
from supabase import Client
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# Allowed file types and their categories
ALLOWED_FILE_TYPES = {
    # Images
    'image/jpeg': 'image',
    'image/jpg': 'image',
    'image/png': 'image',
    'image/gif': 'image',
    'image/webp': 'image',
    # PDF
    'application/pdf': 'pdf',
    # Excel
    'application/vnd.ms-excel': 'excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
    'application/vnd.ms-excel.sheet.macroEnabled.12': 'excel',
    # CSV
    'text/csv': 'csv',
    'application/csv': 'csv',
    # PowerPoint
    'application/vnd.ms-powerpoint': 'powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.slideshow': 'powerpoint',
    # Word
    'application/msword': 'word',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
}

# Max file size: 50MB
MAX_FILE_SIZE = 50 * 1024 * 1024


def get_file_category(content_type: str) -> str:
    """Determine file category from MIME type."""
    return ALLOWED_FILE_TYPES.get(content_type.lower(), 'other')


@router.get("/tasks/{task_id}/attachments", response_model=List[TaskAttachmentResponse])
@handle_api_errors("get task attachments")
async def get_task_attachments(
    task_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Get all attachments for a task."""
    # Verify user has access to this task
    task_check = db.table("tasks").select("id, user_id, assigned_to").eq("id", str(task_id)).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = task_check.data[0]
    if task.get("user_id") != current_user["id"] and task.get("assigned_to") != current_user["id"]:
        raise HTTPException(status_code=403, detail="You don't have access to this task")
    
    response = db.table("task_attachments").select("*").eq("task_id", str(task_id)).order("created_at", desc=True).execute()
    
    attachments = []
    for attachment in response.data or []:
        try:
            attachments.append(TaskAttachmentResponse(**attachment))
        except Exception as e:
            logger.warning(f"Error parsing attachment {attachment.get('id')}: {e}")
            continue
    
    return attachments


@router.post("/tasks/{task_id}/attachments", response_model=TaskAttachmentResponse, status_code=201)
@handle_api_errors("upload task attachment")
async def upload_task_attachment(
    task_id: UUID,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Upload an attachment for a task."""
    # Verify task exists and user has access
    task_check = db.table("tasks").select("id, user_id, assigned_to").eq("id", str(task_id)).execute()
    
    if not task_check.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = task_check.data[0]
    if task.get("user_id") != current_user["id"] and task.get("assigned_to") != current_user["id"]:
        raise HTTPException(
            status_code=403,
            detail="You can only upload attachments for tasks you created or are assigned to"
        )
    
    # Check file type
    content_type = file.content_type or "application/octet-stream"
    file_category = get_file_category(content_type)
    
    if file_category == 'other' and content_type != "application/octet-stream":
        raise HTTPException(
            status_code=400,
            detail=f"File type not supported. Allowed types: images (JPEG, PNG, GIF, WebP), PDF, Excel, CSV, PowerPoint, Word documents."
        )
    
    # Read file content
    try:
        file_content = await file.read()
        file_size = len(file_content)
        
        # Check file size
        if file_size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File size exceeds maximum allowed size of 50MB"
            )
        
        # Generate unique file path
        timestamp = datetime.utcnow().timestamp()
        safe_filename = file.filename.replace(" ", "_").replace("/", "_").replace("\\", "_")
        file_path = f"task-attachments/{task_id}/{current_user['id']}/{timestamp}-{safe_filename}"
        
        # Try to create bucket if it doesn't exist
        try:
            db.storage.create_bucket("task-attachments", {"public": True})
        except Exception as bucket_error:
            logger.debug(f"Bucket creation attempt: {bucket_error}")
        
        # Upload to Supabase Storage
        storage_response = db.storage.from_("task-attachments").upload(
            file_path,
            file_content,
            file_options={"content-type": content_type, "upsert": "false"}
        )
        
        if not storage_response:
            raise HTTPException(status_code=500, detail="Failed to upload file")
        
        # Get public URL
        try:
            file_url_response = db.storage.from_("task-attachments").get_public_url(file_path)
            file_url = file_url_response if isinstance(file_url_response, str) else file_url_response.get("publicUrl", "")
        except Exception as url_error:
            logger.warning(f"Failed to get public URL, constructing manually: {url_error}")
            from app.config import settings
            file_url = f"{settings.supabase_url}/storage/v1/object/public/task-attachments/{file_path}"
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"File upload error: {e}")
        error_msg = str(e)
        if "bucket" in error_msg.lower() or "not found" in error_msg.lower():
            raise HTTPException(
                status_code=500,
                detail="Storage bucket 'task-attachments' not found. Please create it in Supabase Dashboard > Storage."
            )
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {error_msg}")
    
    # Create attachment record
    attachment_data = {
        "task_id": str(task_id),
        "uploaded_by": current_user["id"],
        "file_name": file.filename,
        "file_url": file_url,
        "file_size": file_size,
        "file_type": content_type,
        "file_category": file_category
    }
    
    response = db.table("task_attachments").insert(attachment_data).execute()
    
    if not response.data:
        raise HTTPException(status_code=500, detail="Failed to create attachment record")
    
    return TaskAttachmentResponse(**response.data[0])


@router.delete("/task-attachments/{attachment_id}")
@handle_api_errors("delete task attachment")
async def delete_task_attachment(
    attachment_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Delete a task attachment (only by uploader)."""
    attachment_check = db.table("task_attachments").select("*").eq("id", str(attachment_id)).execute()
    
    if not attachment_check.data:
        raise HTTPException(status_code=404, detail="Attachment not found")
    
    attachment = attachment_check.data[0]
    
    # Only allow deletion if user is the uploader
    if attachment["uploaded_by"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="You can only delete attachments you uploaded")
    
    # Delete file from storage
    if attachment.get("file_url"):
        try:
            # Extract file path from URL
            file_path = attachment["file_url"].split("/task-attachments/")[-1] if "/task-attachments/" in attachment["file_url"] else None
            if file_path:
                db.storage.from_("task-attachments").remove([file_path])
        except Exception as e:
            logger.warning(f"Failed to delete file from storage: {e}")
    
    # Delete attachment record
    db.table("task_attachments").delete().eq("id", str(attachment_id)).execute()
    
    return {"message": "Attachment deleted successfully"}

