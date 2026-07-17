/**
 * Off-Price Analytics demo → live cutover (Central US).
 *
 * Default: fabricated demo until 2026-08-01 00:00 America/Chicago (CDT = UTC−5).
 * Preview live early:  /analytics?source=live
 * Force demo (pre-cutover only): /analytics?source=demo
 */

/** 2026-08-01 00:00 CDT == 05:00 UTC */
export const ANALYTICS_DEMO_CUTOVER_UTC_MS = Date.parse('2026-08-01T05:00:00.000Z')

export type AnalyticsDataSource = 'live' | 'demo'

export function hasAnalyticsDemoEnded(now: Date = new Date()): boolean {
  return now.getTime() >= ANALYTICS_DEMO_CUTOVER_UTC_MS
}

/**
 * Resolve which dataset the Analytics page should show.
 * After cutover, live is forced even if `?source=demo` is present.
 */
export function resolveAnalyticsDataSource(
  searchParams: URLSearchParams | { get: (key: string) => string | null },
  now: Date = new Date(),
): AnalyticsDataSource {
  const cutoverDone = hasAnalyticsDemoEnded(now)
  const raw = (searchParams.get('source') || '').trim().toLowerCase()
  if (raw === 'live') return 'live'
  if (raw === 'demo') return cutoverDone ? 'live' : 'demo'
  return cutoverDone ? 'live' : 'demo'
}

export function analyticsSourceBadgeLabel(source: AnalyticsDataSource): string {
  if (source === 'live') {
    return hasAnalyticsDemoEnded() ? 'Live data' : 'Live preview'
  }
  return 'Demo data'
}
