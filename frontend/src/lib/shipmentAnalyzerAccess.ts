/**
 * SMW Shipment Analyzer access — selected users + superadmin.
 * Keep in sync with backend `app.dependencies` / config allowlist.
 */

export const SHIPMENT_ANALYZER_ALLOWED_EMAILS = [
  'sunshine@metroshoewarehouse.com',
  'stephanie@metroshoewarehouse.com',
  'paolo@metroshoewarehouse.com',
  'paulo@metroshoewarehouse.com',
  'johnbernard@metroshoewarehouse.com',
] as const

const SHIPMENT_ANALYZER_ALLOWED_SET = new Set(
  SHIPMENT_ANALYZER_ALLOWED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may use the SMW Shipment Analyzer. */
export function canAccessShipmentAnalyzer(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  if (isSuperadmin) return true
  const normalized = (email || '').trim().toLowerCase()
  return Boolean(normalized) && SHIPMENT_ANALYZER_ALLOWED_SET.has(normalized)
}
