# FastAPI Keepa Dashboard - Project Structure

## Overview
This document provides a comprehensive overview of the project directory structure for the FastAPI Keepa Dashboard application. The project is divided into two main parts: backend (FastAPI/Python) and frontend (React/TypeScript).

---

## Root Directory

```
FastAPI-Keepa-Dashboard/
├── backend/                    # Backend API server
├── frontend/                   # Frontend React application
├── README.md                   # Project documentation
├── STARTUP_TROUBLESHOOTING.md  # Troubleshooting guide
├── start-dev.bat              # Windows batch script to start development
├── start-dev.ps1              # PowerShell script to start development
├── stop-dev.bat               # Windows batch script to stop development
├── stop-dev.ps1               # PowerShell script to stop development
├── check-dev.ps1              # PowerShell script to check development status
├── project_structure.txt      # Generated project structure (raw)
└── project_files.txt          # Generated project files list (raw)
```

---

## Backend Structure

### Backend Root (`backend/`)

```
backend/
├── app/                       # Main application directory
├── database/                  # Database schema and migration files
├── scripts/                   # Utility scripts
├── venv/                      # Python virtual environment (excluded from git)
└── requirements.txt           # Python dependencies
```

### Application Directory (`backend/app/`)

```
backend/app/
├── __init__.py               # App initialization
├── main.py                   # FastAPI application entry point
├── config.py                 # Configuration management
├── database.py               # Database connection setup
├── dependencies.py           # Dependency injection utilities
├── scheduler.py              # APScheduler job scheduling
│
├── api/                      # API route handlers
│   ├── __init__.py
│   ├── auth.py              # Authentication endpoints
│   ├── batches.py           # Batch job endpoints
│   ├── dashboard.py         # Dashboard data endpoints
│   ├── jobs.py              # Keepa job endpoints
│   ├── map.py               # MAP (Minimum Advertised Price) endpoints
│   ├── notes.py             # User notes endpoints
│   ├── notifications.py     # Notification endpoints
│   ├── quick_access.py      # Quick access link endpoints
│   ├── reports.py           # Report generation endpoints
│   ├── scheduler.py         # Scheduler management endpoints
│   ├── task_attachments.py  # Task attachment endpoints
│   ├── task_validations.py  # Task validation endpoints
│   ├── tasks.py             # Task management endpoints
│   ├── tools.py             # Tool management endpoints
│   └── upcs.py              # UPC management endpoints
│
├── models/                   # Pydantic models and schemas
│   ├── __init__.py
│   ├── batch.py             # Batch job models
│   ├── dashboard_widget.py  # Dashboard widget models
│   ├── job_aid.py           # Job aid models
│   ├── keepa.py             # Keepa API models
│   ├── map.py               # MAP models
│   ├── note.py              # Note models
│   ├── notification.py      # Notification models
│   ├── price_alert.py       # Price alert models
│   ├── public_tool.py       # Public tool models
│   ├── quick_access.py      # Quick access models
│   ├── subtask.py           # Subtask models
│   ├── task.py              # Task models
│   ├── task_attachment.py   # Task attachment models
│   ├── task_validation.py   # Task validation models
│   ├── upc.py               # UPC models
│   ├── user.py              # User models
│   └── user_tool.py         # User tool models
│
├── repositories/             # Data access layer
│   ├── batch_repository.py  # Batch data access
│   ├── job_repository.py    # Job data access
│   ├── map_repository.py    # MAP data access
│   ├── note_repository.py   # Note data access
│   ├── report_repository.py # Report data access
│   └── upc_repository.py    # UPC data access
│
├── services/                 # Business logic layer
│   ├── __init__.py
│   ├── batch_processor.py   # Batch processing logic
│   ├── csv_generator.py     # CSV file generation
│   ├── email_service.py     # Email notification service
│   ├── job_status_service.py # Job status management
│   ├── keepa_client.py      # Keepa API client
│   ├── price_analyzer.py    # Price analysis logic
│   └── report_service.py    # Report generation service
│
└── utils/                    # Utility functions
    ├── error_handler.py     # Error handling utilities
    ├── notifications.py     # Notification utilities
    └── permissions.py       # Permission checking utilities
```

