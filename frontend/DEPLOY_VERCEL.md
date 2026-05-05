# Deploy MSW Overwatch Frontend to Vercel

## 1. Prerequisites

- A [Vercel account](https://vercel.com/signup)
- This repo pushed to GitHub, GitLab, or Bitbucket (recommended), or use Vercel CLI

## 2. Option A: Deploy via Vercel Dashboard (recommended)

1. Go to [vercel.com](https://vercel.com) and sign in.
2. Click **Add New…** → **Project**.
3. **Import** your Git repository (e.g. `FastAPI-Keepa-Dashboard`).
4. Configure the project:
   - **Root Directory:** Click **Edit**, set to `frontend`, then **Continue**.
   - **Framework Preset:** Vite (should be auto-detected).
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. **Environment Variables** (required for the app to work):
   - `VITE_SUPABASE_URL` – your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` – your Supabase anonymous/public key
   - `VITE_API_URL` – your backend API URL (e.g. `https://your-api.onrender.com` or your production API)
   - (Optional) `VITE_DESKTOP_APP_DOWNLOAD_URL` – direct HTTPS link to the Windows desktop `.exe` if you are not using the backend value below.
6. Click **Deploy**. Vercel will build and deploy; you’ll get a URL like `https://your-project.vercel.app`.

**Desktop app download link:** On load, the app calls your backend at `GET /api/v1/public/client-config` and uses `desktop_app_download_url` when set (configure **`DESKTOP_APP_DOWNLOAD_URL`** on Render). That avoids a Vercel rebuild when you change the installer URL. If the API returns empty, the build-time `VITE_DESKTOP_APP_DOWNLOAD_URL` is used when present.

### After first deploy

- **Domains:** Project Settings → Domains to add a custom domain.
- **Env vars:** Project Settings → Environment Variables to add or change variables; redeploy for changes to apply.

## 3. Option B: Deploy via Vercel CLI

1. Install and log in (from the repo root or any folder):
   ```bash
   npx vercel login
   ```
   Follow the prompts (email or GitHub).

2. From the **frontend** directory, deploy:
   ```bash
   cd frontend
   npx vercel
   ```
   First time: answer the prompts (link to existing project or create new one, etc.).  
   To deploy to production:
   ```bash
   npx vercel --prod
   ```

3. Set environment variables (required):
   ```bash
   npx vercel env add VITE_SUPABASE_URL
   npx vercel env add VITE_SUPABASE_ANON_KEY
   npx vercel env add VITE_API_URL
   ```
   Optional: `npx vercel env add VITE_DESKTOP_APP_DOWNLOAD_URL` if you host the installer URL only at build time (usually prefer **`DESKTOP_APP_DOWNLOAD_URL`** on the backend instead).
   Add them for **Production** (and Preview if you want). Then redeploy:
   ```bash
   npx vercel --prod
   ```

## 4. What’s already configured

- **`frontend/vercel.json`** – SPA rewrites so routes like `/login`, `/dashboard` work on refresh and direct links. Build uses `npm run build` and output is `dist`.

## 5. CORS

Ensure your **backend** allows the Vercel frontend origin in CORS, e.g.:

- `https://your-project.vercel.app`
- Or `https://*.vercel.app` if your backend supports a wildcard.

Otherwise the browser will block API requests from the deployed frontend.
