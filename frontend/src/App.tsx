import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Layout from './components/layout/Layout'
import Login from './components/auth/Login'
import Signup from './components/auth/Signup'
import Dashboard from './components/dashboard/Dashboard'
import JobList from './components/jobs/JobList'
import JobDetail from './components/jobs/JobDetail'
import CreateJob from './components/jobs/CreateJob'
import ReportView from './components/reports/ReportView'
import UPCManagement from './components/upcs/UPCManagement'
import PublicTools from './components/tools/PublicTools'
import MyToolbox from './components/tools/MyToolbox'
import TaskList from './components/tasks/TaskList'
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
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/dashboard" />} />
        <Route path="/signup" element={!user ? <Signup /> : <Navigate to="/dashboard" />} />
        
        <Route
          path="/"
          element={user ? <Layout /> : <Navigate to="/login" />}
        >
          <Route index element={<Navigate to="/dashboard" />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route 
            path="jobs" 
            element={
              <ProtectedRoute requireKeepaAccess={true}>
                <JobList />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="jobs/new" 
            element={
              <ProtectedRoute requireKeepaAccess={true}>
                <CreateJob />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="jobs/:jobId" 
            element={
              <ProtectedRoute requireKeepaAccess={true}>
                <JobDetail />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="reports/:jobId" 
            element={
              <ProtectedRoute requireKeepaAccess={true}>
                <ReportView />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="upcs" 
            element={
              <ProtectedRoute requireKeepaAccess={true}>
                <UPCManagement />
              </ProtectedRoute>
            } 
          />
          <Route path="tasks" element={<TaskList />} />
          <Route path="tools/public" element={<PublicTools />} />
          <Route path="tools/my-toolbox" element={<MyToolbox />} />
        </Route>
      </Routes>
    </Router>
  )
}

export default App

