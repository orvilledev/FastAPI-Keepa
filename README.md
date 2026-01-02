# Keepa Dashboard

Full-stack dashboard system for processing UPCs through Keepa API, detecting off-price sellers, and delivering CSV reports via email.

## Architecture

- **Backend**: FastAPI (Python) on Render
- **Frontend**: React + TypeScript + Vite + Tailwind CSS on Vercel
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Scheduler**: APScheduler for daily automation at 8 PM Taipei time

## Features

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

## API Endpoints

### Authentication
- `GET /api/v1/auth/me` - Get current user

### Jobs
- `POST /api/v1/jobs` - Create new job (admin only)
- `GET /api/v1/jobs` - List all jobs
- `GET /api/v1/jobs/{job_id}` - Get job details
- `GET /api/v1/jobs/{job_id}/status` - Get job status
- `POST /api/v1/jobs/{job_id}/trigger` - Trigger job (admin)

### Batches
- `GET /api/v1/batches/{batch_id}` - Get batch details
- `GET /api/v1/batches/{batch_id}/items` - Get batch items
- `POST /api/v1/batches/{batch_id}/stop` - Stop/cancel a batch (pending or processing status, admin only)

### Reports
- `GET /api/v1/reports/{job_id}` - Get price alerts
- `GET /api/v1/reports/{job_id}/csv` - Download CSV
- `POST /api/v1/reports/{job_id}/email` - Resend email
- `POST /api/v1/reports/test-email` - Test email configuration (sends test email)

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

1. **Sign up or log in** to the dashboard
2. **Create a new job** with UPCs (one per line, up to 2500)
3. **Monitor job progress** in real-time
4. **View reports** when job completes
5. **Download CSV** or **resend email** with report
6. **Stop batches** if needed (admin only)

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

## License

MIT
