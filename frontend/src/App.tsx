import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useParams,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { UserProvider, useUser } from './contexts/UserContext'
import { TrackingScanProvider } from './contexts/TrackingScanContext'
import Layout from './components/layout/Layout'
import ProtectedRoute from './components/common/ProtectedRoute'
import WarehouseRouteGuard from './components/common/WarehouseRouteGuard'
import MfaGate from './components/auth/MfaGate'
import About from './components/About'
import Maintenance from './components/Maintenance'
import DesktopUpdateOverlay from './components/desktop/DesktopUpdateOverlay'
import { systemApi } from './services/api'
import { fetchMfaStatus, isMfaIdleReverifyDue, recordMfaActivity, shouldShowMfaSetup, shouldShowMfaVerify, shouldSkipMfaForEmail } from './lib/mfa'
import { isUserHiddenFromFeedbackPage } from './constants/feedbackAccess'
import { getLastPrivatePath, setLastPrivatePath } from './lib/privatePath'
import { WAREHOUSE_HOME_PATH, isWarehouseAllowedPath } from './constants/warehouseAccess'

// Lazy load page components for code splitting (About is eager so its chunk cannot 404 behind stale CDN/cache)
const Landing = lazy(() => import('./components/Landing'))
const Login = lazy(() => import('./components/auth/Login'))
const MfaSetup = lazy(() => import('./components/auth/MfaSetup'))
const MfaVerify = lazy(() => import('./components/auth/MfaVerify'))
const ResetPassword = lazy(() => import('./components/auth/ResetPassword'))
const Dashboard = lazy(() => import('./components/dashboard/Dashboard'))
const JobList = lazy(() => import('./components/jobs/JobList'))
const JobDetail = lazy(() => import('./components/jobs/JobDetail'))
const CreateJob = lazy(() => import('./components/jobs/CreateJob'))
const DNKDailyRun = lazy(() => import('./components/jobs/DNKDailyRun'))
const CLKDailyRun = lazy(() => import('./components/jobs/CLKDailyRun'))
const OBZDailyRun = lazy(() => import('./components/jobs/OBZDailyRun'))
const REFDailyRun = lazy(() => import('./components/jobs/REFDailyRun'))
const BORDailyRun = lazy(() => import('./components/jobs/BORDailyRun'))
const SFFDailyRun = lazy(() => import('./components/jobs/SFFDailyRun'))
const TEVDailyRun = lazy(() => import('./components/jobs/TEVDailyRun'))
const CHADailyRun = lazy(() => import('./components/jobs/CHADailyRun'))
const DailyRunsMenu = lazy(() => import('./components/jobs/DailyRunsMenu'))
const ReportView = lazy(() => import('./components/reports/ReportView'))
const UPCManagement = lazy(() => import('./components/upcs/UPCManagement'))
const ManageUPCsHub = lazy(() => import('./components/upcs/ManageUPCsHub'))
const MAPManagement = lazy(() => import('./components/map/MAPManagement'))
const SellerList = lazy(() => import('./components/sellers/SellerList'))
const EmailList = lazy(() => import('./components/email/EmailList'))
const HowToGuide = lazy(() => import('./components/tools/PublicTools'))
const JobAids = lazy(() => import('./components/tools/JobAids'))
const MicroTools = lazy(() => import('./components/tools/MicroTools'))
const TrackingScanner = lazy(() => import('./components/scanner/TrackingScanner'))
const FNSKULabelGenerator = lazy(() => import('./components/scanner/FNSKULabelGenerator'))
const LabelStation = lazy(() => import('./components/scanner/LabelStation'))
const Notifications = lazy(() => import('./components/notifications/Notifications'))
const UserManagement = lazy(() => import('./components/admin/UserManagement'))
const Feedback = lazy(() => import('./components/feedback/Feedback'))

/** Packaged Electron loads `index.html` over `file:`; BrowserRouter cannot match routes there. */
function AppRouter({ children }: { children: ReactNode }) {
  const useHash = typeof window !== 'undefined' && window.location.protocol === 'file:'
  if (useHash) {
    return <HashRouter>{children}</HashRouter>
  }
  return <BrowserRouter>{children}</BrowserRouter>
}

// Loading spinner component
function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center space-y-4">
        <div className="w-12 h-12 border-4 border-[#404040] border-t-transparent rounded-full animate-spin"></div>
        <div className="text-gray-600">Loading...</div>
      </div>
    </div>
  )
}

