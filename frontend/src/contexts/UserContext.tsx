import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { authApi } from '../services/api'
import { redirectForIncompleteMfa } from '../lib/mfa'

// Extended user info from API
export interface UserInfo {
  id: string
  email: string
  role?: string
  display_name?: string
  has_keepa_access: boolean
  can_manage_tools: boolean
  is_superadmin?: boolean
  mfa_enabled?: boolean
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
      const emailLower = (data.email || authUser.email || '').toLowerCase()
      setUserInfo({
        id: data.id || authUser.id,
        email: data.email || authUser.email,
        role: data.role,
        display_name: data.display_name,
        has_keepa_access: data.has_keepa_access || false,
        can_manage_tools: data.can_manage_tools || false,
        is_superadmin: Boolean(data.is_superadmin) || emailLower === 'orvillebarba@gmail.com',
        mfa_enabled: Boolean(data.mfa_enabled),
        created_at: data.created_at,
      })
    } catch (error) {
      console.error('Failed to fetch user info:', error)
      const status = (error as { response?: { status?: number; data?: { detail?: string } } })?.response?.status
      const detail = (error as { response?: { status?: number; data?: { detail?: string } } })?.response?.data?.detail
      if (status === 401 && typeof detail === 'string' && detail.toLowerCase().includes('mfa verification required')) {
        setUserInfo(null)
        void redirectForIncompleteMfa()
        return
      }
      if (status === 403 && typeof detail === 'string' && detail.toLowerCase().includes('pending superadmin approval')) {
        sessionStorage.setItem('auth_notice', 'Your account is pending superadmin approval.')
        await supabase.auth.signOut()
        setUserInfo(null)
        return
      }
      // Set minimal info from auth user if API fails
      setUserInfo({
        id: authUser.id,
        email: authUser.email,
        has_keepa_access: false,
        can_manage_tools: false,
        is_superadmin: false,
      })
    } finally {
      setUserInfoLoading(false)
    }
  }, [authUser])

  // Initialize auth state: wait for INITIAL_SESSION before clearing authLoading.
  // If we clear loading too early (e.g. getSession() before storage is ready), PrivateLayout
  // briefly sees no user, navigates to "/", and PublicHome then sends logged-in users to /dashboard.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user ?? null
      setAuthUser((prev) => {
        if (!nextUser) return null
        if (prev?.id === nextUser.id) return prev
        return nextUser
      })
      if (!nextUser) {
        setUserInfo(null)
      }

      if (event === 'INITIAL_SESSION') {
        setAuthLoading(false)
      }
    })

    const safetyTimeout = window.setTimeout(() => {
      setAuthLoading((stillLoading) => {
        if (!stillLoading) return stillLoading
        void supabase.auth.getSession().then(({ data: { session } }) => {
          setAuthUser(session?.user ?? null)
          if (!session?.user) setUserInfo(null)
        })
        return false
      })
    }, 10_000)

    return () => {
      subscription.unsubscribe()
      window.clearTimeout(safetyTimeout)
    }
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
  const isSuperadmin =
    Boolean(userInfo?.is_superadmin) || userInfo?.email?.toLowerCase() === 'orvillebarba@gmail.com'
  const displayName = userInfo?.display_name || userInfo?.email?.split('@')[0] || 'User'

  const value: UserContextType = {
    authUser,
    userInfo,
    authLoading,
    userInfoLoading,
    isAuthenticated,
    hasKeepaAccess,
    canManageTools,
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
