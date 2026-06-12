# MSW Overwatch - Project Analysis Report

**Generated**: January 15, 2026  
**Last Updated**: June 10, 2026  
**Project**: FastAPI Keepa Dashboard (MSW Overwatch)  
**Version**: 2.0.0

---

## Executive Summary

MSW Overwatch is a full-stack productivity and price-monitoring platform built with FastAPI and React. It combines Keepa-powered seller/price workflows for multiple vendors with team tools (notifications, job aids, micro-tools, feedback), a Windows Electron desktop client, and Supabase-backed authentication including TOTP two-factor authentication.

**Overall Assessment**: **B+ (87/100)** — Production-capable with a clear improvement path  
**Recent Improvement**: +3 points from MFA, Electron desktop, expanded vendor schedulers, and backend test suite (was 84/100 in Jan 2026)

**Latest Update (Jun 10, 2026)**: Report refreshed to match the current codebase — MSW Overwatch branding, 8-vendor daily runs, Electron + auto-updater, TOTP MFA, partial backend test coverage (85 tests), and updated deployment/security posture.

---

## Current Setup (June 2026)

### Deployment & Clients

| Layer | Technology | Hosting / Distribution |
|-------|------------|------------------------|
| **Backend API** | FastAPI 0.104, Python 3, Uvicorn | [Render](backend/DEPLOY_RENDER.md) (`backend/` root) |
| **Web frontend** | React 18, TypeScript, Vite 5, Tailwind | [Vercel](frontend/DEPLOY_VERCEL.md) (`frontend/` root) |
| **Desktop app** | Electron 37 + electron-builder + electron-updater | Windows NSIS installer via [GitHub Releases](frontend/ELECTRON_SETUP.md) |
| **Database & Auth** | Supabase (PostgreSQL + Auth) | Supabase cloud |
| **Scheduler** | APScheduler (in-process with API) | Runs on Render web service |

### Environment Configuration

Both apps ship `.env.example` files:

- `backend/.env.example` — Keepa keys, Supabase, SMTP, CORS, scheduler, Sentry, desktop download URL
- `frontend/.env.example` — `VITE_SUPABASE_*`, `VITE_API_URL`, optional desktop installer URL

Production desktop download URL can be set on the API (`DESKTOP_APP_DOWNLOAD_URL`) and exposed via `GET /api/v1/public/client-config` so the installer link can change without a Vercel rebuild.

### Local Development

```powershell
# From repo root (Windows)
.\start-dev.ps1      # Starts backend + frontend
.\check-dev.ps1      # Health check
.\stop-dev.ps1       # Stop services

# Electron desktop dev (from frontend/)
npm run electron:dev
```

### Backend API Surface (`backend/app/api/`)

| Router | Purpose |
|--------|---------|
| `auth` | Profile, MFA enrollment, user admin, maintenance controls |
| `jobs` / `batches` / `reports` | Keepa batch jobs, processing, Excel reports |
| `upcs` / `map` / `sellers` | UPC & MAP management, seller lists |
| `scheduler` | Per-vendor daily runs, uploaded reports, schedule settings |
| `dashboard` / `quick_access` | Dashboard widgets and quick links |
| `tools` | Public tools, job aids, user toolbox, micro-tools |
| `notifications` | In-app notifications |
| `email_recipients` | Report email recipient pools |
| `feedback` | App feedback with electronic signature |
| `tracking_scanner` | PDF/OCR tracking extraction API |
| `cli_chat` | CLI-style assistant chat (rate-limited) |
| `public` | Unauthenticated client config (desktop download URL, etc.) |

Protected Keepa routes use `require_app_access` (active profile + optional MFA AAL2).

### Vendor / Scheduler Categories

Daily automation supports **8 vendor categories**: **DNK, CLK, OBZ, REF, BOR, SFF, TEV, CHA**. Each has its own scheduler settings row, countdown widget on the dashboard, and daily-run page in the frontend.

### Authentication & MFA