/** Sends signed-in users to the correct post-login step (MFA setup, verify, or home). */
function AuthenticatedEntryRedirect() {
  const { authUser, authLoading, isWarehouseOnly, userInfoLoading } = useUser()
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (authLoading || !authUser) return

    void shouldSkipMfaForEmail(authUser.email)
      .then((skipMfa) => {
        if (cancelled) return
        if (skipMfa) {
          setTarget(WAREHOUSE_HOME_PATH)
          return
        }
        return fetchMfaStatus().then((status) => {
          if (cancelled) return
          if (shouldShowMfaSetup(status)) setTarget('/mfa/setup')
          else if (shouldShowMfaVerify(status)) setTarget('/mfa/verify')
          else setTarget('/dashboard')
        })
      })
      .catch(() => {
        if (!cancelled) setTarget('/mfa/setup')
      })

    return () => {
      cancelled = true
    }
  }, [authUser, authLoading])

  if (authLoading || !authUser || !target || (userInfoLoading && target === '/dashboard')) {
    return <LoadingSpinner />
  }

  let destination = isWarehouseOnly ? WAREHOUSE_HOME_PATH : target
  const lastPrivatePath = getLastPrivatePath()
  if (
    !isWarehouseOnly &&
    destination === '/dashboard' &&
    lastPrivatePath &&
    lastPrivatePath !== '/'
  ) {
    destination = lastPrivatePath
  }
  return <Navigate to={destination} replace />
}

/** Logged-in users hitting / are sent through MFA checks first. */
function PublicHome() {
  const { authUser } = useUser()
  if (authUser) {
    return <AuthenticatedEntryRedirect />
  }
  return <Landing />
}

/** Logged-in users are redirected away from guest-only routes (login/signup). */
function GuestRoute({ children }: { children: React.ReactNode }) {
  const { authUser } = useUser()
  const location = useLocation()
  // Let Login finish MFA routing after signInWithPassword; redirecting here caused dashboard/API races and sign-out.
  if (authUser && location.pathname !== '/login') {
    return <AuthenticatedEntryRedirect />
  }
  return <>{children}</>
}

/**
 * Redirect helper for the legacy `/daily-run/uploaded/:vendor` route. Import
 * and API runs were merged into a single per-vendor page (`/daily-run/:vendor`),
 * but old bookmarks / emails should still resolve to the new location.
 */
function UploadedVendorRedirect() {
  const { vendor } = useParams<{ vendor: string }>()
  const target = vendor ? `/daily-run/${vendor.toLowerCase()}` : '/daily-run'
  return <Navigate to={target} replace />
}

/**
 * Wraps all authenticated app pages in the main layout; sends guests to the
 * landing page. TrackingScanProvider lives here — above the routed Outlet — so
 * an in-browser Tracking Extractor scan keeps running and its progress/results
 * survive navigation between pages (it only unmounts on logout).
 */
/**
 * Tracks user activity inside the authenticated app and forces a TOTP re-verify
 * after the idle limit (default 15h). Only mounted once MFA has fully passed.
 */
function IdleMfaGuard() {
  const navigate = useNavigate()
  const { authUser, userInfo } = useUser()

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | undefined

    const run = async () => {
      if (userInfo?.mfa_exempt) return
      if (await shouldSkipMfaForEmail(authUser?.email)) return
      if (cancelled) return

      let lastWrite = 0
      const onActivity = () => {
        const now = Date.now()
        // Throttle writes; we only need minute-level resolution for a 15h window.
        if (now - lastWrite > 30_000) {
          lastWrite = now
          recordMfaActivity(now)
        }
      }
      const events: Array<keyof WindowEventMap> = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click']
      events.forEach((event) => window.addEventListener(event, onActivity, { passive: true }))

      const check = () => {
        if (isMfaIdleReverifyDue()) {
          navigate('/mfa/verify?reason=idle', { replace: true })
        }
      }
      const interval = window.setInterval(check, 60_000)
      window.addEventListener('focus', check)
      document.addEventListener('visibilitychange', check)
      check()

      cleanup = () => {
        events.forEach((event) => window.removeEventListener(event, onActivity))
        window.clearInterval(interval)
        window.removeEventListener('focus', check)
        document.removeEventListener('visibilitychange', check)
      }
    }

    void run()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [navigate, authUser?.email, userInfo?.mfa_exempt])

  return null
}

