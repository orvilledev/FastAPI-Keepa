import { FLOOR_STATION_EMAILS } from '../constants/warehouseStations'

/**
 * SMW Shipment Analyzer access — every signed-in user except Hello, the floor
 * stations, and the other warehouse-only station accounts. Keep in sync with
 * backend `app.dependencies` / config blocklist.
 */

export const SHIPMENT_ANALYZER_BLOCKED_EMAILS = [
  'hello@warehouserepublic.com',
  ...FLOOR_STATION_EMAILS,
  'cameron@pmshoesinc.com',
  'corp1997@pmshoesinc.com',
  'ap@pmshoesinc.com',
  'brittany@metroshoewarehouse.com',
] as const

const SHIPMENT_ANALYZER_BLOCKED_SET = new Set(
  SHIPMENT_ANALYZER_BLOCKED_EMAILS.map((email) => email.toLowerCase()),
)

/** True when this signed-in user may use the SMW Shipment Analyzer. */
export function canAccessShipmentAnalyzer(
  email?: string | null,
  isSuperadmin = false,
): boolean {
  const normalized = (email || '').trim().toLowerCase()
  if (normalized && SHIPMENT_ANALYZER_BLOCKED_SET.has(normalized)) return false
  if (isSuperadmin) return true
  return Boolean(normalized)
}
