import { FLOOR_STATION_EMAILS } from '../constants/warehouseStations'

/**
 * Label Format Checker — every signed-in user except Hello and the floor stations
 * (warehouse1, label1–label8, pack1–pack6). Keep in sync with backend
 * `is_label_format_checker_allowed_user`.
 */

export const LABEL_FORMAT_CHECKER_BLOCKED_EMAILS = [
  'hello@warehouserepublic.com',
  ...FLOOR_STATION_EMAILS,
] as const

const LABEL_FORMAT_CHECKER_BLOCKED_SET = new Set(
  LABEL_FORMAT_CHECKER_BLOCKED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may open Label Format Checker. */
export function canAccessLabelFormatChecker(email?: string | null): boolean {
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && !LABEL_FORMAT_CHECKER_BLOCKED_SET.has(normalized)
}