- **Supabase Auth** — email/password login, password reset
- **TOTP MFA** — enrollment (`/mfa/setup`), verification (`/mfa/verify`), idle re-verify (default **15 hours**, configurable via `VITE_MFA_IDLE_MINUTES`)
- **Backend enforcement** — when `profiles.mfa_enabled` is true, API requires JWT **AAL2** (`backend/app/dependencies.py`)
- **Electron** — same MFA flow as web; no desktop bypass
- **Account approval** — new signups default to inactive pending superadmin approval

### Electron Desktop

- Wrapper: `frontend/electron/main.cjs`, `preload.cjs`
- Security: `contextIsolation`, `nodeIntegration: false`, `sandbox: true`
- Packaged builds use `HashRouter` for `file://` routing
- Auto-updates via `electron-updater` → GitHub Releases (`orvilledev/FastAPI-Keepa`)
- Build: `npm run electron:build` (local) / `npm run electron:release` (publish)

### Frontend Feature Areas

| Area | Routes / Components |
|------|---------------------|
| Dashboard | Widgets, vendor scheduler countdowns, UPC/MAP stats |
| Keepa jobs | Job list, create, detail, reports |
| Daily runs | Per-vendor pages (`/daily-run/{dnk,clk,obz,ref,bor,sff,tev,cha}`) |
| UPC / MAP | Manage UPCs hub, MAP management |
| Sellers & email | Seller list, email recipient management |
| Tools | How-to guide, job aids, micro-tools, personal toolbox |
| Scanner | Tracking Extractor (PDF/OCR), FNSKU label generator |
| Admin | User management, maintenance mode |
| Feedback | App feedback form (with signature) |
| About | Version info; desktop build shows app version + update check |

**Retired / redirected UI**: My Notes and Team Tasks routes redirect to dashboard (`/my-space/notes`, `/notes-popout`). Legacy DB schemas may remain; active API routers for notes/tasks are not in the current backend.

### Security Infrastructure Status

| Control | Status |
|---------|--------|
| RLS on user tables | ✅ Active (Supabase) |
| TOTP MFA (Supabase + backend AAL2) | ✅ Active |
| Rate limiting (SlowAPI) | ✅ Infrastructure + **partial** endpoint decorators (`auth`, `jobs`, `scheduler`, `tracking_scanner`, `cli_chat`) |
| Input sanitization (`bleach`) | ⚠️ Utilities + guide exist; **not yet applied** in API route handlers |
| Sentry (`sentry-sdk`) | ⚠️ Config module + guide exist; **`init_sentry()` not wired** in `main.py` |
| Validation error log redaction | ✅ Sensitive fields masked in `main.py` |
| CORS | ✅ Configured via `CORS_ORIGINS` |

### Testing Status

| Area | Status |
|------|--------|
| Backend (`pytest`) | ✅ **85 tests** collected; **~29% line coverage** (`backend/pytest.ini`, `backend/tests/`) |
| Frontend (`vitest`) | ❌ Not configured |
| CI/CD (GitHub Actions) | ❌ Not present |

```bash
cd backend
pytest              # Run all tests
pytest --cov=app    # Coverage report (htmlcov/)
```

---

## 1. STRENGTHS 💪

### 1.1 Architecture & Design

#### **Modern Tech Stack**
- ✅ **Backend**: FastAPI (Python) — async-capable, OpenAPI docs at `/docs`
- ✅ **Frontend**: React 18 + TypeScript + Vite — type-safe, code-split lazy routes
- ✅ **Desktop**: Electron 37 — Windows installer + GitHub auto-updates
- ✅ **Database**: Supabase (PostgreSQL) — RLS, auth, storage
- ✅ **Styling**: Tailwind CSS — consistent utility-first UI

#### **Clean Separation of Concerns**
```
✅ Backend structure:
   api/           → Route handlers
   services/      → Business logic (Keepa, email, reports, batch processing)
   repositories/  → Data access (UPC, MAP, jobs, sellers)
   models/        → Pydantic schemas
   middleware/    → Rate limiting
   utils/         → Sanitization, JWT, notifications, Sentry helpers
```

#### **Security-First Approach**
- ✅ Row Level Security on user-specific tables
- ✅ TOTP two-factor authentication with backend AAL2 enforcement
- ✅ Role-based access (`superadmin`, `has_keepa_access`, tool permissions)
- ✅ Protected frontend routes (`ProtectedRoute`, `MfaGate`)
- ✅ Electron hardened defaults (context isolation, sandbox)
- ✅ Rate limiting middleware with tiered limits and 429 handling

