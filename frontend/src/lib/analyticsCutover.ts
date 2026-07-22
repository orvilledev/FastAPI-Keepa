/**
 * Off-Price Analytics always uses live Daily Run data.
 * Demo / Live-preview toggle and fabricated datasets are retired.
 */

export type AnalyticsDataSource = 'live' | 'demo'

/** Always true — demo mode is retired. */
export function hasAnalyticsDemoEnded(_now: Date = new Date()): boolean {
  return true
}

/** Always live; ``?source=demo`` is ignored. */
export function resolveAnalyticsDataSource(
  _searchParams?: URLSearchParams | { get: (key: string) => string | null },
  _now: Date = new Date(),
): AnalyticsDataSource {
  return 'live'
}

export function analyticsSourceBadgeLabel(_source?: AnalyticsDataSource): string {
  return 'Live data'
}