function PrivateLayout() {
  const { authUser } = useUser()
  if (!authUser) {
    return <Navigate to="/" replace />
  }
  return (
    <MfaGate>
      <IdleMfaGuard />
      <TrackingScanProvider>
        <WarehouseRouteGuard>
          <Layout>
            <Outlet />
          </Layout>
        </WarehouseRouteGuard>
      </TrackingScanProvider>
    </MfaGate>
  )
}

/** Remembers the last in-app private URL for refresh recovery. */
function RememberLastPrivatePath() {
  const { authUser, isWarehouseOnly } = useUser()
  const location = useLocation()

  useEffect(() => {
    if (!authUser) return
    const path = `${location.pathname}${location.search}${location.hash}`
    const isGuestRoute =
      location.pathname === '/' ||
      location.pathname === '/login' ||
      location.pathname === '/signup' ||
      location.pathname === '/reset-password' ||
      location.pathname === '/mfa/setup' ||
      location.pathname === '/mfa/verify'
    if (isGuestRoute) return
    if (isWarehouseOnly && !isWarehouseAllowedPath(location.pathname)) return
    setLastPrivatePath(path)
  }, [authUser, isWarehouseOnly, location.pathname, location.search, location.hash])

  return null
}

function FeedbackRoute() {
  const { userInfoLoading, userInfo, authUser, isWarehouseOnly } = useUser()
  if (userInfoLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-gray-500">
        Loading…
      </div>
    )
  }
  if (
    isUserHiddenFromFeedbackPage(userInfo?.display_name, userInfo?.email, authUser?.email)
  ) {
    return <Navigate to={isWarehouseOnly ? WAREHOUSE_HOME_PATH : '/dashboard'} replace />
  }
  return <Feedback />
}

