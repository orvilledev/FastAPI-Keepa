import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useParams, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, useState } from 'react'
import { UserProvider, useUser } from './contexts/UserContext'
import Layout from './components/layout/Layout'
import ProtectedRoute from './components/common/ProtectedRoute'
import About from './components/About'
import Maintenance from './components/Maintenance'
import { systemApi } from './services/api'

// Lazy load page components for code splitting (About is eager so its chunk cannot 404 behind stale CDN/cache)
const Landing = lazy(() => import('./components/Landing'))
const Login = lazy(() => import('./components/auth/Login'))
const Signup = lazy(() => import('./components/auth/Signup'))
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
const RunCalendar = lazy(() => import('./components/jobs/RunCalendar'))
const ReportView = lazy(() => import('./components/reports/ReportView'))
const UPCManagement = lazy(() => import('./components/upcs/UPCManagement'))
const MAPManagement = lazy(() => import('./components/map/MAPManagement'))
const SellerList = lazy(() => import('./components/sellers/SellerList'))
const EmailList = lazy(() => import('./components/email/EmailList'))
const HowToGuide = lazy(() => import('./components/tools/PublicTools'))
const JobAids = lazy(() => import('./components/tools/JobAids'))
const Notifications = lazy(() => import('./components/notifications/Notifications'))
const UserManagement = lazy(() => import('./components/admin/UserManagement'))
const MyNotes = lazy(() => import('./components/notes/MyNotes'))
const LAST_PRIVATE_PATH_KEY = 'last_private_path'

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

/** Logged-in users hitting / are sent to the dashboard; guests see the landing page. */
function PublicHome() {
  const { authUser } = useUser()
  if (authUser) {
    const lastPrivatePath = sessionStorage.getItem(LAST_PRIVATE_PATH_KEY)
    if (lastPrivatePath && lastPrivatePath !== '/') {
      return <Navigate to={lastPrivatePath} replace />
    }
    return <Navigate to="/dashboard" replace />
  }
  return <Landing />
}

/** Logged-in users are redirected away from guest-only routes (login/signup). */
function GuestRoute({ children }: { children: React.ReactNode }) {
  const { authUser } = useUser()
  if (authUser) {
    return <Navigate to="/dashboard" replace />
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

/** Wraps all authenticated app pages in the main layout; sends guests to the landing page. */
function PrivateLayout() {
  const { authUser } = useUser()
  if (!authUser) {
    return <Navigate to="/" replace />
  }
  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}

/** Remembers the last in-app private URL for refresh recovery. */
function RememberLastPrivatePath() {
  const { authUser } = useUser()
  const location = useLocation()

  useEffect(() => {
    if (!authUser) return
    const path = `${location.pathname}${location.search}${location.hash}`
    const isGuestRoute =
      location.pathname === '/' ||
      location.pathname === '/login' ||
      location.pathname === '/signup' ||
      location.pathname === '/reset-password'
    if (isGuestRoute) return
    sessionStorage.setItem(LAST_PRIVATE_PATH_KEY, path)
  }, [authUser, location.pathname, location.search, location.hash])

  return null
}

// Inner app component that uses the user context
function AppRoutes() {
  const { authLoading, authUser, userInfoLoading, isSuperadmin } = useUser()
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
    return () => {
      active = false
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
          path="/signup"
          element={
            <GuestRoute>
              <Signup />
            </GuestRoute>
          }
        />

        <Route element={<PrivateLayout />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="about" element={<About />} />

          <Route path="jobs" element={<ProtectedRoute requireKeepaAccess={true}><JobList /></ProtectedRoute>} />
          <Route path="jobs/new" element={<ProtectedRoute requireKeepaAccess={true}><CreateJob /></ProtectedRoute>} />
          <Route path="jobs/:jobId" element={<ProtectedRoute requireKeepaAccess={true}><JobDetail /></ProtectedRoute>} />
          <Route path="reports/:jobId" element={<ProtectedRoute requireKeepaAccess={true}><ReportView /></ProtectedRoute>} />
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
          <Route path="daily-run/calendar" element={<ProtectedRoute requireKeepaAccess={true}><RunCalendar /></ProtectedRoute>} />

          <Route path="reminders" element={<MyNotes />} />
          <Route path="my-space/notes" element={<Navigate to="/reminders" replace />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="howtoguide" element={<HowToGuide />} />
          <Route path="trainings" element={<Navigate to="/howtoguide" replace />} />
          <Route path="faq" element={<JobAids />} />
          <Route path="tools/public" element={<Navigate to="/howtoguide" replace />} />
          <Route path="tools/job-aids" element={<Navigate to="/faq" replace />} />
          <Route path="tools/my-toolbox" element={<Navigate to="/dashboard" replace />} />
          <Route path="admin/users" element={<UserManagement />} />
        </Route>
        </Routes>
      </Suspense>
    </>
  )
}

// Main App component wrapped with providers
function App() {
  return (
    <Router>
      <UserProvider>
        <AppRoutes />
      </UserProvider>
    </Router>
  )
}

export default App
