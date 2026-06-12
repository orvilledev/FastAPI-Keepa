# MSW Overwatch — Project Structure

**Last Updated**: June 10, 2026  
**Version**: 2.0.0

This document describes the directory layout for **MSW Overwatch** (repo: `FastAPI-Keepa-Dashboard`): a FastAPI backend, React/Vite web app, and optional Electron Windows desktop client.

---

## Root Directory

```
FastAPI-Keepa-Dashboard/
├── backend/                      # FastAPI API (deployed to Render)
├── frontend/                     # React app + Electron wrapper (web on Vercel)
├── README.md                     # Setup and feature overview
├── PROJECT_STRUCTURE.md          # This file
├── PROJECT_ANALYSIS_REPORT.md    # Architecture audit and grades
├── IMPLEMENTATION_SUMMARY.md     # Jan 2026 security/testing improvements log
├── RATE_LIMITING_SUMMARY.md      # Rate limiting overview
├── STARTUP_TROUBLESHOOTING.md    # Common dev issues
├── start-dev.ps1 / start-dev.bat # Start backend + frontend
├── stop-dev.ps1 / stop-dev.bat   # Stop dev servers
├── check-dev.ps1                 # Check dev server status
├── requirements.txt              # Root-level Python deps (if used)
├── vercel.json                   # Vercel monorepo hint (frontend root set in dashboard)
├── project_structure.txt         # Generated snapshot (may be stale)
└── project_files.txt             # Generated file list (may be stale)
```

---

## Backend Structure

### Backend Root (`backend/`)

```
backend/
├── app/                          # Application package
├── database/                     # SQL schemas and migrations
├── scripts/                      # Utility scripts (CLI chat, Keepa key verify, etc.)
├── tests/                        # Pytest suite (85 tests, ~29% coverage)
├── venv/                         # Local virtualenv (gitignored)
├── requirements.txt              # Python dependencies
├── pytest.ini                    # Pytest + coverage config
├── .env.example                  # Environment variable template
├── DEPLOY_RENDER.md              # Render deployment guide
├── CSV_OUTPUT_LOGIC.md           # Excel report column calculations
├── INPUT_SANITIZATION_GUIDE.md   # bleach sanitization usage
├── RATE_LIMITING_IMPLEMENTATION.md
└── SENTRY_SETUP_GUIDE.md
```

### Application (`backend/app/`)

```
backend/app/
├── main.py                       # FastAPI entry, CORS, rate-limit handler, router mount
├── config.py                     # Settings from environment
├── database.py                   # Supabase client
├── dependencies.py               # Auth, MFA AAL2, app access, superadmin
├── scheduler.py                  # APScheduler daily jobs (8 vendor categories)
├── maintenance.py                # Maintenance mode state
│
├── api/                          # HTTP route handlers
│   ├── auth.py                   # Profile, MFA confirm, user admin, maintenance
│   ├── public.py                 # Unauthenticated client config (desktop URL)
│   ├── jobs.py                   # Keepa batch jobs
│   ├── batches.py                # Batch processing control
│   ├── reports.py                # Report generation / download
│   ├── upcs.py                   # UPC CRUD and bulk upload
│   ├── map.py                    # MAP (MSRP) management
│   ├── sellers.py                # Seller name lists
│   ├── scheduler.py              # Per-vendor schedules, uploaded reports
│   ├── dashboard.py              # Dashboard widget data
│   ├── quick_access.py           # Quick access links
│   ├── tools.py                  # Public tools, job aids, toolbox, micro-tools
│   ├── notifications.py          # In-app notifications
│   ├── email_recipients.py       # Email recipient pools and lists
│   ├── feedback.py               # App feedback submissions
│   ├── feedback_blocklist.py     # Feedback access blocklist helpers
│   ├── tracking_scanner.py       # PDF/OCR tracking extraction API
│   └── cli_chat.py               # CLI-style assistant chat
│
├── models/                       # Pydantic request/response schemas
│   ├── user.py, batch.py, keepa.py, upc.py, map.py
│   ├── notification.py, price_alert.py, dashboard_widget.py
│   ├── public_tool.py, user_tool.py, job_aid.py, micro_tool.py
│   ├── email_recipients.py, feedback.py, tracking_history.py
│   └── cli_chat.py, quick_access.py
│
├── repositories/                 # Data access
│   ├── batch_repository.py, job_repository.py, report_repository.py
│   ├── upc_repository.py, map_repository.py
│   ├── seller_name_repository.py
│   └── supabase_read_all.py
│
├── services/                     # Business logic
│   ├── batch_processor.py        # Keepa batch orchestration
│   ├── keepa_client.py           # Keepa API client
│   ├── keepa_sellers.py          # Seller extraction helpers
│   ├── price_analyzer.py         # Off-price detection
│   ├── csv_generator.py          # Excel (.xlsx) comprehensive reports
│   ├── report_service.py         # Report assembly per job
│   ├── email_service.py          # SMTP report delivery
│   ├── job_status_service.py     # Job lifecycle
│   └── tracking_scanner.py       # Server-side tracking PDF/OCR
│
├── middleware/
│   └── rate_limiter.py           # SlowAPI limiter + tier constants
│
└── utils/
    ├── error_handler.py          # API error decorator
    ├── jwt_utils.py              # JWT AAL (aal1/aal2) parsing
    ├── permissions.py            # Role / feature permission checks
    ├── notifications.py          # Notification creation helpers
    ├── sanitization.py           # bleach HTML/text sanitization
    ├── sentry_config.py          # Sentry init helpers (wire in main.py)
    ├── vendor_code.py            # Vendor category normalization
    ├── email_recipient_utils.py
    └── email_recipient_pool_db.py
```

