import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { authApi, invalidateAuthTokenCache } from '../services/api'
import { clearMfaActivity, getMfaExemptEmails, isMfaAuthRoute, isMfaExemptEmail, redirectForIncompleteMfa } from '../lib/mfa'
import { DEV_BYPASS_AUTH_USER, DEV_BYPASS_USER_INFO, isDevAuthBypass } from '../lib/devAuth'

// Extended user info from API
export interface UserInfo {
  id: string
  email: string
  role?: string
  display_name?: string
  has_keepa_access: boolean
  is_warehouse_only?: boolean
  has_label_station_access?: boolean
  can_manage_tools: boolean
  is_superadmin?: boolean
  mfa_enabled?: boolean
  mfa_exempt?: boolean
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
  isWarehouseOnly: boolean
  hasLabelStationAccess: boolean
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
  if (isDevAuthBypass()) {
    const value: UserContextType = {
      authUser: DEV_BYPASS_AUTH_USER,
      userInfo: DEV_BYPASS_USER_INFO,
      authLoading: false,
      userInfoLoading: false,
      isAuthenticated: true,
      hasKeepaAccess: true,
      isWarehouseOnly: false,
      hasLabelStationAccess: true,
      canManageTools: true,
      isSuperadmin: true,
      displayName: DEV_BYPASS_USER_INFO.display_name,
      refetchUserInfo: async () => {},
      signOut: async () => {
        console.info('[dev-auth] Sign-out is disabled while VITE_DEV_BYPASS_AUTH is on.')
      },
    }
    return <UserContext.Provider value={value}>{children}</UserContext.Provider>
  }

  return <UserProviderAuthenticated>{children}</UserProviderAuthenticated>
}

