/** Web Analytics: unusual daily-run spike vs the vendor's last completed run. */

export const HIT_ALERT_MIN_DELTA = 100

export type HitAlert = {
  vendor_code: string
  vendor_name: string
  today_hits: number
  yesterday_hits: number
  last_run_hits?: number
  last_run_period_key?: string | null
  last_run_label?: string | null
  delta: number
}

type VendorHits = {
  code: string
  name: string
  off_price_count?: number
}

export function buildHitAlerts(
  currentVendors: VendorHits[],
  previousVendors: VendorHits[] | null | undefined,
): HitAlert[] {
  const previousMap = new Map(
    (previousVendors || []).map((v) => [
      v.code.trim().toLowerCase(),
      v.off_price_count || 0,
    ]),
  )
  const alerts: HitAlert[] = []
  for (const v of currentVendors) {
    const code = v.code.trim().toLowerCase()
    if (!code) continue
    const current = v.off_price_count || 0
    const previous = previousMap.get(code) || 0
    const delta = current - previous
    if (delta >= HIT_ALERT_MIN_DELTA) {
      alerts.push({
        vendor_code: code,
        vendor_name: v.name,
        today_hits: current,
        yesterday_hits: previous,
        last_run_hits: previous,
        delta,
      })
    }
  }
  return alerts.sort(
    (a, b) => b.delta - a.delta || a.vendor_code.localeCompare(b.vendor_code),
  )
}

export function hitAlertPreviousLabel(alert: HitAlert): string {
  if (alert.last_run_label) return `last run (${alert.last_run_label})`
  return 'last run'
}