### 1.2 Features & Functionality

#### **Rich Feature Set**
- ✅ **Keepa Integration**: Batch UPC processing, off-price seller detection, Excel reports
- ✅ **Multi-vendor daily runs**: 8 vendor categories with per-vendor scheduler settings
- ✅ **MAP management**: Minimum advertised price tracking
- ✅ **Seller & email tooling**: Seller lists, multi-recipient report emails
- ✅ **Operations tools**: Tracking Extractor (PDF + OCR), FNSKU label generator
- ✅ **Micro-tools & job aids**: Admin-managed and personal tool collections
- ✅ **App feedback**: Structured feedback with electronic signature
- ✅ **Notifications**: In-app notification system
- ✅ **Maintenance mode**: Superadmin-controlled downtime page
- ✅ **Desktop client**: Native Windows app with auto-update

#### **User Experience**
- ✅ Personalized dashboard with drag-and-drop widgets
- ✅ Per-vendor scheduler countdowns
- ✅ Lazy-loaded routes for fast initial load
- ✅ `UserContext` — centralized auth/profile state
- ✅ Service worker (web only) for deploy refresh signaling
- ✅ API-driven desktop installer URL (no rebuild to change link)

### 1.3 Performance Optimizations

- ✅ Lazy loading of page components
- ✅ Centralized user context (fewer duplicate `/auth/me` calls)
- ✅ Cached auth tokens in API client
- ✅ Memoized expensive UI computations
- ✅ Tracking scan state persisted across navigation (`TrackingScanProvider`)

### 1.4 Database Design

- ✅ Comprehensive schema with migrations in `backend/database/`
- ✅ Foreign keys, timestamps, indexes
- ✅ SQL migration files per feature (feedback, micro-tools, tracking history, MFA flag, etc.)
- ✅ `CSV_OUTPUT_LOGIC.md` documents report column calculations

### 1.5 Developer Experience

- ✅ Clear monorepo layout (`backend/`, `frontend/`)
- ✅ TypeScript + Pydantic validation
- ✅ Dev scripts (`start-dev.ps1`, `check-dev.ps1`)
- ✅ Deployment guides for Render, Vercel, and Electron
- ✅ `.env.example` files for both apps
- ✅ Backend pytest with fixtures (`conftest.py`)

---

## 2. WEAKNESSES ⚠️

### 2.1 Testing

⚠️ **Partial Backend Coverage; No Frontend Tests**
```
Backend:
+ 85 pytest tests across API, services, repositories
+ pytest.ini with coverage reporting (~29% line coverage)
- Coverage still low for production confidence
- No integration tests against live Supabase

Frontend:
- No vitest/jest configuration
- No component or E2E tests

Severity: MEDIUM-HIGH (improved from HIGH)
```

### 2.2 Documentation

⚠️ **Good Operational Docs; Some Gaps Remain**
```
Present:
+ README.md (comprehensive)
+ DEPLOY_RENDER.md, DEPLOY_VERCEL.md, ELECTRON_SETUP.md
+ CSV_OUTPUT_LOGIC.md, INPUT_SANITIZATION_GUIDE.md
+ SENTRY_SETUP_GUIDE.md, RATE_LIMITING_IMPLEMENTATION.md
+ backend/.env.example, frontend/.env.example

Missing / stale:
- PROJECT_STRUCTURE.md lists removed APIs (notes.py, tasks.py)
- No architecture diagrams or ERD
- No CONTRIBUTING.md or CHANGELOG
- OpenAPI spec not committed to repo

Severity: LOW-MEDIUM (improved from MEDIUM)
```

### 2.3 Security Concerns

⚠️ **Strong MFA; Some Hardening Still Pending**
```
1. Rate limiting — partially applied to endpoints
   → auth, jobs, scheduler upload, tracking scanner, cli_chat decorated
   → Many read/write routes still unlimited

2. Input sanitization — utilities exist, not wired into handlers
   → bleach helpers in app/utils/sanitization.py
   → Risk: XSS if rich HTML surfaces are reintroduced

3. Sentry — dependency installed, init not called in main.py
   → No production error tracking until wired

4. Secrets in environment variables
   → Standard for Render/Vercel; consider secret manager at scale

5. Electron bypass of MFA — correctly NOT implemented
   → Desktop uses same TOTP flow as web

Severity: MEDIUM (improved from MEDIUM-HIGH)
```