// Inner app component that uses the user context
function AppRoutes() {
  const { authLoading, authUser, userInfoLoading, isSuperadmin, userInfo } = useUser()
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState<string>('')
  const [maintenanceExpectedEndAt, setMaintenanceExpectedEndAt] = useState<string | null>(null)
  const [maintenanceDurationHours, setMaintenanceDurationHours] = useState<number | null>(null)
  const [maintenanceChecked, setMaintenanceChecked] = useState(false)

  useEffect(() => {
    let active = true
    const loadMaintenanceStatus = async () => {
      try {
        const status = await systemApi.getMaintenanceStatus()
        if (!active) return
        setMaintenanceMode(Boolean(status.maintenance_mode))
        setMaintenanceMessage((status.effective_message || status.message || '').trim())
        setMaintenanceExpectedEndAt(status.expected_end_at || null)
        setMaintenanceDurationHours(
          typeof status.duration_hours === 'number' ? status.duration_hours : null
        )
      } catch {
        if (!active) return
        setMaintenanceMode(false)
        setMaintenanceMessage('')
        setMaintenanceExpectedEndAt(null)
        setMaintenanceDurationHours(null)
      } finally {
        if (active) setMaintenanceChecked(true)
      }
    }
    void loadMaintenanceStatus()
    const interval = setInterval(() => void loadMaintenanceStatus(), 60_000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  if (authLoading || !maintenanceChecked) {
    return <LoadingSpinner />
  }

  if (maintenanceMode && (!authUser || userInfoLoading || !isSuperadmin)) {
    if (authUser && userInfoLoading) return <LoadingSpinner />
    return (
      <Maintenance
        message={maintenanceMessage}
        expectedEndAt={maintenanceExpectedEndAt}
        durationHours={maintenanceDurationHours}
      />
    )
  }

  return (
    <>
      <RememberLastPrivatePath />
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route path="/" element={<PublicHome />} />
        <Route
          path="/login"
          element={
            <GuestRoute>
              <Login />
            </GuestRoute>
          }
        />
        <Route
          path="/mfa/setup"
          element={
            <MfaGate requireFullAuth={false}>
              <MfaSetup />
            </MfaGate>
          }
        />
        <Route
          path="/mfa/verify"
          element={
            <MfaGate requireFullAuth={false}>
              <MfaVerify />
            </MfaGate>
          }
        />
        <Route path="/notes-popout" element={<Navigate to="/dashboard" replace />} />

        <Route element={<PrivateLayout />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="about" element={<About />} />
          <Route path="feedback" element={<FeedbackRoute />} />
          <Route path="dev-md" element={<Navigate to="/dashboard" replace />} />

          <Route path="jobs" element={<ProtectedRoute requireKeepaAccess={true}><JobList /></ProtectedRoute>} />
          <Route path="jobs/new" element={<ProtectedRoute requireKeepaAccess={true}><CreateJob /></ProtectedRoute>} />
          <Route path="jobs/:jobId" element={<ProtectedRoute requireKeepaAccess={true}><JobDetail /></ProtectedRoute>} />
          <Route path="reports/:jobId" element={<ProtectedRoute requireKeepaAccess={true}><ReportView /></ProtectedRoute>} />
          <Route path="manage-upcs" element={<ProtectedRoute requireKeepaAccess={true}><ManageUPCsHub /></ProtectedRoute>} />
          <Route path="upcs" element={<ProtectedRoute requireKeepaAccess={true}><UPCManagement /></ProtectedRoute>} />
          <Route path="clk-upcs" element={<Navigate to="/upcs?category=clk" replace />} />
          <Route path="map" element={<ProtectedRoute requireKeepaAccess={true}><MAPManagement /></ProtectedRoute>} />
          <Route path="vendor-list" element={<Navigate to="/seller-list" replace />} />
          <Route path="seller-list" element={<ProtectedRoute requireKeepaAccess={true}><SellerList /></ProtectedRoute>} />
          <Route path="email-list" element={<ProtectedRoute requireKeepaAccess={true}><EmailList /></ProtectedRoute>} />
          <Route path="daily-run" element={<ProtectedRoute requireKeepaAccess={true}><DailyRunsMenu /></ProtectedRoute>} />
          <Route path="daily-run/api" element={<Navigate to="/daily-run" replace />} />
          <Route path="daily-run/uploaded" element={<Navigate to="/daily-run" replace />} />
          <Route path="daily-run/uploaded/:vendor" element={<UploadedVendorRedirect />} />
          <Route path="daily-run/dnk" element={<ProtectedRoute requireKeepaAccess={true}><DNKDailyRun /></ProtectedRoute>} />
          <Route path="daily-run/clk" element={<ProtectedRoute requireKeepaAccess={true}><CLKDailyRun /></ProtectedRoute>} />
          <Route path="daily-run/obz" element={<ProtectedRoute requireKeepaAccess={true}><OBZDailyRun /></ProtectedRoute>} />
          <Route path="daily-run/ref" element={<ProtectedRoute requireKeepaAccess={true}><REFDailyRun /></ProtectedRoute>} />
          <Route path="daily-run/bor" element={<ProtectedRoute requireKeepaAccess={true}><BORDailyRun /></ProtectedRoute>} />
          <Route path="daily-run/sff" element={<ProtectedRoute requireKeepaAccess={true}><SFFDailyRun /></ProtectedRoute>} />
          <Route path="daily-run/tev" element={<ProtectedRoute requireKeepaAccess={true}><TEVDailyRun /></ProtectedRoute>} />
          <Route path="daily-run/cha" element={<ProtectedRoute requireKeepaAccess={true}><CHADailyRun /></ProtectedRoute>} />
          <Route path="daily-run/calendar" element={<Navigate to="/dashboard" replace />} />

          <Route path="reminders" element={<Navigate to="/dashboard" replace />} />
          <Route path="my-space/notes" element={<Navigate to="/dashboard" replace />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="howtoguide" element={<HowToGuide />} />
          <Route path="trainings" element={<Navigate to="/howtoguide" replace />} />
          <Route path="faq" element={<JobAids />} />
          <Route path="micro-tools" element={<MicroTools />} />
          <Route path="tracking-scanner" element={<TrackingScanner />} />
          <Route path="fnsku-labels" element={<FNSKULabelGenerator />} />
          <Route
            path="label-station"
            element={<ProtectedRoute requireLabelStationAccess={true}><LabelStation /></ProtectedRoute>}
          />
          {/* Assistant chat UI hidden for now — deep links go to dashboard */}
          <Route path="assistant" element={<Navigate to="/dashboard" replace />} />
          <Route path="tools/public" element={<Navigate to="/howtoguide" replace />} />
          <Route path="tools/job-aids" element={<Navigate to="/faq" replace />} />
          <Route path="tools/my-toolbox" element={<Navigate to="/dashboard" replace />} />
          <Route path="admin/users" element={<UserManagement />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}

// Main App component wrapped with providers
function App() {
  return (
    <AppRouter>
      <UserProvider>
        <AppRoutes />
        <DesktopUpdateOverlay />
      </UserProvider>
    </AppRouter>
  )
}

export default App
