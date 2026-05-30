import { supabase } from './supabase'
import { APP_NAME } from '../constants/app'

/**
 * Build a standard otpauth:// URI so authenticator apps show our app name as the issuer
 * (Supabase's default URI uses the project's Site URL, e.g. "localhost:3000").
 * Uses the SAME secret Supabase generated, so the codes still verify against Supabase.
 */
export function buildTotpUri(secret: string, account: string, issuer: string = APP_NAME): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const query = [
    `secret=${encodeURIComponent(secret)}`,
    `issuer=${encodeURIComponent(issuer)}`,
    'algorithm=SHA1',
    'digits=6',
    'period=30',
  ].join('&')
  return `otpauth://totp/${label}?${query}`
}

export type MfaStatus = {
  hasVerifiedTotp: boolean
  needsMfaVerify: boolean
  needsEnrollment: boolean
  isFullyAuthenticated: boolean
  verifiedFactorId: string | null
}

const MFA_ACTIVITY_KEY = 'msw_mfa_last_activity_at'

/** Idle window before a fully-authenticated user must re-enter their TOTP code. Defaults to 8 hours. */
export const MFA_IDLE_LIMIT_MS = (() => {
  const raw = import.meta.env.VITE_MFA_IDLE_MINUTES
  const minutes = typeof raw === 'string' ? Number(raw) : NaN
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000
  return 8 * 60 * 60 * 1000
})()

/** Record the last time the user was active (persisted across reloads/tabs). */
export function recordMfaActivity(timestamp: number = Date.now()): void {
  try {
    window.localStorage.setItem(MFA_ACTIVITY_KEY, String(timestamp))
  } catch {
    // localStorage unavailable (private mode / SSR) — idle reverify simply won't trigger.
  }
}

export function getLastMfaActivity(): number {
  try {
    const raw = window.localStorage.getItem(MFA_ACTIVITY_KEY)
    const value = raw ? Number(raw) : 0
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

/** Start the idle clock if it isn't already running (for sessions verified before this feature). */
export function ensureMfaActivityInitialized(): void {
  if (!getLastMfaActivity()) recordMfaActivity()
}

export function clearMfaActivity(): void {
  try {
    window.localStorage.removeItem(MFA_ACTIVITY_KEY)
  } catch {
    // Ignore — nothing persisted.
  }
}

/** True when the user has been idle past the limit and must re-enter their authenticator code. */
export function isMfaIdleReverifyDue(now: number = Date.now()): boolean {
  const last = getLastMfaActivity()
  if (!last) return false
  return now - last > MFA_IDLE_LIMIT_MS
}

export function getVerifiedTotpFactor(factors: { totp?: Array<{ id: string; status: string }> } | null) {
  return (factors?.totp ?? []).find((factor) => factor.status === 'verified') ?? null
}

/** True when user must scan QR and complete first-time setup (no verified TOTP yet). */
export function shouldShowMfaSetup(status: MfaStatus | null | undefined): boolean {
  if (!status) return true
  return !status.hasVerifiedTotp
}

/** True when authenticator is already enrolled and this session needs the 6-digit code. */
export function shouldShowMfaVerify(status: MfaStatus | null | undefined): boolean {
  if (!status?.hasVerifiedTotp) return false
  return status.needsMfaVerify || !status.isFullyAuthenticated
}

export async function fetchMfaStatus(): Promise<MfaStatus> {
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) {
    return {
      hasVerifiedTotp: false,
      needsMfaVerify: false,
      needsEnrollment: true,
      isFullyAuthenticated: false,
      verifiedFactorId: null,
    }
  }

  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aalError) throw aalError

  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()
  if (factorsError) throw factorsError

  const verifiedFactor = getVerifiedTotpFactor(factors)
  const hasVerifiedTotp = Boolean(verifiedFactor)
  const needsEnrollment = !hasVerifiedTotp
  const needsMfaVerify =
    hasVerifiedTotp && aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2'
  const isFullyAuthenticated = hasVerifiedTotp && aal?.currentLevel === 'aal2'

  return {
    hasVerifiedTotp,
    needsMfaVerify,
    needsEnrollment,
    isFullyAuthenticated,
    verifiedFactorId: verifiedFactor?.id ?? null,
  }
}

/** Current in-app path (supports HashRouter on `file:` builds). */
export function getAppPathname(): string {
  if (typeof window === 'undefined') return ''
  if (window.location.protocol === 'file:') {
    const hash = window.location.hash.replace(/^#/, '')
    const route = hash.startsWith('/') ? hash : `/${hash}`
    return route.split('?')[0] || '/'
  }
  return window.location.pathname
}

export function isMfaAuthRoute(path = getAppPathname()): boolean {
  return path === '/mfa/setup' || path === '/mfa/verify'
}

export async function redirectForIncompleteMfa() {
  const status = await fetchMfaStatus()
  if (typeof window === 'undefined') return

  const path = shouldShowMfaSetup(status) ? '/mfa/setup' : '/mfa/verify'
  const current = getAppPathname()
  if (current === path) return

  if (window.location.protocol === 'file:') {
    window.location.hash = `#${path}`
  } else {
    window.location.assign(path)
  }
}

export async function createMfaChallenge(factorId: string) {
  const { data, error } = await supabase.auth.mfa.challenge({ factorId })
  if (error) throw error
  if (!data?.id) throw new Error('Failed to start MFA challenge')
  return data.id
}

export async function verifyMfaCode(factorId: string, challengeId: string, code: string) {
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    code: code.trim(),
  })
  if (error) throw error
}

/** A unique friendly name avoids Supabase's "factor with this friendly name already exists" error. */
function nextTotpFriendlyName(): string {
  return `${APP_NAME} (${Date.now()})`
}

export async function enrollTotpFactor(friendlyName: string = nextTotpFriendlyName()) {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  })
  if (error) throw error
  if (!data?.id || !data.totp) throw new Error('Failed to start authenticator enrollment')
  return data
}

/** Remove abandoned enrollments so a fresh QR can be generated. */
export async function unenrollUnverifiedTotpFactors() {
  const { data: factors, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error

  for (const factor of factors?.totp ?? []) {
    if (factor.status === 'unverified') {
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
      if (unenrollError) throw unenrollError
    }
  }
}

/**
 * Start a fresh TOTP enrollment.
 * Clears any leftover unverified factor (e.g. an abandoned QR scan) first, and retries once
 * if Supabase still reports a name/factor collision so the user never gets stuck on setup.
 */
export async function prepareTotpEnrollment() {
  await unenrollUnverifiedTotpFactors()
  try {
    return await enrollTotpFactor()
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : ''
    const isCollision = message.includes('already exists') || message.includes('friendly name')
    if (!isCollision) throw err
    // A stale factor slipped through (race / partial cleanup) — remove unverified factors and retry once.
    await unenrollUnverifiedTotpFactors()
    return enrollTotpFactor()
  }
}

/**
 * Remove ALL TOTP factors (verified + unverified) so the user can re-enroll from scratch
 * (e.g. to pick up the "MSW Overwatch" issuer name). Requires an AAL2 session.
 */
export async function resetTotpEnrollment(): Promise<void> {
  const { data: factors, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error

  for (const factor of factors?.totp ?? []) {
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
    if (unenrollError) throw unenrollError
  }
  clearMfaActivity()
}

export async function verifyEnrollmentCode(factorId: string, code: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: code.trim(),
  })
  if (error) throw error
}