### Database Directory (`backend/database/`)

```
backend/database/
├── schema.sql                              # Main database schema
├── add_can_assign_tasks_field.sql          # Add task assignment permission
├── add_can_manage_tools_field.sql          # Add tool management permission
├── add_display_name.sql                    # Add display name field
├── add_keepa_access_field.sql              # Add Keepa access permission
├── batch_jobs_migration_add_fields.sql     # Batch jobs migration
├── check_and_add_display_name.sql          # Check display name migration
├── check_notifications_table.sql           # Check notifications setup
├── dashboard_widgets_schema.sql            # Dashboard widgets table
├── ENSURE_USER_ISOLATION.sql               # User data isolation policies
├── job_aids_migration_add_video_url.sql    # Job aids video support
├── job_aids_schema.sql                     # Job aids table
├── map_schema.sql                          # MAP table
├── notes_migration_add_category.sql        # Notes category field
├── notes_migration_add_color.sql           # Notes color field
├── notes_migration_add_importance.sql      # Notes importance field
├── notes_migration_add_password.sql        # Notes password protection
├── notes_migration_add_position.sql        # Notes position field
├── notes_migration_add_protection.sql      # Notes protection field
├── notes_migration_add_require_password_always.sql
├── notes_schema.sql                        # Notes table
├── notifications_schema.sql                # Notifications table
├── profile_fields_migration.sql            # Profile fields migration
├── profile_insert_policy.sql               # Profile insert policy
├── public_tools_migration_add_video_url.sql # Public tools video support
├── public_tools_schema.sql                 # Public tools table
├── quick_access_schema.sql                 # Quick access links table
├── scheduler_settings_add_category.sql     # Scheduler category field
├── scheduler_settings_schema.sql           # Scheduler settings table
├── subtasks_add_assigned_to.sql            # Subtask assignment field
├── subtasks_rls_team_visibility.sql        # Subtask visibility policies
├── subtasks_schema.sql                     # Subtasks table
├── task_attachments_rls_team_visibility.sql
├── task_attachments_schema.sql             # Task attachments table
├── task_attachments_storage_setup.sql      # Task attachment storage
├── task_validations_rls_team_visibility.sql
├── task_validations_schema.sql             # Task validations table
├── task_validations_storage_setup.sql      # Task validation storage
├── tasks_add_urgent_field.sql              # Task urgency field
├── tasks_migration_add_assigned_to.sql     # Task assignment field
├── tasks_migration_add_purpose.sql         # Task purpose field
├── tasks_rls_team_visibility.sql           # Task visibility policies
├── tasks_schema.sql                        # Tasks table
├── tasks_team_visibility_migration.sql     # Team visibility migration
├── upcs_add_category.sql                   # UPC category field
├── user_toolbox_migration_add_job_aids.sql # User toolbox job aids
├── user_toolbox_schema.sql                 # User toolbox table
├── user_tools_add_developer.sql            # Developer tools field
├── user_tools_schema.sql                   # User tools table
└── verify_user_isolation.sql               # Verify data isolation
```

---

## Frontend Structure

### Frontend Root (`frontend/`)

```
frontend/
├── public/                   # Static assets
├── src/                      # Source code
├── node_modules/            # NPM dependencies (excluded from git)
├── index.html               # HTML entry point
├── package.json             # NPM dependencies and scripts
├── package-lock.json        # Locked NPM dependencies
├── postcss.config.js        # PostCSS configuration
├── tailwind.config.js       # Tailwind CSS configuration
├── tsconfig.json            # TypeScript configuration
├── tsconfig.node.json       # TypeScript Node configuration
└── vite.config.ts           # Vite build configuration
```

### Source Directory (`frontend/src/`)