### 2.4 Error Handling & Monitoring

⚠️ **Limited Production Observability**
```
Present:
+ Python logging with validation error redaction
+ /health and /api/v1/system/maintenance-status endpoints
+ Sentry config module (ready to enable)

Missing:
- Sentry not active in main.py
- No APM, metrics, or alerting
- No request correlation IDs
- Frontend Sentry not integrated

Severity: MEDIUM
```

### 2.5 Code Quality & Consistency

⚠️ **Decent Structure; Enforcement Gaps**
```
Backend:
- No black/flake8/mypy/pre-commit in repo
- Type hints incomplete in some modules

Frontend:
+ ESLint configured
+ TypeScript strict usage
- No Prettier config
- No pre-commit hooks

Severity: LOW-MEDIUM
```

### 2.6 Scalability Concerns

⚠️ **Fine for Current Scale**
```
1. Scheduler runs in-process with the web server on Render
   → App restart interrupts in-flight scheduled jobs

2. Rate limiter uses in-memory storage (SlowAPI default)
   → Not shared across multiple Render instances

3. No Redis/caching layer for hot reads

4. Long batch jobs may approach HTTP timeout limits

Severity: MEDIUM (adequate for ~100–1000 users)
```

### 2.7 Dependency Management

⚠️ **Functional but Manual**
```
Backend: requirements.txt (no poetry/pipenv lock beyond pins)
Frontend: package-lock.json present
- No Dependabot/Renovate
- No automated vulnerability scanning in CI

Severity: LOW
```

---

## 3. NEEDED IMPROVEMENTS 🔧

### 3.1 Critical Priority

#### **A. Expand Test Coverage** (in progress)

Backend foundation exists (85 tests, ~29% coverage). Next steps:

- Add tests for MFA/AAL2 enforcement, scheduler modes, feedback, tracking scanner
- Target **70%+ coverage** on `services/` and `api/`
- Introduce Vitest for critical frontend flows (login, MFA gate, protected routes)

#### **B. Wire Security Utilities** (partially done)

| Item | Status |
|------|--------|
| `.env.example` files | ✅ Done |
| Rate limiting infrastructure | ✅ Done |
| Rate limits on all sensitive endpoints | ⬜ Partial |
| Input sanitization in API handlers | ⬜ Utils only |
| Sentry `init_sentry()` in `main.py` | ⬜ Guide only |
| Frontend 429 retry handling | ⬜ Optional |

#### **C. CI/CD Pipeline** (not started)

Add `.github/workflows/ci.yml` to run `pytest` and `npm run lint` on every PR.

### 3.2 High Priority

- **Enable Sentry** — call `init_sentry()` on startup when `SENTRY_DSN` is set
- **Apply sanitization** — use `sanitize_html_content` / `sanitize_text_input` on user-written fields (feedback, tool descriptions)
- **Complete rate limit decorators** — per `RATE_LIMITING_IMPLEMENTATION.md`
- **Separate scheduler worker** — optional dedicated Render background worker
- **Update PROJECT_STRUCTURE.md** — remove references to retired notes/tasks APIs

### 3.3 Medium Priority

- Redis-backed rate limiting for multi-instance Render
- Alembic or formal migration runner for `backend/database/`
- Architecture diagram and database ERD
- Prettier + pre-commit hooks
- Frontend test suite (Vitest + Testing Library)

### 3.4 Low Priority

- API versioning strategy beyond `/api/v1`
- i18n if expanding beyond English
- Code signing for Windows Electron releases (currently unsigned local builds)

---

## 4. NEXT STEPS (Recommended Roadmap) 🗺️

### Phase 1: Security & Quality Baseline
1. ✅ `.env.example` files
2. ✅ Backend pytest foundation (85 tests)
3. ✅ Rate limiting infrastructure
4. ✅ Input sanitization utilities
5. ⬜ Wire Sentry in `main.py`
6. ⬜ Apply sanitization + remaining rate limits
7. ⬜ Raise backend coverage to 50%+

