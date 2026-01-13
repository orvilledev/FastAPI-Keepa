# Orbit

A comprehensive full-stack productivity platform built with FastAPI and React. Features task management, note-taking with rich text editor, team collaboration, and integrated Keepa price monitoring services.

## 🚀 What's New

### v2.0 - Major Update

#### Branding & UI
- **Rebranded to "Orbit"** - New app name with "Orbit Hub" as the central workspace
- **New Color Scheme** - Modern dark navy theme (`#0B1020`) throughout the app
- **Custom SVG Icons** - All sidebar icons now use SVG icons that inherit text color
- **New Logo** - Custom Orbit logo with planet and orbital ring design
- **Improved Sidebar** - Dynamic icon colors that change with hover/active states

#### Performance Optimizations
- **Lazy Loading** - All page components are now lazy-loaded for faster initial load
- **UserContext** - Centralized user state management eliminates duplicate API calls
- **Cached Auth Tokens** - Auth tokens are cached to avoid repeated session fetches
- **Memoized Content** - Protected note content is memoized to avoid expensive recomputation
- **Dynamic CSS Loading** - ReactQuill CSS loads only when the editor is needed

#### New Features
- **My Notes** - Personal note-taking with rich text editor (ReactQuill)
  - Password protection with optional "always require password" mode
  - Content masking for sensitive information
  - Category organization and filtering
  - Color-coded note borders
  - Importance levels (Low, Normal, High, Urgent)
- **Team Tasks** - Collaborative task management
  - Task assignments
  - File attachments
  - Task validations
  - Purpose field for context
  - Urgent flag
- **Notifications System** - Real-time notifications for task activities
  - Task assignment notifications
  - Task completion notifications
  - Unread notification count
  - Mark as read / mark all as read
  - Notification deletion
- **Job Aids** - Video tutorials and documentation
- **MAP Management** - Minimum Advertised Price tracking

## Architecture

- **Backend**: FastAPI (Python) on Render
- **Frontend**: React + TypeScript + Vite + Tailwind CSS on Vercel
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Scheduler**: APScheduler for daily automation at 8 PM Taipei time

## Features

### Core Features
- Process 2500 UPCs in 21 batches (~119 UPCs per batch)
- Detect sellers with lowered prices (off-price sellers)
- Generate CSV reports with price alerts
- **Multiple email recipients** - Send reports to multiple email addresses (comma-separated)
- **Automatic email delivery** - Emails sent automatically when jobs complete
- **Daily automated job execution** - Runs daily at 8 PM Taipei time (UTC+8)
- **Stop batch functionality** - Cancel pending or processing batches
- Real-time job status tracking
- User authentication and authorization
- Admin and user roles
- Enhanced error handling with detailed error messages

### Dashboard Features
- **Personalized Dashboard** - Welcome message with user's display name
- **Quick Access Widget** - Add and manage quick access links
- **Scheduler Countdown** - Real-time countdown to next daily email run
- **Drag-and-Drop Widgets** - Customize dashboard layout with persistent widget order
- **Widget Persistence** - Dashboard arrangement saved per user
- **UPC/MAP Statistics** - View counts of UPCs and MAP prices

### My Notes
- **Rich Text Editor** - Full formatting with ReactQuill (headers, bold, italic, lists, links, colors)
- **Password Protection** - Secure notes with password (min 7 characters)
- **Password Generator** - Generate strong 16-character passwords
- **Content Masking** - Blur and mask sensitive content
- **Always Require Password** - Optional setting to require password every time
- **Categories** - Organize notes by category with filtering
- **Color Coding** - Choose from 9 border colors (yellow, pink, blue, green, orange, red, teal, gray, indigo)
- **Importance Levels** - Low, Normal, High, Urgent
- **Search** - Full-text search across title and content
- **Pagination** - 20 notes per page with navigation

