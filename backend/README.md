# Backend - Orbit API

FastAPI backend for the Orbit system.

## Setup

1. Create virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Create `.env` file (see `.env.example` for template)

4. Run database migrations (execute `database/schema.sql` in Supabase SQL Editor)

5. Run the server:
   ```bash
   uvicorn app.main:app --reload
   ```

## API Documentation

Once the server is running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

