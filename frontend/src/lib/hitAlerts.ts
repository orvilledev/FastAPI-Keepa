/** Web Analytics: unusual daily-run spike vs yesterday (all vendors). */

export const HIT_ALERT_MIN_DELTA = 100

export type HitAlert = {
  vendor_code: string
  vendor_name: string
  today_hits: number
  yesterday_hits: number
  delta: number
}

type VendorHits = {
  code: string
  name: string
  off_price_count?: number
}

export function buildHitAlerts(
  todayVendors: VendorHits[],
  yesterdayVendors: VendorHits[] | null | undefined,
): HitAlert[] {
  const yesterdayMap = new Map(
    (yesterdayVendors || []).map((v) => [
      v.code.trim().toLowerCase(),
      v.off_price_count || 0,
    ]),
  )
  const alerts: HitAlert[] = []
  for (const v of todayVendors) {
    const code = v.code.trim().toLowerCase()
    if (!code) continue
    const today = v.off_price_count || 0
    const yesterday = yesterdayMap.get(code) || 0
    const delta = today - yesterday
    if (delta >= HIT_ALERT_MIN_DELTA) {
      alerts.push({
        vendor_code: code,
        vendor_name: v.name,
        today_hits: today,
        yesterday_hits: yesterday,
        delta,
      })
    }
  }
  return alerts.sort(
    (a, b) => b.delta - a.delta || a.vendor_code.localeCompare(b.vendor_code),
  )
}

export function utcTodayPeriodKey(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}
