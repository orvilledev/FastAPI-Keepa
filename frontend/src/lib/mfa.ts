import { supabase } from './supabase'

export type MfaStatus = {
  hasVerifiedTotp: boolean
  needsMfaVerify: boolean
  needsEnrollment: boolean
  isFullyAuthenticated: boolean
  verifiedFactorId: string | null
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

export async function enrollTotpFactor(friendlyName = 'Authenticator app') {
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

export async function prepareTotpEnrollment() {
  await unenrollUnverifiedTotpFactors()
  return enrollTotpFactor()
}

export async function verifyEnrollmentCode(factorId: string, code: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: code.trim(),
  })
  if (error) throw error
}
