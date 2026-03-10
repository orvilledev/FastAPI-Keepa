# Deploy Metro Hub Backend to Render

## 1. Prerequisites

- A [Render account](https://render.com/register)
- This repo pushed to GitHub or GitLab
- Your Supabase, Keepa, and email credentials ready

## 2. Deploy via Render Dashboard

### Create a Web Service

1. Go to [dashboard.render.com](https://dashboard.render.com) and sign in.
2. Click **New +** → **Web Service**.
3. **Connect** your repository (e.g. `FastAPI-Keepa-Dashboard`). Authorize Render if needed.
4. Configure the service:
   - **Name:** `metro-api` (or any name).
   - **Region:** Choose one close to your users.
   - **Root Directory:** Set to **`backend`** (required so Render runs from the backend folder).
   - **Runtime:** **Python 3**.
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`  
     Render sets `PORT`; your app must use it.
5. **Environment Variables:** Add the following (use **Add Environment Variable** or **Add Secret** for sensitive values).

### Required environment variables

| Variable | Description | Example |
|----------|-------------|---------|
| `KEEPA_API_KEY` | Keepa API key | (from keepa.com) |
| `KEEPA_API_URL` | Keepa API base URL | `https://api.keepa.com/` |
| `SUPABASE_URL` | Supabase project URL | `https://xxxx.supabase.co` |
| `SUPABASE_KEY` | Supabase anon/service key | (from Supabase dashboard) |
| `EMAIL_FROM` | Sender email address | `noreply@yourdomain.com` |
| `EMAIL_FROM_NAME` | Sender display name | `Metro Hub` |
| `EMAIL_PASSWORD` | SMTP password (e.g. Gmail App Password) | (secret) |
| `EMAIL_TO` | Default recipient(s), comma-separated | `user@example.com` |
| `CORS_ORIGINS` | Allowed frontend origins, comma-separated | `https://your-app.vercel.app,https://www.yourdomain.com` |

Optional (have defaults):

- `EMAIL_SMTP_HOST` — default `smtp.gmail.com`
- `EMAIL_SMTP_PORT` — default `587`
- `ENVIRONMENT` — e.g. `production`
- `PYTHON_VERSION` — e.g. `3.11.0` (Render uses this for runtime)

Do **not** set `PORT`; Render sets it automatically.

6. Click **Create Web Service**. Render will build and deploy. Your API URL will be like `https://metro-api.onrender.com`.

## 3. After deploy

- **API base URL:** Use the Render service URL (e.g. `https://metro-api.onrender.com`) as **VITE_API_URL** in your Vercel frontend so the app talks to this backend.
- **CORS:** Ensure `CORS_ORIGINS` includes your Vercel (and any other) frontend URLs exactly, with no trailing slash.
- **Free tier:** The service may spin down after inactivity; the first request after idle can be slow (cold start).
- **Logs:** Use the **Logs** tab in the Render dashboard to debug build or runtime errors.

## 4. Optional: Deploy with Blueprint (render.yaml)

If your repo has a **render.yaml** at the repo root (see project root), you can use **Blueprint**:

1. In Render dashboard: **New +** → **Blueprint**.
2. Connect the same repo.
3. Render will read `render.yaml` and create a web service with `rootDir: backend` and the build/start commands.
4. You still must add all environment variables in the service **Environment** tab (Blueprint does not push secrets from the repo).

The `render.yaml` in the repo root is only for defining the service type, root directory, build, and start command; secrets stay in the dashboard.