### Task Management
- **Team Tasks** - Collaborative task management with assignments
- **Subtasks** - Create and manage subtasks for each task
- **Task Filtering** - Filter by status (pending, in_progress, completed)
- **Priority Levels** - Set task priority (low, medium, high)
- **Due Dates** - Track task deadlines with overdue warnings
- **Status Tracking** - Quick status updates and completion tracking
- **File Attachments** - Attach files to tasks
- **Task Validations** - Add validation criteria to tasks
- **Purpose Field** - Add context and purpose to tasks
- **Urgent Flag** - Mark tasks as urgent
- **Task Notifications** - Automatic notifications for task assignments and completions
- **Email Notifications** - Email alerts when assigned tasks are completed

### Tools Management
- **Public Tools** - Admin-managed public tool directory with video URLs
- **Job Aids** - Video tutorials and documentation resources
- **My Toolbox** - Personal tool collection
- **Tool Starring** - Star public tools to add to your toolbox
- **Create Personal Tools** - Users can create their own tools
- **Category Filtering** - Filter tools by category
- **Tool Editing** - Admins can edit public tools
- **Developer Attribution** - Track tool developers

### Access Control
- **Orbit Hub Access** - Restricted access to chosen accounts only
- **User Data Isolation** - Users can only see their own data (Dashboard, Tasks, Tools, Notes)
- **Row Level Security (RLS)** - Database-level security policies
- **Protected Routes** - Frontend route protection for sensitive features
- **Role-Based Access** - Admin and user role management
- **Can Manage Tools** - Permission to manage public tools
- **Can Assign Tasks** - Permission to assign tasks to others

### User Profile
- **Display Name** - Customizable user display name
- **Profile Management** - Update profile information
- **Business Details** - Store company and contact information

### Notifications
- **Real-time Notifications** - Get notified about important task activities
- **Task Assignment Alerts** - Notified when tasks are assigned to you
- **Task Completion Alerts** - Notified when assigned tasks are completed
- **Unread Count** - Track number of unread notifications
- **Mark as Read** - Mark individual or all notifications as read
- **Notification Management** - Delete notifications you no longer need
- **Email Integration** - Email notifications for task completions

## Setup

### Backend Setup

1. Navigate to backend directory:
   ```bash
   cd backend
   ```

2. Create virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Create `.env` file:
   ```env
   # Keepa API Configuration
   KEEPA_API_KEY=your_keepa_api_key
   KEEPA_API_URL=https://api.keepa.com/
   
   # Supabase Configuration
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_service_key
   
   # Email Configuration
   EMAIL_SMTP_HOST=smtp.gmail.com
   EMAIL_SMTP_PORT=587
   EMAIL_FROM=your-email@gmail.com
   EMAIL_PASSWORD=your_gmail_app_password  # Must be Gmail App Password, not regular password
   EMAIL_TO=email1@domain.com,email2@domain.com  # Comma-separated for multiple recipients
   
   # Application Configuration
   ENVIRONMENT=development
   API_V1_STR=/api/v1
   CORS_ORIGINS=http://localhost:5173,http://localhost:3000
   
   # Scheduler Configuration (8 PM Taipei time)
   SCHEDULER_HOUR=20
   SCHEDULER_MINUTE=0
   ```

   **Important Notes:**
   - For Gmail, you must use an **App Password**, not your regular password
   - Generate App Password at: https://myaccount.google.com/apppasswords
   - 2-Step Verification must be enabled to generate App Passwords
   - `EMAIL_TO` can contain multiple recipients separated by commas

5. Run database migrations (execute `backend/database/schema.sql` in Supabase SQL Editor)

6. Run the server:
   ```bash
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```

### Frontend Setup

1. Navigate to frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` file:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   VITE_API_URL=http://localhost:8000
   ```

4. Run development server:
   ```bash
   npm run dev
   ```

## Database Schema

### Initial Setup

Run the SQL file `backend/database/schema.sql` in your Supabase SQL Editor to create all necessary tables and RLS policies.

After running the schema, also create the `handle_new_user` trigger:

