import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { authApi } from '../services/api'

// Extended user info from API
export interface UserInfo {
  id: string
  email: string
  role?: string
  display_name?: string
  has_keepa_access: boolean
  can_manage_tools: boolean
  can_assign_tasks: boolean
  created_at?: string
}

interface UserContextType {
  // Supabase auth user (for auth state)
  authUser: any | null
  // Extended user info from API
  userInfo: UserInfo | null
  // Loading states
  authLoading: boolean
  userInfoLoading: boolean
  // Helper computed properties
  isAuthenticated: boolean
  hasKeepaAccess: boolean
  canManageTools: boolean
  canAssignTasks: boolean
  isSuperadmin: boolean
  displayName: string
  // Actions
  refetchUserInfo: () => Promise<void>
  signOut: () => Promise<void>
}

const UserContext = createContext<UserContextType | undefined>(undefined)

interface UserProviderProps {
  children: ReactNode
}

export function UserProvider({ children }: UserProviderProps) {
  const [authUser, setAuthUser] = useState<any | null>(null)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [userInfoLoading, setUserInfoLoading] = useState(false)

  // Fetch extended user info from API
  const fetchUserInfo = useCallback(async () => {
    if (!authUser) {
      setUserInfo(null)
      return
    }

    setUserInfoLoading(true)
    try {
      const data = await authApi.getCurrentUser()
      setUserInfo({
        id: data.id || authUser.id,
        email: data.email || authUser.email,
        role: data.role,
        display_name: data.display_name,
        has_keepa_access: data.has_keepa_access || false,
        can_manage_tools: data.can_manage_tools || false,
        can_assign_tasks: data.can_assign_tasks || false,
        created_at: data.created_at,
      })
    } catch (error) {
      console.error('Failed to fetch user info:', error)
      // Set minimal info from auth user if API fails
      setUserInfo({
        id: authUser.id,
        email: authUser.email,
        has_keepa_access: false,
        can_manage_tools: false,
        can_assign_tasks: false,
      })
    } finally {
      setUserInfoLoading(false)
    }
  }, [authUser])

  // Initialize auth state
  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ?? null)
      setAuthLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null)
      // Clear user info when logging out
      if (!session?.user) {
        setUserInfo(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Fetch user info when auth user changes
  useEffect(() => {
    if (authUser && !authLoading) {
      fetchUserInfo()
    }
  }, [authUser, authLoading, fetchUserInfo])

  const signOut = async () => {
    await supabase.auth.signOut()
    setUserInfo(null)
  }

  // Computed properties
  const isAuthenticated = !!authUser
  const hasKeepaAccess = userInfo?.has_keepa_access || false
  const canManageTools = userInfo?.can_manage_tools || false
  const canAssignTasks = userInfo?.can_assign_tasks || false
  const isSuperadmin = userInfo?.email?.toLowerCase() === 'orvillebarba@gmail.com'
  const displayName = userInfo?.display_name || userInfo?.email?.split('@')[0] || 'User'

  const value: UserContextType = {
    authUser,
    userInfo,
    authLoading,
    userInfoLoading,
    isAuthenticated,
    hasKeepaAccess,
    canManageTools,
    canAssignTasks,
    isSuperadmin,
    displayName,
    refetchUserInfo: fetchUserInfo,
    signOut,
  }

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

// Custom hook to use the user context
export function useUser() {
  const context = useContext(UserContext)
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider')
  }
  return context
}