```
frontend/src/
├── main.tsx                 # Application entry point
├── App.tsx                  # Root component
├── index.css                # Global styles
├── vite-env.d.ts           # Vite type definitions
│
├── components/              # React components
│   ├── Landing.tsx         # Landing page
│   │
│   ├── admin/              # Admin components
│   │   └── UserManagement.tsx
│   │
│   ├── auth/               # Authentication components
│   │   ├── Login.tsx
│   │   ├── Signup.tsx
│   │   └── ResetPassword.tsx
│   │
│   ├── common/             # Common/shared components
│   │   └── ProtectedRoute.tsx
│   │
│   ├── dashboard/          # Dashboard components
│   │   ├── BatchStatus.tsx
│   │   ├── CLKSchedulerCountdown.tsx
│   │   ├── Dashboard.tsx
│   │   ├── DNKSchedulerCountdown.tsx
│   │   ├── JobCard.tsx
│   │   ├── QuickAccess.tsx
│   │   ├── SchedulerCountdown.tsx
│   │   └── UPCMAPStats.tsx
│   │
│   ├── jobs/               # Job management components
│   │   ├── CLKDailyRun.tsx
│   │   ├── CreateJob.tsx
│   │   ├── DailyRun.tsx
│   │   ├── DNKDailyRun.tsx
│   │   ├── JobDetail.tsx
│   │   └── JobList.tsx
│   │
│   ├── layout/             # Layout components
│   │   ├── Layout.tsx
│   │   ├── Navbar.tsx
│   │   └── Sidebar.tsx
│   │
│   ├── map/                # MAP management components
│   │   └── MAPManagement.tsx
│   │
│   ├── notes/              # Notes components
│   │   ├── index.ts
│   │   ├── MyNotes.tsx
│   │   ├── NoteCard.tsx
│   │   └── PasswordModal.tsx
│   │
│   ├── notifications/      # Notification components
│   │   └── Notifications.tsx
│   │
│   ├── reports/            # Report components
│   │   ├── ReportList.tsx
│   │   └── ReportView.tsx
│   │
│   ├── tasks/              # Task management components
│   │   ├── index.ts
│   │   ├── SubtaskList.tsx
│   │   ├── TaskDetail.tsx
│   │   ├── TaskFilters.tsx
│   │   └── TeamTasks.tsx
│   │
│   ├── tools/              # Tool components
│   │   ├── JobAids.tsx
│   │   ├── MyToolbox.tsx
│   │   └── PublicTools.tsx
│   │
│   └── upcs/               # UPC management components
│       └── UPCManagement.tsx
│
├── contexts/                # React contexts
│   └── UserContext.tsx     # User authentication context
│
├── hooks/                   # Custom React hooks
│   ├── index.ts
│   ├── useAuth.ts
│   ├── useNoteProtection.ts
│   ├── usePermissions.ts
│   └── useTaskManagement.ts
│
├── lib/                     # Third-party library setup
│   └── supabase.ts         # Supabase client configuration
│
├── services/                # API service layer
│   └── api.ts              # API client and endpoints
│
├── types/                   # TypeScript type definitions
│   └── index.ts            # Shared type definitions
│
└── utils/                   # Utility functions
    ├── index.ts
    ├── noteUtils.ts
    ├── statusColors.ts
    └── taskUtils.ts
```

---

## Key Technology Stack

### Backend
- **Framework**: FastAPI (Python)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Scheduling**: APScheduler
- **Email**: SMTP (email notifications)
- **External APIs**: Keepa API

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Routing**: React Router v6
- **HTTP Client**: Axios
- **State Management**: React Context API
- **Rich Text Editor**: React Quill (for notes)

---

## Development Scripts

### Backend
```bash
cd backend
python -m uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm run dev
```

### Combined (PowerShell)
```powershell
.\start-dev.ps1    # Start both backend and frontend
.\stop-dev.ps1     # Stop both servers
.\check-dev.ps1    # Check server status
```

---

## Environment Configuration

