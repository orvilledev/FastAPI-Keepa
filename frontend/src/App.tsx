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
const ReportView = lazy(() => import('./components/reports/ReportView'))
const UPCManagement = lazy(() => import('./components/upcs/UPCManagement'))
const MAPManagement = lazy(() => import('./components/map/MAPManagement'))
const PublicTools = lazy(() => import('./components/tools/PublicTools'))
const MyToolbox = lazy(() => import('./components/tools/MyToolbox'))
const JobAids = lazy(() => import('./components/tools/JobAids'))
const TeamTasks = lazy(() => import('./components/tasks/TeamTasks'))
const MyNotes = lazy(() => import('./components/notes/MyNotes'))
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
          <Route path="dashboard" element={user ? <Dashboard /> : <Navigate to="/" replace />} />
          <Route 
            path="jobs" 
            element={
              user ? (
                <ProtectedRoute requireKeepaAccess={true}>
                  <JobList />
                </ProtectedRoute>
              ) : (
                <Navigate to="/" replace />
              )
            } 
          />
          <Route 
            path="jobs/new" 
            element={
              user ? (
                <ProtectedRoute requireKeepaAccess={true}>
                  <CreateJob />
                </ProtectedRoute>
              ) : (
                <Navigate to="/" replace />
              )
            } 
          />
          <Route 
            path="jobs/:jobId" 
            element={
              user ? (
                <ProtectedRoute requireKeepaAccess={true}>
                  <JobDetail />
                </ProtectedRoute>
              ) : (
                <Navigate to="/" replace />
              )
            } 
          />
          <Route 
            path="reports/:jobId" 
            element={
              user ? (
                <ProtectedRoute requireKeepaAccess={true}>
                  <ReportView />
                </ProtectedRoute>
              ) : (
                <Navigate to="/" replace />
              )
            } 
          />
          <Route 
            path="upcs" 
            element={
              user ? (
                <ProtectedRoute requireKeepaAccess={true}>
                  <UPCManagement />
                </ProtectedRoute>
              ) : (
                <Navigate to="/" replace />
              )
            } 
          />
          <Route 
            path="map" 
            element={
              user ? (
                <ProtectedRoute requireKeepaAccess={true}>
                  <MAPManagement />
                </ProtectedRoute>
              ) : (
                <Navigate to="/" replace />
              )
            } 
          />
          <Route 
            path="daily-run" 
            element={
              user ? (
                <ProtectedRoute requireKeepaAccess={true}>
                  <DailyRun />
                </ProtectedRoute>
              ) : (
                <Navigate to="/" replace />
              )
            } 
          />
          <Route path="team-tasks" element={user ? <TeamTasks /> : <Navigate to="/" replace />} />
          <Route path="my-space/notes" element={user ? <MyNotes /> : <Navigate to="/" replace />} />
          <Route path="tools/public" element={user ? <PublicTools /> : <Navigate to="/" replace />} />
          <Route path="tools/my-toolbox" element={user ? <MyToolbox /> : <Navigate to="/" replace />} />
          <Route path="tools/job-aids" element={user ? <JobAids /> : <Navigate to="/" replace />} />
          <Route path="admin/users" element={user ? <UserManagement /> : <Navigate to="/" replace />} />
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