**Retired API modules** (no longer in `backend/app/api/`): `notes.py`, `tasks.py`, `task_attachments.py`, `task_validations.py`. Legacy SQL for notes/tasks remains under `backend/database/` for existing deployments.

### Tests (`backend/tests/`)

```
backend/tests/
├── conftest.py
├── test_api/
│   ├── test_auth.py
│   └── test_jobs.py
├── test_services/
│   ├── test_email_service.py
│   ├── test_price_analyzer.py
│   ├── test_keepa_sellers.py
│   └── test_csv_report_exclusions.py
├── test_repositories/
│   ├── test_upc_repository.py
│   └── test_supabase_read_all.py
├── test_utils/
│   └── test_email_recipient_pool_db.py
└── test_scheduler_mode_selection.py
```

Run: `cd backend && pytest`

### Database (`backend/database/`)

SQL files are applied manually or via Supabase SQL editor. Notable groups:

| Area | Examples |
|------|----------|
| Core | `schema.sql`, `profile_fields_migration.sql`, `profiles_add_is_active.sql` |
| Keepa / jobs | `batch_jobs_*`, `delete_batch_job_cascade_rpc.sql` |
| UPC / MAP | `upcs_add_category.sql`, `map_schema.sql`, `map_upcs_rls_msw_overwatch_access.sql` |
| Scheduler | `scheduler_settings_schema.sql`, `scheduler_uploaded_reports.sql`, `migrations/enforce_single_uploaded_report_per_category.sql` |
| Email | `email_recipients_pool_and_lists.sql`, `migrations/add_email_bcc_recipients.sql` |
| Tools | `public_tools_schema.sql`, `job_aids_schema.sql`, `user_toolbox_schema.sql`, `migrations/create_micro_tools.sql` |
| Feedback | `app_feedback_schema.sql`, `app_feedback_migration_*.sql` |
| Tracking | `migrations/create_tracking_scan_history.sql` |
| MFA | `migrations/add_mfa_enabled.sql` |
| CLI chat | `migrations/create_cli_chat.sql` |
| Legacy (inactive UI) | `notes_*.sql`, `tasks_*.sql`, `subtasks_*.sql`, `task_*` |

---

## Frontend Structure

### Frontend Root (`frontend/`)

```
frontend/
├── electron/                     # Desktop shell (Windows)
│   ├── main.cjs                  # BrowserWindow, auto-updater, IPC
│   ├── preload.cjs               # contextBridge → window.desktop
│   └── icon.ico
├── public/                       # Static assets (app-icon.svg, sw.js, favicon)
├── scripts/
│   └── build-win-icon.mjs        # SVG → .ico for electron-builder
├── src/                          # React application source
├── dist/                         # Production build output (gitignored)
├── package.json                  # v2.0.0, electron-builder config
├── vite.config.ts                # Vite; base `./` in electron mode
├── tailwind.config.js
├── tsconfig.json
├── .env.example
├── DEPLOY_VERCEL.md
├── ELECTRON_SETUP.md
└── UPDATE_FRONTEND_FOR_RATE_LIMITING.md
```

### Source (`frontend/src/`)

