import { signOutThisBrowser, supabase } from './supabase'

export const FORCE_LOGOUT_NOTICE = 'You were signed out by an administrator.'

function redirectToLogin(): void {
  if (typeof window === 'undefined') return
  if (window.location.protocol === 'file:') {
    window.location.hash = '#/login'
  } else if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login')
  }
}

function decodeJwt(token: string): { sub?: string; iat?: number } | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const padded = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='))
    return JSON.parse(json) as { sub?: string; iat?: number }
  } catch {
    return null
  }
}

/** Sign this browser out when a superadmin force-logout covers the current access token. */
export async function signOutIfForceLoggedOut(status: {
  forced_at: number | null
  exempt_user_id: string | null
}): Promise<boolean> {
  if (!status.forced_at) return false
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return false
  const claims = decodeJwt(token)
  if (!claims?.sub || claims.iat == null) return false
  if (status.exempt_user_id && claims.sub === status.exempt_user_id) return false
  if (claims.iat > status.forced_at) return false

  try {
    sessionStorage.setItem('auth_notice', FORCE_LOGOUT_NOTICE)
  } catch {
    // Login still works without the notice.
  }
  redirectToLogin()
  // The server cutoff already rejects every station. Clear only this browser.
  await signOutThisBrowser()
  return true
}
