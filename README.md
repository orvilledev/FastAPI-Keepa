# Keepa Dashboard

Full-stack dashboard system for processing UPCs through Keepa API, detecting off-price sellers, and delivering CSV reports via email.

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

### Task Management
- **My Tasks** - Personal task management system
- **Subtasks** - Create and manage subtasks for each task
- **Task Filtering** - Filter by status (pending, in_progress, completed)
- **Priority Levels** - Set task priority (low, medium, high)
- **Due Dates** - Track task deadlines with overdue warnings
- **Status Tracking** - Quick status updates and completion tracking

### Tools Management
- **Public Tools** - Admin-managed public tool directory
- **My Toolbox** - Personal tool collection
- **Tool Starring** - Star public tools to add to your toolbox
- **Create Personal Tools** - Users can create their own tools
- **Category Filtering** - Filter tools by category
- **Tool Editing** - Admins can edit public tools
- **Developer Attribution** - Track tool developers

### Access Control
- **Keepa Alert Service Access** - Restricted access to chosen accounts only
- **User Data Isolation** - Users can only see their own data (Dashboard, Tasks, Tools)
- **Row Level Security (RLS)** - Database-level security policies
- **Protected Routes** - Frontend route protection for sensitive features
- **Role-Based Access** - Admin and user role management

### User Profile
- **Display Name** - Customizable user display name
- **Profile Management** - Update profile information
- **Business Details** - Store company and contact information

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

3. **Profile Insert Policy** - `backend/database/profile_insert_policy.sql`
   - Ensures users can insert their own profile

4. **Public Tools** - `backend/database/public_tools_schema.sql`
   - Creates `public_tools` table for admin-managed tools

5. **User Toolbox** - `backend/database/user_toolbox_schema.sql`
   - Creates `user_toolbox` table for starred tools

6. **User Tools** - `backend/database/user_tools_schema.sql`
   - Creates `user_tools` table for personal tools
   - Then run `backend/database/user_tools_add_developer.sql` to add developer field

7. **Quick Access Links** - `backend/database/quick_access_schema.sql`
   - Creates `quick_access_links` table for dashboard quick access

8. **Tasks** - `backend/database/tasks_schema.sql`
   - Creates `tasks` table for task management

9. **Subtasks** - `backend/database/subtasks_schema.sql`
   - Creates `subtasks` table for task subtasks

10. **Dashboard Widgets** - `backend/database/dashboard_widgets_schema.sql`
    - Creates `dashboard_widgets` table for widget order persistence

11. **Keepa Access Control** - `backend/database/add_keepa_access_field.sql`
    - Adds `has_keepa_access` field to profiles for access control

12. **User Isolation Verification** - `backend/database/ENSURE_USER_ISOLATION.sql`
    - Ensures all RLS policies are properly configured for user data isolation

### Granting Keepa Alert Service Access

To grant access to specific users:

```sql
-- Grant access to a specific user by email
UPDATE profiles 
SET has_keepa_access = true 
WHERE email = 'user@example.com';

-- Or grant access to all admins
UPDATE profiles 
SET has_keepa_access = true 
WHERE role = 'admin';
```

## API Endpoints

### Authentication
- `GET /api/v1/auth/me` - Get current user (includes role, display_name, has_keepa_access)
- `GET /api/v1/auth/profile` - Get user profile
- `PUT /api/v1/auth/profile` - Update user profile
- `PATCH /api/v1/auth/me/display-name` - Update display name

### Jobs (Requires Keepa Access)
- `POST /api/v1/jobs` - Create new job (admin only)
- `GET /api/v1/jobs` - List all jobs (users see their own, admins see all)
- `GET /api/v1/jobs/{job_id}` - Get job details
- `GET /api/v1/jobs/{job_id}/status` - Get job status
- `POST /api/v1/jobs/{job_id}/trigger` - Trigger job (admin)

### Batches (Requires Keepa Access)
- `GET /api/v1/batches/{batch_id}` - Get batch details
- `GET /api/v1/batches/{batch_id}/items` - Get batch items
- `POST /api/v1/batches/{batch_id}/stop` - Stop/cancel a batch (pending or processing status, admin only)

