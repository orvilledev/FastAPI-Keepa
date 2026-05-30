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

export async function verifyEnrollmentCode(factorId: string, code: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: code.trim(),
  })
  if (error) throw error
}
