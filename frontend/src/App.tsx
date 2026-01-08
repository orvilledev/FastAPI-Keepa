import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Layout from './components/layout/Layout'
import Landing from './components/Landing'
import Login from './components/auth/Login'
import Signup from './components/auth/Signup'
import ResetPassword from './components/auth/ResetPassword'
import Dashboard from './components/dashboard/Dashboard'
import JobList from './components/jobs/JobList'
import JobDetail from './components/jobs/JobDetail'
import CreateJob from './components/jobs/CreateJob'
import DailyRun from './components/jobs/DailyRun'
import ReportView from './components/reports/ReportView'
import UPCManagement from './components/upcs/UPCManagement'
import MAPManagement from './components/map/MAPManagement'
import PublicTools from './components/tools/PublicTools'
import MyToolbox from './components/tools/MyToolbox'
import JobAids from './components/tools/JobAids'
import TaskList from './components/tasks/TaskList'
import MyNotes from './components/notes/MyNotes'
import UserManagement from './components/admin/UserManagement'
import ProtectedRoute from './components/common/ProtectedRoute'

function App() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  return (
    <Router>
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
          <Route path="tasks" element={user ? <TaskList /> : <Navigate to="/" replace />} />
          <Route path="my-space/notes" element={user ? <MyNotes /> : <Navigate to="/" replace />} />
          <Route path="tools/public" element={user ? <PublicTools /> : <Navigate to="/" replace />} />
          <Route path="tools/my-toolbox" element={user ? <MyToolbox /> : <Navigate to="/" replace />} />
          <Route path="tools/job-aids" element={user ? <JobAids /> : <Navigate to="/" replace />} />
          <Route path="admin/users" element={user ? <UserManagement /> : <Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  )
}

export default App

