/**
 * Team Chat access — selected users + superadmin for now.
 * Keep in sync with backend `team_chat_allowed_emails` in app.config.
 */

export const TEAM_CHAT_ALLOWED_EMAILS = [
  'sunshine@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
  'paolo@metroshoewarehouse.com',
  'paulo@metroshoewarehouse.com',
  'johnbernard@metroshoewarehouse.com',
] as const

const TEAM_CHAT_ALLOWED_SET = new Set(
  TEAM_CHAT_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may use Team Chat. */
export function canAccessTeamChat(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  if (isSuperadmin) return true
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && TEAM_CHAT_ALLOWED_SET.has(normalized)
}
