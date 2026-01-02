# Keepa Dashboard

Full-stack dashboard system for processing UPCs through Keepa API, detecting off-price sellers, and delivering CSV reports via email.

## Architecture

- **Backend**: FastAPI (Python) on Render
- **Frontend**: React + TypeScript + Vite + Tailwind CSS on Vercel
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Scheduler**: APScheduler for daily automation

## Features

- Process 2500 UPCs in 21 batches (~119 UPCs per batch)
- Detect sellers with lowered prices (off-price sellers)
- Generate CSV reports with price alerts
- Email delivery of CSV reports
- Daily automated job execution
- Real-time job status tracking
- User authentication and authorization
- Admin and user roles

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
   KEEPA_API_KEY=your_keepa_api_key
   KEEPA_API_URL=https://keepa.com/api/
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_service_key
   EMAIL_SMTP_HOST=smtp.gmail.com
   EMAIL_SMTP_PORT=587
   EMAIL_FROM=noreply@yourdomain.com
   EMAIL_PASSWORD=your_email_password
   EMAIL_TO=admin@yourdomain.com
   ENVIRONMENT=development
   API_V1_STR=/api/v1
   CORS_ORIGINS=http://localhost:5173,http://localhost:3000
   ```

5. Run database migrations (execute `backend/database/schema.sql` in Supabase SQL Editor)

6. Run the server:
   ```bash
   uvicorn app.main:app --reload
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

## API Endpoints

### Authentication
- `GET /api/v1/auth/me` - Get current user

### Jobs
- `POST /api/v1/jobs` - Create new job (admin only)
- `GET /api/v1/jobs` - List all jobs
- `GET /api/v1/jobs/{job_id}` - Get job details
- `GET /api/v1/jobs/{job_id}/status` - Get job status
- `POST /api/v1/jobs/{job_id}/trigger` - Trigger job (admin)

### Reports
- `GET /api/v1/reports/{job_id}` - Get price alerts
- `GET /api/v1/reports/{job_id}/csv` - Download CSV
- `POST /api/v1/reports/{job_id}/email` - Resend email

## Deployment

### Backend (Render)
1. Connect your repository to Render
2. Set build command: `pip install -r requirements.txt`
3. Set start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Add environment variables in Render dashboard

### Frontend (Vercel)
1. Connect your repository to Vercel
2. Set root directory to `frontend`
3. Add environment variables in Vercel dashboard
4. Deploy

## Usage

1. Sign up or log in to the dashboard
2. Create a new job with UPCs (one per line, up to 2500)
3. Monitor job progress in real-time
4. View reports when job completes
5. Download CSV or resend email with report

## License

MIT