### Reports (Requires Keepa Access)
- `GET /api/v1/reports/{job_id}` - Get price alerts
- `GET /api/v1/reports/{job_id}/csv` - Download CSV
- `POST /api/v1/reports/{job_id}/email` - Resend email
- `POST /api/v1/reports/test-email` - Test email configuration (sends test email)

### UPCs (Requires Keepa Access)
- `GET /api/v1/upcs` - Get all UPCs
- `POST /api/v1/upcs` - Add new UPC
- `DELETE /api/v1/upcs/{upc_id}` - Delete UPC

### Scheduler
- `GET /api/v1/scheduler/status` - Get scheduler status and next run time

### Dashboard
- `GET /api/v1/dashboard/widgets` - Get user's dashboard widget preferences
- `POST /api/v1/dashboard/widgets/order` - Update widget order

### Quick Access Links
- `GET /api/v1/quick-access` - Get user's quick access links
- `POST /api/v1/quick-access` - Create quick access link
- `PUT /api/v1/quick-access/{link_id}` - Update quick access link
- `DELETE /api/v1/quick-access/{link_id}` - Delete quick access link

### Tasks
- `GET /api/v1/tasks` - Get user's tasks (filterable by status/priority)
- `POST /api/v1/tasks` - Create new task
- `PUT /api/v1/tasks/{task_id}` - Update task
- `DELETE /api/v1/tasks/{task_id}` - Delete task
- `GET /api/v1/tasks/{task_id}/subtasks` - Get task subtasks
- `POST /api/v1/tasks/{task_id}/subtasks` - Create subtask
- `PUT /api/v1/tasks/{task_id}/subtasks/{subtask_id}` - Update subtask
- `DELETE /api/v1/tasks/{task_id}/subtasks/{subtask_id}` - Delete subtask

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

## Deployment

### Backend (Render)

1. **Connect Repository:**
   - Go to https://render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub repository: `orvilledev/FastAPI-Keepa`

2. **Configure Service:**
   - **Name**: `keepa-dashboard-api` (or your choice)
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
   - Import your GitHub repository: `orvilledev/FastAPI-Keepa`

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

### Keepa Alert Service (Requires Access)
1. **Request access** - Contact admin to grant `has_keepa_access` permission
2. **Create a new job** with UPCs (one per line, up to 2500)
3. **Monitor job progress** in real-time
4. **View reports** when job completes
5. **Download CSV** or **resend email** with report
6. **Stop batches** if needed (admin only)
7. **Manage UPCs** - Add/remove UPCs from the system

### Task Management
1. **Go to My Tasks** - Access from sidebar
2. **Create tasks** - Add title, description, priority, and due date
3. **Add subtasks** - Break down tasks into smaller items
4. **Track progress** - Update status and mark items complete
5. **Filter tasks** - View by status (All, Pending, In Progress, Completed)

### Tools Management
1. **Browse Public Tools** - View admin-managed tools
2. **Star tools** - Add useful tools to your toolbox
3. **Create personal tools** - Add your own tools in My Toolbox
4. **Filter by category** - Use category filters to find tools
5. **Edit tools** - Admins can edit public tools, users can edit their own

### Dashboard Customization
1. **Add Quick Access Links** - Click "+ Add Link" in Quick Access widget
2. **Reorder widgets** - Drag and drop widgets to customize layout
3. **View scheduler countdown** - See time until next daily email run

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
   - Enter name: "Keepa Dashboard"
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

1. **Keepa Alert Service Not Visible:**
   - Check if user has `has_keepa_access = true` in profiles table
   - Grant access using SQL: `UPDATE profiles SET has_keepa_access = true WHERE email = 'user@example.com'`

2. **Cannot Access Routes:**
   - Verify user is authenticated
   - Check if route requires Keepa access
   - Ensure `has_keepa_access` is set correctly

### Widget Order Not Persisting

1. **Check Database:**
   - Ensure `dashboard_widgets` table exists
   - Run `backend/database/dashboard_widgets_schema.sql` if missing

2. **Check API:**
   - Verify backend API is accessible
   - Check browser console for API errors

## License

MIT