### Backend Environment Variables
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_KEY`: Supabase service key
- `KEEPA_API_KEY`: Keepa API key
- `SMTP_*`: Email configuration variables

### Frontend Environment Variables
- `VITE_SUPABASE_URL`: Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Supabase anonymous key
- `VITE_API_URL`: Backend API URL (default: http://localhost:8000)

---

## Features

### Core Features
1. **Authentication & Authorization**
   - User registration and login
   - Role-based access control (superadmin, regular user)
   - Keepa access permissions

2. **Keepa Alert Services**
   - Express job creation and management
   - UPC management (DNK and CLK categories)
   - MAP (Minimum Advertised Price) tracking
   - Daily scheduled runs (DNK and CLK)
   - Batch processing

3. **Dashboard**
   - Quick access links
   - Job statistics
   - UPC and MAP stats
   - Scheduler countdowns

4. **Task Management**
   - Create and assign tasks
   - Subtask support with user assignment
   - Task validation and attachments
   - Team-wide visibility
   - Urgent task flagging

5. **Notes**
   - Personal note taking
   - Rich text formatting
   - Color coding and categories
   - Password protection
   - Importance levels

6. **Resources**
   - Public tools directory
   - Job aids with video support
   - Personal toolbox

7. **Notifications**
   - Real-time notifications
   - Task assignment alerts
   - System notifications

8. **Reports**
   - Job report generation
   - CSV export functionality

---

## Database Schema Highlights

### Main Tables
- `profiles`: User profiles and permissions
- `batch_jobs`: Keepa batch jobs
- `upcs`: UPC codes with category support (DNK/CLK)
- `map`: Minimum Advertised Price records
- `tasks`: Team tasks with assignment
- `subtasks`: Task subtasks with user assignment
- `notes`: User notes with protection
- `notifications`: User notifications
- `scheduler_settings`: Automated job scheduling
- `quick_access`: Dashboard quick links
- `public_tools`: Shared tool resources
- `user_tools`: Personal toolbox
- `job_aids`: Training resources

### Security Features
- Row Level Security (RLS) policies
- User data isolation
- Team-based visibility controls
- Password-protected notes

---

## API Endpoints Overview

### Authentication
- `POST /auth/signup` - User registration
- `POST /auth/login` - User login
- `GET /auth/user` - Get current user

### Jobs
- `GET /jobs` - List jobs
- `POST /jobs` - Create job
- `GET /jobs/{id}` - Get job details
- `PUT /jobs/{id}` - Update job

### UPCs
- `GET /upcs` - List UPCs
- `POST /upcs` - Add UPC
- `PUT /upcs/{id}` - Update UPC
- `DELETE /upcs/{id}` - Delete UPC
- `POST /upcs/upload` - Bulk upload

### Tasks
- `GET /tasks` - List tasks
- `POST /tasks` - Create task
- `PUT /tasks/{id}` - Update task
- `DELETE /tasks/{id}` - Delete task

### Notes
- `GET /notes` - List notes
- `POST /notes` - Create note
- `PUT /notes/{id}` - Update note
- `DELETE /notes/{id}` - Delete note

### Scheduler
- `GET /scheduler/settings` - Get scheduler settings
- `PUT /scheduler/settings` - Update scheduler
- `POST /scheduler/run-now` - Trigger manual run

---

## Build and Deployment

### Backend Build
The backend is deployed as a Python application with:
- Virtual environment for dependencies
- Uvicorn ASGI server
- Environment-based configuration

### Frontend Build
```bash
cd frontend
npm run build
```
Produces optimized static files in `frontend/dist/`

---

## Documentation Files
- `README.md`: Project overview and setup instructions
- `STARTUP_TROUBLESHOOTING.md`: Common issues and solutions
- `PROJECT_STRUCTURE.md`: This file - comprehensive project structure
- `backend/scripts/README.md`: Backend utility scripts documentation

---

## Version Control

### Git Ignored Files/Directories
- `node_modules/` - Frontend dependencies
- `backend/venv/` - Python virtual environment
- `backend/__pycache__/` - Python bytecode
- `frontend/dist/` - Build output
- `.env` - Environment variables
- `.idea/` - IDE configuration

---

## License & Credits
This project is built for Orbit Hub using modern web technologies and best practices.

**Generated**: 2026-01-15
**Last Updated**: 2026-01-15