### Phase 2: CI/CD & Monitoring
1. ⬜ GitHub Actions (pytest + lint)
2. ⬜ Enable Sentry in production
3. ⬜ Frontend Vitest for auth/MFA paths

### Phase 3: Documentation & Structure
1. ⬜ Refresh `PROJECT_STRUCTURE.md`
2. ⬜ Architecture diagram + ERD
3. ⬜ CONTRIBUTING.md

### Phase 4: Scalability
1. ⬜ Optional scheduler worker process
2. ⬜ Redis rate limit storage
3. ⬜ Load testing on batch job endpoints

---

## 5. TECHNICAL DEBT ASSESSMENT 📊

### Current Debt Level: **MEDIUM-LOW** (improving)

```
Area                    Status  Impact                              Updated
──────────────────────────────────────────────────────────────────────────────
Testing                 🟡      MEDIUM — 85 tests, 29% coverage     Jun 2026
Documentation           🟢      LOW — deploy + feature guides       Jun 2026
Security                🟡      MEDIUM — MFA strong; wiring pending   Jun 2026
Scalability             🟡      MEDIUM — in-process scheduler       No change
Code Quality            🟡      MEDIUM — no pre-commit/CI           No change
Monitoring              🟡      MEDIUM — Sentry ready, not active   Jun 2026
Architecture            🟢      LOW — clean separation + Electron   Jun 2026
Performance             🟢      LOW — lazy loading, context caching   No change
Dependencies            🟢      LOW — pinned requirements           No change
```

**Estimated effort to reach target state**: 80–120 hours  
**Technical debt score**: 72/100 → target 88/100

---

## 6. RISK ASSESSMENT ⚠️

### High Risk
1. **Low test coverage relative to feature surface** — Mitigation: expand pytest + add CI
2. **No active error tracking in production** — Mitigation: enable Sentry

### Medium Risk
3. **Scheduler in web process** — Mitigation: background worker on Render
4. **Sanitization not applied** — Mitigation: wire bleach helpers before new HTML features
5. **In-memory rate limits** — Mitigation: Redis if scaling to multiple instances

### Low Risk
6. **Unsigned Electron builds** — Acceptable for internal distribution; sign for wide release
7. **Dependency drift** — Periodic `pip audit` / `npm audit`

---

## 7. COMPETITIVE ANALYSIS 🎯

**Compared to generic project management tools (Trello, Asana, Notion):**

✅ **Advantages**
- Integrated Keepa price monitoring and multi-vendor daily runs (unique)
- Custom workflow for warehouse/MSW operations
- Full data ownership (self-hosted API + Supabase)
- Windows desktop client with auto-update
- No per-seat SaaS licensing

⚠️ **Disadvantages**
- No native mobile apps (web + Windows desktop only)
- Narrower scope than general PM tools (notes/tasks de-emphasized)
- Self-hosted maintenance burden
- MFA adds friction (by design)

**Best suited for**: Small to medium operations teams (5–50 users) focused on Amazon/Keepa price monitoring and warehouse tooling.

---

## 8. RECOMMENDATIONS SUMMARY 📋

### Immediate (This Month)
1. Enable Sentry in `main.py` when `SENTRY_DSN` is set
2. Add GitHub Actions for backend tests + frontend lint
3. Apply rate limits and sanitization to remaining user-input endpoints
4. Raise backend test coverage toward 50%

### Short Term (This Quarter)
1. Frontend Vitest for login/MFA/protected routes
2. Refresh `PROJECT_STRUCTURE.md` to match current API surface
3. Redis rate limiting if running multiple API instances
4. Evaluate scheduler worker split on Render

### Long Term
1. Windows code signing for Electron releases
2. Formal migration tooling (Alembic)
3. Architecture documentation and ERD

---

## 9. CONCLUSION

### Overall Grade: **B+ (87/100)** ⬆️ Improved from 84/100 (Jan 2026)

**Breakdown:**

