/**
 * Matches display name and/or auth email (lowercased haystack).
 * Keep patterns in sync with backend `app.api.feedback_blocklist.feedback_blocked_for_identity`.
 */
const FEEDBACK_HIDDEN_PATTERNS: RegExp[] = [
  /john\s+bernard/i,
  /\bstephanie\b/i,
  /\bsunshine\b/i,
  /\bpaulo\b/i,
  /\bhezron\b/i,
]

export function isUserHiddenFromFeedbackPage(
  profileDisplayName: string | undefined,
  profileEmail: string | undefined,
  authSessionEmail?: string | undefined,
): boolean {
  const email = profileEmail?.trim() || authSessionEmail?.trim() || ''
  const hay = `${profileDisplayName || ''} ${email} ${authSessionEmail || ''}`.toLowerCase()
  return FEEDBACK_HIDDEN_PATTERNS.some((re) => re.test(hay))
}
