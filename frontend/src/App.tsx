import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { UserProvider, useUser } from './contexts/UserContext'
import Layout from './components/layout/Layout'
import ProtectedRoute from './components/common/ProtectedRoute'

// Lazy load all page components for code splitting
const Landing = lazy(() => import('./components/Landing'))
const Login = lazy(() => import('./components/auth/Login'))
const Signup = lazy(() => import('./components/auth/Signup'))
const ResetPassword = lazy(() => import('./components/auth/ResetPassword'))
const Dashboard = lazy(() => import('./components/dashboard/Dashboard'))
const JobList = lazy(() => import('./components/jobs/JobList'))
const JobDetail = lazy(() => import('./components/jobs/JobDetail'))
const CreateJob = lazy(() => import('./components/jobs/CreateJob'))
const DailyRun = lazy(() => import('./components/jobs/DailyRun'))
const DNKDailyRun = lazy(() => import('./components/jobs/DNKDailyRun'))
const CLKDailyRun = lazy(() => import('./components/jobs/CLKDailyRun'))
const ReportView = lazy(() => import('./components/reports/ReportView'))
const UPCManagement = lazy(() => import('./components/upcs/UPCManagement'))
const MAPManagement = lazy(() => import('./components/map/MAPManagement'))
const PublicTools = lazy(() => import('./components/tools/PublicTools'))
const MyToolbox = lazy(() => import('./components/tools/MyToolbox'))
const JobAids = lazy(() => import('./components/tools/JobAids'))
const TeamTasks = lazy(() => import('./components/tasks/TeamTasks'))
const MyNotes = lazy(() => import('./components/notes/MyNotes'))
const Notifications = lazy(() => import('./components/notifications/Notifications'))
const UserManagement = lazy(() => import('./components/admin/UserManagement'))

// Loading spinner component
function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center space-y-4">
        <div className="w-12 h-12 border-4 border-[#0B1020] border-t-transparent rounded-full animate-spin"></div>
        <div className="text-gray-600">Loading...</div>
      </div>
    </div>
  )
}

// Inner app component that uses the user context
function AppRoutes() {
  const { authUser, authLoading } = useUser()

  if (authLoading) {
    return <LoadingSpinner />
  }

  const user = authUser // Alias for easier migration

  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={!user ? <Landing /> : <Navigate to="/dashboard" replace />} />
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/dashboard" replace />} />
        <Route path="/signup" element={!user ? <Signup /> : <Navigate to="/dashboard" replace />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        
        {/* Protected routes - wrapped in Layout */}
        <Route
          path="/"
          element={user ? <Layout /> : <Navigate to="/" replace />}
        >
          <Route path="dashboard" element={<Dashboard />} />

          {/* Keepa-access required routes */}
          <Route path="jobs" element={<ProtectedRoute requireKeepaAccess={true}><JobList /></ProtectedRoute>} />
          <Route path="jobs/new" element={<ProtectedRoute requireKeepaAccess={true}><CreateJob /></ProtectedRoute>} />
          <Route path="jobs/:jobId" element={<ProtectedRoute requireKeepaAccess={true}><JobDetail /></ProtectedRoute>} />
          <Route path="reports/:jobId" element={<ProtectedRoute requireKeepaAccess={true}><ReportView /></ProtectedRoute>} />
          <Route path="upcs" element={<ProtectedRoute requireKeepaAccess={true}><UPCManagement category="dnk" /></ProtectedRoute>} />
          <Route path="clk-upcs" element={<ProtectedRoute requireKeepaAccess={true}><UPCManagement category="clk" /></ProtectedRoute>} />
          <Route path="map" element={<ProtectedRoute requireKeepaAccess={true}><MAPManagement /></ProtectedRoute>} />
          <Route path="daily-run" element={<Navigate to="/daily-run/dnk" replace />} />
          <Route path="daily-run/dnk" element={<ProtectedRoute requireKeepaAccess={true}><DNKDailyRun /></ProtectedRoute>} />
          <Route path="daily-run/clk" element={<ProtectedRoute requireKeepaAccess={true}><CLKDailyRun /></ProtectedRoute>} />

          {/* General authenticated routes */}
          <Route path="team-tasks" element={<TeamTasks />} />
          <Route path="my-space/notes" element={<MyNotes />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="tools/public" element={<PublicTools />} />
          <Route path="tools/my-toolbox" element={<MyToolbox />} />
          <Route path="tools/job-aids" element={<JobAids />} />
          <Route path="admin/users" element={<UserManagement />} />
        </Route>
      </Routes>
    </Suspense>
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