```
frontend/src/
├── main.tsx                      # React mount; service worker (web only)
├── App.tsx                       # Routes, MfaGate, maintenance, lazy pages
├── index.css
├── vite-env.d.ts                 # window.desktop types
│
├── components/
│   ├── Landing.tsx, About.tsx, Maintenance.tsx
│   ├── auth/
│   │   ├── Login.tsx, ResetPassword.tsx
│   │   ├── MfaSetup.tsx, MfaVerify.tsx, MfaGate.tsx
│   │   └── TotpQrCode.tsx
│   ├── admin/UserManagement.tsx
│   ├── common/ProtectedRoute.tsx
│   ├── layout/Layout.tsx, Navbar.tsx, Sidebar.tsx, NavbarSearch.tsx
│   ├── dashboard/
│   │   ├── Dashboard.tsx, JobCard.tsx, BatchStatus.tsx, UPCMAPStats.tsx
│   │   ├── VendorSchedulerCountdown.tsx, VendorRunCard.tsx
│   │   └── *SchedulerCountdown.tsx  # DNK, CLK, OBZ, REF, BOR, SFF, TEV, CHA
│   ├── jobs/
│   │   ├── JobList.tsx, JobDetail.tsx, CreateJob.tsx
│   │   ├── DailyRunsMenu.tsx, DailyRun.tsx, VendorDailyRun.tsx
│   │   ├── *DailyRun.tsx            # Per-vendor daily run pages
│   │   └── EmailRecipientsPicker.tsx
│   ├── reports/ReportList.tsx, ReportView.tsx
│   ├── upcs/UPCManagement.tsx, ManageUPCsHub.tsx
│   ├── map/MAPManagement.tsx
│   ├── sellers/SellerList.tsx
│   ├── email/EmailList.tsx
│   ├── tools/PublicTools.tsx, JobAids.tsx, MyToolbox.tsx, MicroTools.tsx
│   ├── scanner/TrackingScanner.tsx, FNSKULabelGenerator.tsx
│   ├── feedback/Feedback.tsx
│   ├── notifications/Notifications.tsx
│   └── chat/CliChat.tsx
│
├── contexts/
│   ├── UserContext.tsx           # Auth, profile, permissions
│   └── TrackingScanContext.tsx   # Persists scan across navigation
│
├── hooks/
│   ├── index.ts
│   └── useAuth.ts
│
├── lib/
│   ├── supabase.ts               # Supabase client
│   └── mfa.ts                    # TOTP status, enrollment, idle re-verify
│
├── services/api.ts               # Axios client, interceptors, API methods
├── types/index.ts
├── constants/
│   ├── app.ts                    # APP_NAME, version, desktop download URL
│   ├── feedbackAccess.ts
│   └── microTools.ts
│
└── utils/
    ├── index.ts, statusColors.ts, timeUtils.ts
    ├── trackingExtractor.ts      # Client-side PDF/OCR tracking logic
    └── fnskuLabelGenerator.ts
```

**Retired frontend** (removed; routes redirect to `/dashboard`): `components/notes/`, `components/tasks/`, `Signup.tsx`, ReactQuill-based My Notes UI. Hooks `useNoteProtection.ts`, `useTaskManagement.ts`, and utils `noteUtils.ts`, `taskUtils.ts` are no longer present.

### Electron desktop

| Script | Purpose |
|--------|---------|
| `npm run electron:dev` | Vite dev server + Electron window |
| `npm run electron:build` | NSIS installer → `frontend/dist/*.exe` |
| `npm run electron:release` | Build + publish to GitHub Releases |

Packaged app uses **HashRouter** (`file://`); web uses **BrowserRouter**. See `frontend/ELECTRON_SETUP.md`.

---

## Technology Stack

### Backend
| Layer | Choice |
|-------|--------|
| Framework | FastAPI 0.104, Uvicorn |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth + JWT AAL2 for MFA |
| Scheduler | APScheduler (in-process, 8 vendors) |
| Email | SMTP |
| External | Keepa API |
| Security | SlowAPI rate limits, bleach (utils), optional Sentry |
| Testing | pytest, pytest-asyncio, pytest-cov |

### Frontend
| Layer | Choice |
|-------|--------|
| UI | React 18, TypeScript |
| Build | Vite 5 |
| Styling | Tailwind CSS 3 |
| Routing | React Router 6 (Browser or Hash) |
| HTTP | Axios |
| State | React Context |
| Desktop | Electron 37, electron-updater |
| Barcode/OCR | @zxing/library, tesseract.js, pdfjs-dist |
| Charts | recharts |

---

## Deployment

| Component | Platform | Doc |
|-----------|----------|-----|
| API | Render (`backend/` root) | `backend/DEPLOY_RENDER.md` |
| Web | Vercel (`frontend/` root) | `frontend/DEPLOY_VERCEL.md` |
| Desktop | GitHub Releases (NSIS `.exe`) | `frontend/ELECTRON_SETUP.md` |
| Database | Supabase | SQL in `backend/database/` |

**Health**: `GET /health`  
**Maintenance**: `GET /api/v1/system/maintenance-status`  
**Public config**: `GET /api/v1/public/client-config` (desktop download URL)

---

## Environment Variables