```sql
-- Create trigger function for new user registration
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'user');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

### Additional Database Migrations

Run these additional migration files in your Supabase SQL Editor (in order):

1. **Profile Fields** - `backend/database/profile_fields_migration.sql`
   - Adds profile fields (full_name, company_name, phone, address, etc.)

2. **Display Name** - `backend/database/add_display_name.sql`
   - Adds `display_name` field to profiles

3. **Keepa Access Control** - `backend/database/add_keepa_access_field.sql`
   - Adds `has_keepa_access` field to profiles for access control

4. **Can Manage Tools** - `backend/database/add_can_manage_tools_field.sql`
   - Adds `can_manage_tools` field to profiles

5. **Can Assign Tasks** - `backend/database/add_can_assign_tasks_field.sql`
   - Adds `can_assign_tasks` field to profiles

6. **Public Tools** - `backend/database/public_tools_schema.sql`
   - Creates `public_tools` table for admin-managed tools
   - Then run `backend/database/public_tools_migration_add_video_url.sql` for video support

7. **User Toolbox** - `backend/database/user_toolbox_schema.sql`
   - Creates `user_toolbox` table for starred tools
   - Then run `backend/database/user_toolbox_migration_add_job_aids.sql` for job aids

8. **User Tools** - `backend/database/user_tools_schema.sql`
   - Creates `user_tools` table for personal tools
   - Then run `backend/database/user_tools_add_developer.sql` to add developer field

9. **Job Aids** - `backend/database/job_aids_schema.sql`
   - Creates `job_aids` table
   - Then run `backend/database/job_aids_migration_add_video_url.sql` for video support

10. **Quick Access Links** - `backend/database/quick_access_schema.sql`
    - Creates `quick_access_links` table for dashboard quick access

11. **Notes** - `backend/database/notes_schema.sql`
    - Creates `notes` table for personal notes
    - Run these migrations in order:
      - `backend/database/notes_migration_add_category.sql`
      - `backend/database/notes_migration_add_color.sql`
      - `backend/database/notes_migration_add_importance.sql`
      - `backend/database/notes_migration_add_protection.sql`
      - `backend/database/notes_migration_add_password.sql`
      - `backend/database/notes_migration_add_position.sql`
      - `backend/database/notes_migration_add_require_password_always.sql`

12. **Tasks** - `backend/database/tasks_schema.sql`
    - Creates `tasks` table for task management
    - Run these migrations:
      - `backend/database/tasks_migration_add_assigned_to.sql`
      - `backend/database/tasks_migration_add_purpose.sql`
      - `backend/database/tasks_add_urgent_field.sql`
      - `backend/database/tasks_rls_team_visibility.sql`
      - `backend/database/tasks_team_visibility_migration.sql`

13. **Subtasks** - `backend/database/subtasks_schema.sql`
    - Creates `subtasks` table for task subtasks
    - Then run `backend/database/subtasks_rls_team_visibility.sql`

14. **Task Attachments** - `backend/database/task_attachments_schema.sql`
    - Creates `task_attachments` table
    - Then run:
      - `backend/database/task_attachments_storage_setup.sql`
      - `backend/database/task_attachments_rls_team_visibility.sql`

15. **Task Validations** - `backend/database/task_validations_schema.sql`
    - Creates `task_validations` table
    - Then run:
      - `backend/database/task_validations_storage_setup.sql`
      - `backend/database/task_validations_rls_team_visibility.sql`

16. **MAP Prices** - `backend/database/map_schema.sql`
    - Creates `map_prices` table for MAP tracking

17. **Dashboard Widgets** - `backend/database/dashboard_widgets_schema.sql`
    - Creates `dashboard_widgets` table for widget order persistence

18. **Scheduler Settings** - `backend/database/scheduler_settings_schema.sql`
    - Creates `scheduler_settings` table

19. **User Isolation Verification** - `backend/database/ENSURE_USER_ISOLATION.sql`
    - Ensures all RLS policies are properly configured for user data isolation

20. **Verify User Isolation** - `backend/database/verify_user_isolation.sql`
    - Verification script for RLS policies

21. **Notifications** - `backend/database/notifications_schema.sql`
    - Creates `notifications` table for user notifications
    - Supports task assignments, completions, and other notification types

### Granting Orbit Hub Access

To grant access to specific users:

```sql
-- Grant Orbit Hub access to a specific user by email
UPDATE profiles 
SET has_keepa_access = true 
WHERE email = 'user@example.com';

-- Grant tools management permission
UPDATE profiles 
SET can_manage_tools = true 
WHERE email = 'user@example.com';