function UserProviderAuthenticated({ children }: UserProviderProps) {
  const [authUser, setAuthUser] = useState<any | null>(null)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [userInfoLoading, setUserInfoLoading] = useState(false)
  const [mfaExemptEmails, setMfaExemptEmails] = useState<string[]>([])
  const profileSyncInFlight = useRef(false)
  const profileLoadedForUserId = useRef<string | null>(null)

  useEffect(() => {
    void getMfaExemptEmails().then(setMfaExemptEmails)
  }, [])

  // Fetch extended user info from API
  const fetchUserInfo = useCallback(async (options?: { silent?: boolean }) => {
    if (!authUser) {
      setUserInfo(null)
      return
    }

    const showLoading = !options?.silent
    if (showLoading) setUserInfoLoading(true)
    try {
      const data = await authApi.getCurrentUser()
      const emailLower = (data.email || authUser.email || '').toLowerCase()
      const mfaExempt = Boolean(data.mfa_exempt)
      setUserInfo({
        id: data.id || authUser.id,
        email: data.email || authUser.email,
        role: data.role,
        display_name: data.display_name,
        has_keepa_access: Boolean(data.has_keepa_access),
        is_warehouse_only: Boolean(data.is_warehouse_only) || data.role === 'warehouse',
        has_label_station_access: Boolean(data.has_label_station_access),
        can_manage_tools: data.can_manage_tools || false,
        is_superadmin: Boolean(data.is_superadmin) || emailLower === 'orvillebarba@gmail.com',
        mfa_enabled: Boolean(data.mfa_enabled),
        mfa_exempt: mfaExempt,
        created_at: data.created_at,
      })
      profileLoadedForUserId.current = authUser.id
    } catch (error) {
      console.error('Failed to fetch user info:', error)
      const status = (error as { response?: { status?: number; data?: { detail?: string } } })?.response?.status
      const detail = (error as { response?: { status?: number; data?: { detail?: string } } })?.response?.data?.detail
      if (status === 401 && typeof detail === 'string' && detail.toLowerCase().includes('mfa verification required')) {
        setUserInfo(null)
        profileLoadedForUserId.current = null
        if (!isMfaAuthRoute()) {
          void redirectForIncompleteMfa()
        }
        return
      }
      if (status === 403 && typeof detail === 'string' && detail.toLowerCase().includes('pending superadmin approval')) {
        sessionStorage.setItem('auth_notice', 'Your account is pending superadmin approval.')
        profileLoadedForUserId.current = null
        await supabase.auth.signOut()
        setUserInfo(null)
        if (typeof window !== 'undefined' && !isMfaAuthRoute()) {
          window.location.assign('/login')
        }
        return
      }
      // Set minimal info from auth user if API fails (preserve legacy superadmin access)
      const emailLower = (authUser.email || '').toLowerCase()
      const legacySuperadmin = emailLower === 'orvillebarba@gmail.com'
      setUserInfo({
        id: authUser.id,
        email: authUser.email,
        has_keepa_access: legacySuperadmin,
        can_manage_tools: legacySuperadmin,
        is_superadmin: legacySuperadmin,
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
        profileLoadedForUserId.current = null
      }

      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
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
    }, 5_000)

    return () => {
      subscription.unsubscribe()
      window.clearTimeout(safetyTimeout)
    }
  }, [])

  const syncProfileAfterAuth = useCallback(async () => {
    if (!authUser) {
      setUserInfo(null)
      profileLoadedForUserId.current = null
      return
    }
    // MFA pages drive their own routing; the backend enforces MFA on /auth/me.
    if (isMfaAuthRoute()) return
    if (profileSyncInFlight.current) return
    if (profileLoadedForUserId.current === authUser.id && userInfo?.id === authUser.id) return

    profileSyncInFlight.current = true
    try {
      // Load profile directly. fetchUserInfo handles the 401 "MFA required" case (redirects to MFA).
      await fetchUserInfo({ silent: Boolean(userInfo) })
    } catch {
      // Keep existing profile on transient errors.
    } finally {
      profileSyncInFlight.current = false
    }
  }, [authUser, fetchUserInfo, userInfo?.id])

  // Load profile once the user is authenticated. The backend, not the frontend, decides if MFA is required.
  useEffect(() => {
    if (!authUser || authLoading) return
    void syncProfileAfterAuth()
  }, [authUser?.id, authLoading, syncProfileAfterAuth])

  const signOut = async () => {
    await supabase.auth.signOut()
    setUserInfo(null)
    profileLoadedForUserId.current = null
    clearMfaActivity()
  }

  // Computed properties
  const isAuthenticated = !!authUser
  const legacySuperadminEmail = authUser?.email?.toLowerCase() === 'orvillebarba@gmail.com'
  const isSuperadmin =
    Boolean(userInfo?.is_superadmin) ||
    userInfo?.email?.toLowerCase() === 'orvillebarba@gmail.com' ||
    legacySuperadminEmail
  const accountEmail = userInfo?.email ?? authUser?.email
  const mfaExemptAccount =
    Boolean(userInfo?.mfa_exempt) || isMfaExemptEmail(accountEmail, mfaExemptEmails)
  const isWarehouseOnly =
    Boolean(userInfo?.is_warehouse_only) ||
    userInfo?.role === 'warehouse' ||
    (mfaExemptAccount && !Boolean(userInfo?.has_keepa_access) && !isSuperadmin)
  const hasKeepaAccess = Boolean(userInfo?.has_keepa_access) || isSuperadmin
  const hasLabelStationAccess =
    Boolean(userInfo?.has_label_station_access) || hasKeepaAccess || isWarehouseOnly
  const canManageTools = Boolean(userInfo?.can_manage_tools) || isSuperadmin
  const displayName =
    userInfo?.display_name ||
    userInfo?.email?.split('@')[0] ||
    authUser?.email?.split('@')[0] ||
    'User'

  const value: UserContextType = {
    authUser,
    userInfo,
    authLoading,
    userInfoLoading,
    isAuthenticated,
    hasKeepaAccess,
    isWarehouseOnly,
    hasLabelStationAccess,
    canManageTools,
    isSuperadmin,
    displayName,
    refetchUserInfo: async () => {
      profileLoadedForUserId.current = null
      invalidateAuthTokenCache()
      await supabase.auth.getSession()
      await fetchUserInfo()
    },
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