### Backend (`backend/.env.example`)
- **Keepa**: `KEEPA_API_KEY`, `KEEPA_API_KEYS`, rate-limit tuning
- **Supabase**: `SUPABASE_URL`, `SUPABASE_KEY`
- **Email**: `EMAIL_SMTP_*`, `EMAIL_FROM`, `EMAIL_PASSWORD`, `EMAIL_TO`
- **App**: `ENVIRONMENT`, `CORS_ORIGINS`, `API_V1_STR`
- **Scheduler**: `SCHEDULER_HOUR`, `SCHEDULER_MINUTE`
- **Optional**: `SENTRY_DSN`, `DESKTOP_APP_DOWNLOAD_URL`, `REPORT_EXCLUDED_SELLER_SUBSTRINGS`

### Frontend (`frontend/.env.example`)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` (origin only, no `/api/v1`)
- Optional: `VITE_DESKTOP_APP_DOWNLOAD_URL`, `VITE_MFA_IDLE_MINUTES`

---

## Features (Current)

### Authentication & access
- Email/password login (Supabase)
- **TOTP MFA** — setup, verify, 15h idle re-verify
- Superadmin user approval for new accounts
- `has_keepa_access`, `can_manage_tools`, `can_assign_tasks` flags
- Maintenance mode (superadmin)

### Keepa & daily operations
- Batch jobs (~2500 UPCs, multi-batch processing)
- Off-price seller detection → Excel reports
- **8 vendor categories**: DNK, CLK, OBZ, REF, BOR, SFF, TEV, CHA
- Per-vendor scheduler settings and daily-run UI
- MAP management, seller lists, email recipient pools
- Automated email on job completion

### Tools & operations
- Public tools, job aids, personal toolbox, micro-tools
- Tracking Extractor (PDF + OCR)
- FNSKU label generator
- App feedback with electronic signature
- In-app notifications
- CLI chat API (UI component exists; assistant route may be hidden)

### Dashboard
- Drag-and-drop widgets, quick access links
- Per-vendor scheduler countdowns
- UPC/MAP statistics

### Desktop
- Windows installer with auto-update from GitHub Releases
- Same auth/MFA as web

### Retired (legacy DB may remain)
- My Notes (rich text, password protection)
- Team Tasks (assignments, subtasks, attachments)

---

## API Overview

Base path: `/api/v1` (see FastAPI `/docs` when running locally).

| Prefix / router | Examples |
|-----------------|----------|
| `/auth` | `GET /me`, `POST /mfa/confirm-enrollment`, `GET /users`, maintenance |
| `/jobs`, `/batches`, `/reports` | Job CRUD, batch control, report download |
| `/upcs`, `/map`, `/sellers` | Catalog and seller data |
| `/scheduler` | Settings, manual run, uploaded reports |
| `/dashboard`, `/quick-access` | Widgets and links |
| `/tools` | Public tools, job aids, toolbox, micro-tools |
| `/notifications` | User notifications |
| `/email-recipients` | Recipient pools |
| `/feedback` | Feedback submit/list |
| `/tracking-scanner` | Server tracking extraction |
| `/cli-chat` | Chat turns |
| `/public` | `client-config` (no auth) |

Protected Keepa routes require `require_app_access` (active user + MFA AAL2 when enabled).

---

## Development

```powershell
# Repo root — both servers
.\start-dev.ps1

# Backend only
cd backend
python -m uvicorn app.main:app --reload --port 8000

# Frontend only
cd frontend
npm run dev

# Electron
cd frontend
npm run electron:dev
```

---

## Documentation Index

| File | Topic |
|------|-------|
| `README.md` | Full setup and feature list |
| `PROJECT_ANALYSIS_REPORT.md` | Audit, grades, roadmap |
| `STARTUP_TROUBLESHOOTING.md` | Dev environment issues |
| `backend/DEPLOY_RENDER.md` | API deployment |
| `backend/CSV_OUTPUT_LOGIC.md` | Report Excel columns |
| `frontend/DEPLOY_VERCEL.md` | Web deployment |
| `frontend/ELECTRON_SETUP.md` | Desktop builds and updates |
| `backend/RATE_LIMITING_IMPLEMENTATION.md` | SlowAPI decorators |
| `backend/INPUT_SANITIZATION_GUIDE.md` | bleach usage |
| `backend/SENTRY_SETUP_GUIDE.md` | Error tracking setup |

---

## Git Ignored (typical)

- `node_modules/`, `frontend/dist/`
- `backend/venv/`, `**/__pycache__/`, `htmlcov/`
- `.env` (never commit secrets)

---

**Product**: MSW Overwatch — owned and managed by MetroShoe Warehouse.
