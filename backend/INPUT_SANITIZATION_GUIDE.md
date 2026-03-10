# Input Sanitization Implementation Guide

## Overview

Input sanitization has been implemented to protect against XSS (Cross-Site Scripting), SQL injection, and other injection attacks. This guide shows how to apply sanitization to API endpoints.

## Available Sanitization Functions

Located in `backend/app/utils/sanitization.py`:

### 1. `sanitize_html_content(content: str) -> str`

**Use for**: Rich text content from ReactQuill editor (notes, task descriptions)

**What it does**: Preserves safe HTML tags while removing dangerous content

**Example**:
```python
from app.utils.sanitization import sanitize_html_content

@router.post("/notes")
async def create_note(note: NoteCreate, ...):
    # Sanitize rich text content
    safe_content = sanitize_html_content(note.content)

    note_data = {
        "title": note.title,
        "content": safe_content,  # Use sanitized version
        ...
    }
```

### 2. `sanitize_text_input(text: str) -> str`

**Use for**: Plain text fields (titles, names, descriptions)

**What it does**: Escapes HTML entities

**Example**:
```python
from app.utils.sanitization import sanitize_text_input

@router.post("/tasks")
async def create_task(task: TaskCreate, ...):
    safe_title = sanitize_text_input(task.title)
    safe_description = sanitize_text_input(task.description)

    task_data = {
        "title": safe_title,
        "description": safe_description,
        ...
    }
```

### 3. `sanitize_url(url: str) -> Optional[str]`

**Use for**: URLs in task attachments, links, external references

**What it does**: Validates and sanitizes URLs, blocks javascript: and data: URIs

**Example**:
```python
from app.utils.sanitization import sanitize_url

@router.post("/quick-access")
async def create_link(link: QuickAccessCreate, ...):
    safe_url = sanitize_url(link.url)

    if not safe_url:
        raise HTTPException(status_code=400, detail="Invalid URL")

    link_data = {
        "name": link.name,
        "url": safe_url,
        ...
    }
```

### 4. `sanitize_filename(filename: str) -> str`

**Use for**: File uploads, attachment names

**What it does**: Prevents directory traversal attacks

**Example**:
```python
from app.utils.sanitization import sanitize_filename

@router.post("/attachments/upload")
async def upload_file(file: UploadFile, ...):
    safe_filename = sanitize_filename(file.filename)

    # Upload with sanitized filename
    storage_path = f"attachments/{task_id}/{safe_filename}"
```

### 5. `sanitize_sql_like_pattern(pattern: str) -> str`

**Use for**: Search functionality with LIKE queries

**What it does**: Escapes SQL special characters

**Example**:
```python
from app.utils.sanitization import sanitize_sql_like_pattern

@router.get("/tasks/search")
async def search_tasks(query: str, ...):
    safe_query = sanitize_sql_like_pattern(query)

    # Use in database query
    results = db.table("tasks").select("*").ilike("title", f"%{safe_query}%")
```

## Priority Endpoints to Sanitize

### HIGH PRIORITY (User-Generated Content)

1. **Notes API** (`app/api/notes.py`)
   - `POST /notes` - Sanitize `content` (HTML), `title` (text)
   - `PUT /notes/{id}` - Sanitize `content` (HTML), `title` (text)

2. **Tasks API** (`app/api/tasks.py`)
   - `POST /tasks` - Sanitize `title` (text), `description` (text)
   - `PUT /tasks/{id}` - Sanitize `title` (text), `description` (text)

3. **Quick Access API** (`app/api/quick_access.py`)
   - `POST /quick-access` - Sanitize `name` (text), `url` (URL)
   - `PUT /quick-access/{id}` - Sanitize `name` (text), `url` (URL)

4. **Task Attachments** (`app/api/task_attachments.py`)
   - `POST /attachments/upload` - Sanitize `filename`

5. **Jobs API** (`app/api/jobs.py`)
   - `POST /jobs` - Sanitize `job_name` (text)

### MEDIUM PRIORITY

6. **Dashboard API** (`app/api/dashboard.py`)
   - Any text fields in widget configurations

7. **UPCs API** (`app/api/upcs.py`)
   - Search functionality - Sanitize search terms

## Implementation Example

Here's a complete example for the Notes API:

```python
# app/api/notes.py
from app.utils.sanitization import sanitize_html_content, sanitize_text_input

@router.post("/notes")
async def create_note(
    note: NoteCreate,
    current_user: dict = Depends(get_current_user),
    db: Client = Depends(get_supabase)
):
    """Create a new note with sanitized content."""

    # Sanitize inputs
    safe_title = sanitize_text_input(note.title)
    safe_content = sanitize_html_content(note.content)

    note_data = {
        "title": safe_title,
        "content": safe_content,
        "user_id": current_user["id"],
        "is_private": note.is_private,
    }

    # Handle password protection
    if note.password:
        # Password doesn't need sanitization (bcrypt handles it)
        hashed_password = bcrypt.hashpw(
            note.password.encode('utf-8'),
            bcrypt.gensalt()
        )
        note_data["password_hash"] = hashed_password.decode('utf-8')

    response = db.table("notes").insert(note_data).execute()
    return response.data[0]
```

## Testing Sanitization

Create tests to verify sanitization works:

```python
# tests/test_utils/test_sanitization.py
from app.utils.sanitization import sanitize_html_content, sanitize_text_input

def test_xss_prevention():
    """Ensure XSS attacks are blocked."""
    malicious_input = '<script>alert("xss")</script><p>Safe</p>'
    result = sanitize_html_content(malicious_input)
    assert '<script>' not in result
    assert '<p>Safe</p>' in result

def test_javascript_uri_blocked():
    """Ensure javascript: URIs are blocked."""
    malicious_url = 'javascript:alert("xss")'
    result = sanitize_url(malicious_url)
    assert result is None
```

## Frontend Considerations

While backend sanitization is critical, also implement client-side validation:

1. **ReactQuill**: Already provides some XSS protection
2. **URL Validation**: Validate URLs in forms before submission
3. **File Uploads**: Validate file types and sizes on frontend

## Next Steps

1. ✅ Install bleach: `pip install bleach==6.1.0`
2. ✅ Create sanitization utilities
3. ⬜ Apply sanitization to HIGH PRIORITY endpoints
4. ⬜ Apply sanitization to MEDIUM PRIORITY endpoints
5. ⬜ Write tests for sanitization
6. ⬜ Update Pydantic models to include validation
7. ⬜ Add frontend validation

## Security Best Practices

1. **Defense in Depth**: Sanitize on both frontend and backend
2. **Whitelist Approach**: Only allow known-safe content
3. **Context-Aware**: Use appropriate sanitization for each field type
4. **Regular Updates**: Keep bleach library updated
5. **Security Audits**: Regularly review sanitization implementation

## Additional Resources

- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [Bleach Documentation](https://bleach.readthedocs.io/)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