-- Grant task assignment permission
UPDATE profiles 
SET can_assign_tasks = true 
WHERE email = 'user@example.com';

-- Or grant all permissions to admins
UPDATE profiles 
SET has_keepa_access = true,
    can_manage_tools = true,
    can_assign_tasks = true
WHERE role = 'admin';
```

## API Endpoints

### Authentication
- `GET /api/v1/auth/me` - Get current user (includes role, display_name, has_keepa_access, can_manage_tools, can_assign_tasks)
- `GET /api/v1/auth/profile` - Get user profile
- `PUT /api/v1/auth/profile` - Update user profile
- `PATCH /api/v1/auth/me/display-name` - Update display name
- `GET /api/v1/auth/users` - Get all users (superadmin only)
- `PUT /api/v1/auth/users/{user_id}/keepa-access` - Update user's Orbit Hub access
- `PUT /api/v1/auth/users/{user_id}/tools-access` - Update user's tools management access
- `PUT /api/v1/auth/users/{user_id}/tasks-access` - Update user's task assignment access

### Jobs (Requires Orbit Hub Access)
- `POST /api/v1/jobs` - Create new job (admin only)
- `GET /api/v1/jobs` - List all jobs (users see their own, admins see all)
- `GET /api/v1/jobs/{job_id}` - Get job details
- `GET /api/v1/jobs/{job_id}/status` - Get job status
- `POST /api/v1/jobs/{job_id}/trigger` - Trigger job (admin)
- `DELETE /api/v1/jobs/{job_id}` - Delete job and all related data

### Batches (Requires Orbit Hub Access)
- `GET /api/v1/batches/{batch_id}` - Get batch details
- `GET /api/v1/batches/{batch_id}/items` - Get batch items
- `POST /api/v1/batches/{batch_id}/stop` - Stop/cancel a batch (pending or processing status, admin only)

### Reports (Requires Orbit Hub Access)
- `GET /api/v1/reports/{job_id}` - Get price alerts
- `GET /api/v1/reports/{job_id}/csv` - Download CSV
- `POST /api/v1/reports/{job_id}/email` - Resend email
- `POST /api/v1/reports/test-email` - Test email configuration (sends test email)

### UPCs (Requires Orbit Hub Access)
- `GET /api/v1/upcs` - Get all UPCs with pagination
- `GET /api/v1/upcs/count` - Get total UPC count
- `POST /api/v1/upcs` - Add new UPC
- `DELETE /api/v1/upcs/{upc_id}` - Delete UPC

### MAP (Requires Orbit Hub Access)
- `GET /api/v1/map` - Get all MAP prices with pagination
- `GET /api/v1/map/count` - Get total MAP count
- `POST /api/v1/map` - Add new MAP price
- `PUT /api/v1/map/{map_id}` - Update MAP price
- `DELETE /api/v1/map/{map_id}` - Delete MAP price

### Scheduler
- `GET /api/v1/scheduler/status` - Get scheduler status and next run time
- `GET /api/v1/scheduler/next-run` - Get next scheduled run time
- `PUT /api/v1/scheduler/settings` - Update scheduler settings

### Dashboard
- `GET /api/v1/dashboard/widgets` - Get user's dashboard widget preferences
- `POST /api/v1/dashboard/widgets/order` - Update widget order

### Quick Access Links
- `GET /api/v1/quick-access` - Get user's quick access links
- `POST /api/v1/quick-access` - Create quick access link
- `PUT /api/v1/quick-access/{link_id}` - Update quick access link
- `DELETE /api/v1/quick-access/{link_id}` - Delete quick access link

### Notes
- `GET /api/v1/notes` - Get user's notes with pagination and filtering
- `POST /api/v1/notes` - Create new note
- `PUT /api/v1/notes/{note_id}` - Update note
- `DELETE /api/v1/notes/{note_id}` - Delete note
- `POST /api/v1/notes/{note_id}/verify-password` - Verify note password

### Tasks
- `GET /api/v1/tasks` - Get tasks (filterable by status/priority/assigned)
- `POST /api/v1/tasks` - Create new task
- `GET /api/v1/tasks/{task_id}` - Get task details
- `PUT /api/v1/tasks/{task_id}` - Update task
- `DELETE /api/v1/tasks/{task_id}` - Delete task
- `GET /api/v1/tasks/{task_id}/subtasks` - Get task subtasks
- `POST /api/v1/tasks/{task_id}/subtasks` - Create subtask
- `PUT /api/v1/tasks/{task_id}/subtasks/{subtask_id}` - Update subtask
- `DELETE /api/v1/tasks/{task_id}/subtasks/{subtask_id}` - Delete subtask

### Task Attachments
- `GET /api/v1/tasks/{task_id}/attachments` - Get task attachments
- `POST /api/v1/tasks/{task_id}/attachments` - Upload attachment
- `DELETE /api/v1/tasks/{task_id}/attachments/{attachment_id}` - Delete attachment

### Task Validations
- `GET /api/v1/tasks/{task_id}/validations` - Get task validations
- `POST /api/v1/tasks/{task_id}/validations` - Create validation
- `PUT /api/v1/tasks/{task_id}/validations/{validation_id}` - Update validation
- `DELETE /api/v1/tasks/{task_id}/validations/{validation_id}` - Delete validation

### Tools
- `GET /api/v1/tools/public` - Get all public tools
- `POST /api/v1/tools/public` - Create public tool (admin only)
- `PUT /api/v1/tools/public/{tool_id}` - Update public tool (admin only)
- `DELETE /api/v1/tools/public/{tool_id}` - Delete public tool (admin only)
- `POST /api/v1/tools/public/{tool_id}/star` - Star a public tool
- `DELETE /api/v1/tools/public/{tool_id}/star` - Unstar a public tool
- `GET /api/v1/tools/public/starred` - Get starred tool IDs
- `GET /api/v1/tools/my-toolbox` - Get user's starred tools
- `GET /api/v1/tools/user` - Get user's personal tools
- `POST /api/v1/tools/user` - Create personal tool
- `PUT /api/v1/tools/user/{tool_id}` - Update personal tool
- `DELETE /api/v1/tools/user/{tool_id}` - Delete personal tool

### Job Aids
- `GET /api/v1/tools/job-aids` - Get all job aids
- `POST /api/v1/tools/job-aids` - Create job aid (admin only)
- `PUT /api/v1/tools/job-aids/{aid_id}` - Update job aid (admin only)
- `DELETE /api/v1/tools/job-aids/{aid_id}` - Delete job aid (admin only)

### Notifications
- `GET /api/v1/notifications` - Get user's notifications (with optional unread filter)
- `GET /api/v1/notifications/unread-count` - Get count of unread notifications
- `PUT /api/v1/notifications/{notification_id}/read` - Mark notification as read
- `PUT /api/v1/notifications/read-all` - Mark all notifications as read
- `DELETE /api/v1/notifications/{notification_id}` - Delete notification

## Deployment

### Backend (Render)

1. **Connect Repository:**
   - Go to https://render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub repository

2. **Configure Service:**
   - **Name**: `orbit-api` (or your choice)
   - **Region**: Choose closest to your users
   - **Branch**: `main`
   - **Root Directory**: `backend` ⚠️ **Important: Set this to `backend`**
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

3. **Set Environment Variables:**
   ```env
   KEEPA_API_KEY=your_production_keepa_api_key
   KEEPA_API_URL=https://api.keepa.com/
   SUPABASE_URL=your_production_supabase_url
   SUPABASE_KEY=your_production_supabase_service_key
   EMAIL_SMTP_HOST=smtp.gmail.com
   EMAIL_SMTP_PORT=587
   EMAIL_FROM=your-email@gmail.com
   EMAIL_PASSWORD=your_gmail_app_password
   EMAIL_TO=email1@domain.com,email2@domain.com
   ENVIRONMENT=production
   API_V1_STR=/api/v1
   CORS_ORIGINS=https://your-frontend-domain.vercel.app
   SCHEDULER_HOUR=20
   SCHEDULER_MINUTE=0
   ```

4. **Deploy**: Click "Create Web Service"

### Frontend (Vercel)

1. **Connect Repository:**
   - Go to https://vercel.com
   - Click "Add New..." → "Project"
   - Import your GitHub repository

2. **Configure Project:**
   - **Framework Preset**: `Vite`
   - **Root Directory**: `frontend` ⚠️ **Important: Set this to `frontend`**
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `dist` (auto-detected)

3. **Set Environment Variables:**
   ```env
   VITE_SUPABASE_URL=your_production_supabase_url
   VITE_SUPABASE_ANON_KEY=your_production_supabase_anon_key
   VITE_API_URL=https://your-backend-url.onrender.com
   ```

4. **Deploy**: Click "Deploy"

### Post-Deployment Steps

1. **Update Backend CORS:**
   - After getting your frontend URL from Vercel, update the `CORS_ORIGINS` environment variable in Render
   - Redeploy the backend service

2. **Verify Database:**
   - Ensure all database tables and RLS policies are set up in Supabase
   - Verify the `handle_new_user` trigger is created

3. **Test Production:**
   - Test authentication (sign up/login)
   - Test job creation
   - Test email delivery
   - Verify scheduler runs at 8 PM Taipei time

## Usage

### Getting Started
1. **Sign up or log in** to the dashboard
2. **Set your display name** (optional) - appears in welcome message
3. **Customize your dashboard** - drag and drop widgets, add quick access links

### My Notes
1. **Go to My Notes** - Access from "My Space" in sidebar
2. **Create notes** - Click "+ Add Note" to create a new note
3. **Use rich text formatting** - Headers, bold, italic, lists, links, colors
4. **Protect sensitive notes** - Enable password protection or content masking
5. **Organize with categories** - Add categories for easy filtering
6. **Search notes** - Use the search bar to find notes by title or content

### Orbit Hub Services (Requires Access)
1. **Request access** - Contact admin to grant `has_keepa_access` permission
2. **Create a new job** with UPCs (one per line, up to 2500)
3. **Monitor job progress** in real-time
4. **View reports** when job completes
5. **Download CSV** or **resend email** with report
6. **Stop batches** if needed (admin only)
7. **Manage UPCs** - Add/remove UPCs from the system
8. **Manage MAP** - Add/edit/delete MAP prices

### Task Management
1. **Go to Tasks** - Access from "My Space" in sidebar
2. **Create tasks** - Add title, description, priority, due date, and purpose
3. **Assign tasks** - Assign tasks to team members (they'll receive notifications)
4. **Add subtasks** - Break down tasks into smaller items
5. **Attach files** - Upload relevant files to tasks
6. **Add validations** - Create validation criteria
7. **Track progress** - Update status and mark items complete
8. **Filter tasks** - View by status (All, Pending, In Progress, Completed)
9. **Receive notifications** - Get notified when tasks are assigned to you or completed

### Tools Management
1. **Browse Public Tools** - View admin-managed tools
2. **Watch Job Aids** - View video tutorials and documentation
3. **Star tools** - Add useful tools to your toolbox
4. **Create personal tools** - Add your own tools in My Toolbox
5. **Filter by category** - Use category filters to find tools
6. **Edit tools** - Admins can edit public tools, users can edit their own

### Dashboard Customization
1. **Add Quick Access Links** - Click "+ Add Link" in Quick Access widget
2. **Reorder widgets** - Drag and drop widgets to customize layout
3. **View scheduler countdown** - See time until next daily email run
4. **View UPC/MAP stats** - Quick view of your data counts

### Notifications
1. **View notifications** - Check your notifications for task assignments and completions
2. **Unread count** - See how many unread notifications you have
3. **Mark as read** - Mark individual notifications or all notifications as read
4. **Delete notifications** - Remove notifications you no longer need
5. **Email alerts** - Receive email notifications when tasks assigned to you are completed

## Daily Scheduler

The system automatically runs a daily job at **8:00 PM Taipei time (UTC+8)** to:
- Process all UPCs from the `upcs` table
- Generate price alerts
- Send email reports to all configured recipients

To change the schedule time, update `SCHEDULER_HOUR` and `SCHEDULER_MINUTE` in your `.env` file.

## Email Configuration

### Gmail Setup

1. **Enable 2-Step Verification:**
   - Go to https://myaccount.google.com/security
   - Enable 2-Step Verification

2. **Generate App Password:**
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and "Other (Custom name)"
   - Enter name: "Orbit Hub"
   - Click "Generate"
   - Copy the 16-character password

3. **Update `.env`:**
   ```env
   EMAIL_PASSWORD=your-16-character-app-password
   ```

### Multiple Recipients

To send emails to multiple recipients, separate email addresses with commas:

```env
EMAIL_TO=email1@domain.com,email2@domain.com,email3@domain.com
```

## Performance Optimizations

### Frontend Optimizations

1. **Lazy Loading** - All page components use `React.lazy()` for code splitting
2. **UserContext** - Centralized user state prevents duplicate API calls
3. **Cached Auth Tokens** - Auth tokens cached in memory with automatic refresh
4. **Memoized Computations** - Protected note content cached with `useMemo`
5. **Dynamic CSS Loading** - Heavy CSS (ReactQuill) loads only when needed
6. **Optimized Callbacks** - Helper functions wrapped in `useCallback`

### What This Means
- **Faster initial load** - Only essential code loads first
- **Reduced API calls** - User info fetched once, shared everywhere
- **Smoother navigation** - Pages load on-demand
- **Better responsiveness** - Less re-computation on renders

## Troubleshooting

### Email Not Sending

1. **Check Gmail App Password:**
   - Must use App Password, not regular password
   - Verify 2-Step Verification is enabled
   - Regenerate App Password if needed

2. **Test Email Configuration:**
   - Use the test endpoint: `POST /api/v1/reports/test-email`
   - Check response for detailed error messages

3. **Check Backend Logs:**
   - Look for SMTP authentication errors
   - Verify email configuration in logs

### Scheduler Not Running

1. **Check Timezone:**
   - Scheduler runs at 8 PM Taipei time (UTC+8)
   - Verify `SCHEDULER_HOUR` and `SCHEDULER_MINUTE` are set correctly

2. **Check Backend Logs:**
   - Look for scheduler startup messages
   - Verify scheduler is running

### Database Table Not Found Errors

If you see errors like "Could not find the table 'public.xxx' in the schema cache":

1. **Check Migration Status:**
   - Ensure all migration files have been run in Supabase SQL Editor
   - Run migrations in the order listed in the Database Schema section

2. **Verify RLS Policies:**
   - Run `backend/database/ENSURE_USER_ISOLATION.sql` to verify all policies
   - Check that RLS is enabled on all user-specific tables

### Access Control Issues

1. **Orbit Hub Not Visible:**
   - Check if user has `has_keepa_access = true` in profiles table
   - Grant access using SQL: `UPDATE profiles SET has_keepa_access = true WHERE email = 'user@example.com'`

2. **Cannot Access Routes:**
   - Verify user is authenticated
   - Check if route requires Orbit Hub access
   - Ensure `has_keepa_access` is set correctly

### Widget Order Not Persisting

1. **Check Database:**
   - Ensure `dashboard_widgets` table exists
   - Run `backend/database/dashboard_widgets_schema.sql` if missing

2. **Check API:**
   - Verify backend API is accessible
   - Check browser console for API errors

### Slow Page Loading

If pages load slowly:

1. **Check Network Tab:**
   - Look for large bundle sizes
   - Verify lazy loading is working

2. **Clear Browser Cache:**
   - Hard refresh (Ctrl+Shift+R)
   - Clear application data

3. **Check Backend Response Times:**
   - Monitor API response times
   - Check database query performance

## Tech Stack

### Frontend
- React 18
- TypeScript
- Vite
- Tailwind CSS
- React Router v6
- Axios
- ReactQuill (rich text editor)
- Supabase JS Client

### Backend
- Python 3.11+
- FastAPI
- Pydantic
- APScheduler
- Supabase Python Client
- httpx
- python-multipart

### Database
- PostgreSQL (via Supabase)
- Row Level Security (RLS)
- Real-time subscriptions

### Deployment
- Frontend: Vercel
- Backend: Render
- Database: Supabase

## License

MIT