| Area | Score | Notes |
|------|-------|-------|
| Architecture | A (92) | Clean layers; web + Electron + Supabase |
| Features | A (93) | Keepa, 8 vendors, scanner, desktop, MFA |
| Security | B+ (85) | MFA + RLS + partial rate limits; Sentry/sanitization pending |
| Testing | C+ (58) | 85 backend tests; no frontend tests; ~29% coverage |
| Documentation | B+ (86) | Deploy guides, CSV logic, env examples |
| Scalability | B (80) | Adequate for current scale |
| Maintainability | B+ (85) | Good structure; needs CI |
| Performance | A- (90) | Lazy routes, cached auth |
| Monitoring | C+ (65) | Logging only; Sentry not wired |
| Code Quality | B (82) | ESLint + types; no pre-commit |

### Final Thoughts

MSW Overwatch is a mature internal operations platform with a strong Keepa-centric core, meaningful desktop distribution, and proper MFA. The largest gaps versus an A-grade system are **test coverage**, **production monitoring activation**, and **CI/CD** — all well-defined next steps with existing foundations (pytest, Sentry module, sanitization utils, rate limiter).

**Investment priority:**
1. CI + expand backend tests (24–40 h)
2. Enable Sentry + apply sanitization (8–12 h)
3. Complete rate limiting on all write endpoints (4–8 h)
4. Frontend test bootstrap (16–24 h)

---

## 10. RECENT UPDATES & CHANGELOG 🆕

### June 10, 2026 — Current Setup Audit

**Product**
- Rebranded to **MSW Overwatch** (v2.0.0); API title `MSW Overwatch API`
- **8 vendor schedulers**: DNK, CLK, OBZ, REF, BOR, SFF, TEV, CHA
- **Electron desktop** — Windows NSIS installer, GitHub Releases auto-update
- **TOTP MFA** — Supabase enrollment, `MfaGate`, backend AAL2 enforcement, 15h idle re-verify
- **New tools**: Tracking Extractor, FNSKU labels, micro-tools, app feedback
- **Maintenance mode** — public status endpoint + superadmin controls
- Notes/Team Tasks UI retired (routes redirect to dashboard)

**Infrastructure**
- `backend/.env.example` and `frontend/.env.example` in place
- Backend: **85 pytest tests**, ~29% coverage
- Rate limits on auth, jobs, scheduler upload, tracking scanner, cli_chat
- `bleach` sanitization utilities + `INPUT_SANITIZATION_GUIDE.md`
- `sentry-sdk` dependency + `SENTRY_SETUP_GUIDE.md` (init pending)
- Deployment docs: `DEPLOY_RENDER.md`, `DEPLOY_VERCEL.md`, `ELECTRON_SETUP.md`

**Grade impact**: 84 → **87** (+3) — MFA, Electron, tests, and operational docs

---

### January 15, 2026 — Rate Limiting Implementation

- SlowAPI integrated (`backend/app/middleware/rate_limiter.py`)
- Tiered limits (auth, jobs, uploads, read/write, admin)
- Custom 429 handler with `Retry-After` headers
- Guides: `RATE_LIMITING_IMPLEMENTATION.md`, `RATE_LIMITING_SUMMARY.md`

---

## 11. RESOURCES & REFERENCES

### Project Docs
- [README.md](README.md) — Setup and feature overview
- [backend/DEPLOY_RENDER.md](backend/DEPLOY_RENDER.md) — API deployment
- [frontend/DEPLOY_VERCEL.md](frontend/DEPLOY_VERCEL.md) — Web deployment
- [frontend/ELECTRON_SETUP.md](frontend/ELECTRON_SETUP.md) — Desktop builds
- [backend/CSV_OUTPUT_LOGIC.md](backend/CSV_OUTPUT_LOGIC.md) — Report calculations

### External
- [FastAPI Testing](https://fastapi.tiangolo.com/tutorial/testing/)
- [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Sentry FastAPI](https://docs.sentry.io/platforms/python/guides/fastapi/)
- [Render Docs](https://render.com/docs) · [Vercel Docs](https://vercel.com/docs)

---

**Report compiled by**: Claude (Anthropic AI Assistant)  
**Methodology**: Codebase audit, dependency review, test collection, doc inventory  
**Scope**: Backend + frontend + Electron + Supabase  
**Next review**: After CI/CD and Sentry are enabled, or Q3 2026
