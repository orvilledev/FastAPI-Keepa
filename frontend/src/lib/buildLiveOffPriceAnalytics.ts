/**
 * Build the Analytics page dataset from live API period summaries + archives.
 * Shape matches DemoOffPriceAnalytics so existing charts/export keep working.
 *
 * Cold start uses a single ``live-bootstrap`` request (snapshot-first) so the
 * page paints without recounting price_alerts.
 */
import type {
  AnalyticsPeriod,
  DemoMonthPoint,
  DemoOffPriceAnalytics,
  DemoVendorAnalytics,
  DemoYearArchive,
} from './demoOffPriceAnalytics'
import {
  analyticsApi,
  type OffPriceAnalyticsArchiveMeta,
  type OffPriceAnalyticsResponse,
  type OffPriceLiveBootstrapResponse,
} from '../services/api'

const PERIODS: AnalyticsPeriod[] = ['daily', 'weekly', 'monthly', 'yearly']

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

function changePct(current: number, prior: number): number {
  if (prior <= 0) return current > 0 ? 100 : 0
  return Math.round(((current - prior) / prior) * 1000) / 10
}

function formatRange(startIso?: string, endIso?: string, fallback = ''): string {
  if (!startIso) return fallback
  try {
    const start = new Date(startIso)
    const endExclusive = endIso ? new Date(endIso) : null
    const end = endExclusive
      ? new Date(endExclusive.getTime() - 1)
      : start
    const opts: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }
    const a = start.toLocaleDateString('en-US', opts)
    const b = end.toLocaleDateString('en-US', opts)
    return a === b ? a : `${a} – ${b}`
  } catch {
    return fallback
  }
}

function emptyPeriodStats(total = 0) {
  return {
    off_price_count: 0,
    run_count: 0,
    pct_of_total: pct(0, total),
    change_vs_prior_pct: 0,
  }
}

function vendorCodeKey(code: string): string {
  return code.trim().toLowerCase()
}

/** Own storefront — never show as an off-price seller in Analytics. */
function isExcludedAnalyticsSeller(sellerName: string | null | undefined): boolean {
  if (!sellerName) return false
  const normalized = sellerName.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized.includes('metroshoe')
}

function mapYearArchive(detail: OffPriceAnalyticsResponse): DemoYearArchive {
  const year = Number.parseInt(String(detail.period_key || '').slice(0, 4), 10)
  const vendorsRaw = detail.vendors || []
  const vendors = vendorsRaw
    .map((v) => {
      const sellersIn = v.sellers || []
      const sellersFiltered = sellersIn
        .filter((s) => !isExcludedAnalyticsSeller(s.seller_name))
        .map((s) => ({
          seller_name: s.seller_name,
          hits: s.hits || 0,
          pct_of_vendor: 0,
        }))
        .filter((s) => s.hits > 0)
      const excludedHits = sellersIn
        .filter((s) => isExcludedAnalyticsSeller(s.seller_name))
        .reduce((sum, s) => sum + (s.hits || 0), 0)
      const off = Math.max(0, (v.off_price_count || 0) - excludedHits)
      return {
        code: vendorCodeKey(v.code),
        name: v.name,
        scheduler_enabled: Boolean(v.scheduler_enabled),
        off_price_count: off,
        run_count: v.run_count || 0,
        pct_of_total: 0,
        sellers: sellersFiltered.map((s) => ({
          ...s,
          pct_of_vendor: pct(s.hits, off),
        })),
      }
    })
    .sort((a, b) => b.off_price_count - a.off_price_count)

  const total = vendors.reduce((sum, v) => sum + v.off_price_count, 0)
  for (const v of vendors) {
    v.pct_of_total = pct(v.off_price_count, total)
  }

  return {
    year: Number.isFinite(year) ? year : new Date().getUTCFullYear(),
    period_key: detail.period_key,
    period_label: detail.period_label || String(year),
    period_range: formatRange(detail.start, detail.end, detail.period_label || ''),
    total_off_price_count: total,
    total_run_count: detail.total_run_count || 0,
    distinct_sellers: new Set(vendors.flatMap((v) => v.sellers.map((s) => s.seller_name))).size,
    vendors_with_hits: vendors.filter((v) => v.off_price_count > 0).length,
    vendors,
  }
}

function mapMonthPoint(meta: OffPriceAnalyticsArchiveMeta): DemoMonthPoint {
  const key = meta.period_key || ''
  const [ys, ms] = key.split('-')
  const year = Number.parseInt(ys || '', 10)
  const month = Number.parseInt(ms || '', 10)
  return {
    year: Number.isFinite(year) ? year : 0,
    month: Number.isFinite(month) ? month : 0,
    period_key: key,
    period_label: meta.period_label || key,
    total_off_price_count: meta.total_off_price_count || 0,
    total_run_count: meta.total_run_count || 0,
  }
}

function assembleFromPeriods(
  byPeriod: Record<
    AnalyticsPeriod,
    { current: OffPriceAnalyticsResponse; prior: OffPriceAnalyticsResponse | null }
  >,
  historical_years: DemoYearArchive[],
  historical_months: DemoMonthPoint[],
): DemoOffPriceAnalytics {
  const codeSet = new Set<string>()
  for (const p of PERIODS) {
    for (const v of byPeriod[p].current.vendors || []) {
      codeSet.add(vendorCodeKey(v.code))
    }
  }
  const codes = [...codeSet].sort()

  const vendors: DemoVendorAnalytics[] = codes.map((code) => {
    const pick = (period: AnalyticsPeriod) =>
      (byPeriod[period].current.vendors || []).find((v) => vendorCodeKey(v.code) === code)
    const pickPrior = (period: AnalyticsPeriod) =>
      (byPeriod[period].prior?.vendors || []).find((v) => vendorCodeKey(v.code) === code)

    const base = pick('yearly') || pick('monthly') || pick('weekly') || pick('daily')
    const name = base?.name || code.toUpperCase()
    const scheduler_enabled = Boolean(base?.scheduler_enabled)

    const periodStats = (period: AnalyticsPeriod) => {
      const cur = pick(period)
      const prior = pickPrior(period)
      const total = byPeriod[period].current.total_off_price_count || 0
      const count = cur?.off_price_count || 0
      return {
        off_price_count: count,
        run_count: cur?.run_count || 0,
        pct_of_total: pct(count, total),
        change_vs_prior_pct: changePct(count, prior?.off_price_count || 0),
      }
    }

    const sellerMap = new Map<
      string,
      {
        seller_name: string
        daily_hits: number
        weekly_hits: number
        monthly_hits: number
        yearly_hits: number
        avg_discount_pct: number
        last_seen: string
      }
    >()

    const mergeSellers = (
      period: AnalyticsPeriod,
      field: 'daily_hits' | 'weekly_hits' | 'monthly_hits' | 'yearly_hits',
    ) => {
      for (const s of pick(period)?.sellers || []) {
        if (isExcludedAnalyticsSeller(s.seller_name)) continue
        const key = s.seller_name.trim().toLowerCase()
        if (!key) continue
        const existing = sellerMap.get(key) || {
          seller_name: s.seller_name,
          daily_hits: 0,
          weekly_hits: 0,
          monthly_hits: 0,
          yearly_hits: 0,
          avg_discount_pct: 0,
          last_seen: '',
        }
        existing[field] = s.hits || 0
        sellerMap.set(key, existing)
      }
    }

    mergeSellers('daily', 'daily_hits')
    mergeSellers('weekly', 'weekly_hits')
    mergeSellers('monthly', 'monthly_hits')
    mergeSellers('yearly', 'yearly_hits')

    return {
      code,
      name,
      scheduler_enabled,
      daily: periodStats('daily'),
      weekly: periodStats('weekly'),
      monthly: periodStats('monthly'),
      yearly: periodStats('yearly'),
      sellers: [...sellerMap.values()].sort(
        (a, b) => b.yearly_hits - a.yearly_hits || b.monthly_hits - a.monthly_hits,
      ),
    }
  })

  const yearlyOrder = (byPeriod.yearly.current.vendors || []).map((v) => vendorCodeKey(v.code))
  if (yearlyOrder.length) {
    vendors.sort((a, b) => {
      const ai = yearlyOrder.indexOf(a.code)
      const bi = yearlyOrder.indexOf(b.code)
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
    })
  }

  const totals = Object.fromEntries(
    PERIODS.map((period) => {
      const cur = byPeriod[period].current
      return [
        period,
        {
          off_price_count: cur.total_off_price_count || 0,
          distinct_sellers: cur.distinct_sellers || 0,
          vendors_with_hits: cur.vendors_with_hits || 0,
          run_count: cur.total_run_count || 0,
        },
      ]
    }),
  ) as DemoOffPriceAnalytics['totals']

  const period_labels = Object.fromEntries(
    PERIODS.map((p) => [p, byPeriod[p].current.period_label || p]),
  ) as DemoOffPriceAnalytics['period_labels']

  const period_ranges = Object.fromEntries(
    PERIODS.map((p) => [
      p,
      formatRange(
        byPeriod[p].current.start,
        byPeriod[p].current.end,
        byPeriod[p].current.period_label || '',
      ),
    ]),
  ) as DemoOffPriceAnalytics['period_ranges']

  type TopAgg = {
    seller_name: string
    vendor_codes: Set<string>
    daily_hits: number
    weekly_hits: number
    monthly_hits: number
    yearly_hits: number
  }
  const topMap = new Map<string, TopAgg>()
  for (const v of vendors) {
    for (const s of v.sellers) {
      const key = s.seller_name.trim().toLowerCase()
      if (!key) continue
      const existing = topMap.get(key) || {
        seller_name: s.seller_name,
        vendor_codes: new Set<string>(),
        daily_hits: 0,
        weekly_hits: 0,
        monthly_hits: 0,
        yearly_hits: 0,
      }
      existing.vendor_codes.add(v.code)
      existing.daily_hits += s.daily_hits
      existing.weekly_hits += s.weekly_hits
      existing.monthly_hits += s.monthly_hits
      existing.yearly_hits += s.yearly_hits
      topMap.set(key, existing)
    }
  }
  const yearlyTotal = totals.yearly.off_price_count
  const top_sellers_overall = [...topMap.values()]
    .map((t) => ({
      seller_name: t.seller_name,
      vendor_codes: [...t.vendor_codes],
      daily_hits: t.daily_hits,
      weekly_hits: t.weekly_hits,
      monthly_hits: t.monthly_hits,
      yearly_hits: t.yearly_hits,
      pct_of_yearly_total: pct(t.yearly_hits, yearlyTotal),
    }))
    .sort((a, b) => b.yearly_hits - a.yearly_hits)
    .slice(0, 12)

  const finalVendors =
    vendors.length > 0
      ? vendors
      : (['dnk', 'clk', 'obz', 'ref', 'bor', 'sff', 'tev', 'cha', 'jfs'] as const).map((code) => ({
          code,
          name: code.toUpperCase(),
          scheduler_enabled: false,
          daily: emptyPeriodStats(),
          weekly: emptyPeriodStats(),
          monthly: emptyPeriodStats(),
          yearly: emptyPeriodStats(),
          sellers: [],
        }))

  return {
    demo: false,
    demo_label: 'Live Daily Run data',
    as_of: new Date().toISOString(),
    period_labels,
    period_ranges,
    totals,
    vendors: finalVendors,
    top_sellers_overall,
    historical_years,
    historical_months,
  }
}

function assembleFromBootstrap(boot: OffPriceLiveBootstrapResponse): DemoOffPriceAnalytics {
  const byPeriod = Object.fromEntries(
    PERIODS.map((p) => [p, { current: boot.periods[p], prior: null }]),
  ) as Record<
    AnalyticsPeriod,
    { current: OffPriceAnalyticsResponse; prior: OffPriceAnalyticsResponse | null }
  >

  const historical_years = (boot.yearly_archives || [])
    .filter((y) => (y.source || '').toLowerCase() !== 'demo')
    .map(mapYearArchive)
    .sort((a, b) => b.year - a.year)

  const liveYearly = byPeriod.yearly.current
  const liveYear = Number.parseInt(String(liveYearly.period_key || '').slice(0, 4), 10)
  if (Number.isFinite(liveYear) && !historical_years.some((y) => y.year === liveYear)) {
    historical_years.unshift(mapYearArchive(liveYearly))
  }

  const historical_months: DemoMonthPoint[] = [...(boot.monthly_archives || [])]
    .filter((a) => (a.source || '').toLowerCase() !== 'demo')
    .map(mapMonthPoint)
    .sort((a, b) => a.year - b.year || a.month - b.month)

  if (historical_months.length === 0) {
    const m = byPeriod.monthly.current
    historical_months.push({
      year: Number.parseInt((m.period_key || '').slice(0, 4), 10) || new Date().getUTCFullYear(),
      month: Number.parseInt((m.period_key || '').slice(5, 7), 10) || 1,
      period_key: m.period_key,
      period_label: m.period_label,
      total_off_price_count: m.total_off_price_count,
      total_run_count: m.total_run_count,
    })
  }

  return assembleFromPeriods(byPeriod, historical_years, historical_months)
}

/** Legacy multi-request path (fallback if bootstrap is unavailable). */
async function buildLiveOffPriceAnalyticsLegacy(): Promise<DemoOffPriceAnalytics> {
  const periodResults = await Promise.all(
    PERIODS.map(async (period) => {
      const current = await analyticsApi.getOffPrice({ period, offset: 0, persist: false })
      return { current, prior: null }
    }),
  )
  const byPeriod = Object.fromEntries(
    PERIODS.map((p, i) => [p, periodResults[i]]),
  ) as Record<AnalyticsPeriod, { current: OffPriceAnalyticsResponse; prior: OffPriceAnalyticsResponse | null }>

  const [yearlyList, monthlyList] = await Promise.all([
    analyticsApi.listArchives({ period_type: 'yearly', limit: 12, exclude_demo: true }),
    analyticsApi.listArchives({ period_type: 'monthly', limit: 24, exclude_demo: true }),
  ])

  const yearlyMetas = (yearlyList.archives || []).filter(
    (a) => (a.source || '').toLowerCase() !== 'demo',
  )
  const monthlyMetas = (monthlyList.archives || [])
    .filter((a) => (a.source || '').toLowerCase() !== 'demo')
    .slice(0, 24)

  const liveYearly = byPeriod.yearly.current
  const liveYear = Number.parseInt(String(liveYearly.period_key || '').slice(0, 4), 10)
  const yearsToHydrate = yearlyMetas
    .filter((meta) => {
      const y = Number.parseInt(String(meta.period_key || '').slice(0, 4), 10)
      return Number.isFinite(y) && Number.isFinite(liveYear) && y >= liveYear - 1
    })
    .slice(0, 3)

  const yearDetails = await Promise.all(
    yearsToHydrate.map(async (meta) => {
      try {
        const detail = await analyticsApi.getArchive('yearly', meta.period_key)
        if ((detail.source || '').toLowerCase() === 'demo') return null
        return mapYearArchive(detail)
      } catch {
        const year = Number.parseInt(String(meta.period_key || '').slice(0, 4), 10)
        return {
          year: Number.isFinite(year) ? year : 0,
          period_key: meta.period_key,
          period_label: meta.period_label,
          period_range: formatRange(meta.period_start, meta.period_end, meta.period_label),
          total_off_price_count: meta.total_off_price_count,
          total_run_count: meta.total_run_count,
          distinct_sellers: meta.distinct_sellers,
          vendors_with_hits: meta.vendors_with_hits,
          vendors: [],
        } satisfies DemoYearArchive
      }
    }),
  )

  const historical_years = yearDetails
    .filter((y): y is DemoYearArchive => Boolean(y))
    .sort((a, b) => b.year - a.year)

  if (Number.isFinite(liveYear) && !historical_years.some((y) => y.year === liveYear)) {
    historical_years.unshift(mapYearArchive(liveYearly))
  }

  const historical_months: DemoMonthPoint[] = [...monthlyMetas]
    .map(mapMonthPoint)
    .sort((a, b) => a.year - b.year || a.month - b.month)

  if (historical_months.length === 0) {
    const m = byPeriod.monthly.current
    historical_months.push({
      year: Number.parseInt((m.period_key || '').slice(0, 4), 10) || new Date().getUTCFullYear(),
      month: Number.parseInt((m.period_key || '').slice(5, 7), 10) || 1,
      period_key: m.period_key,
      period_label: m.period_label,
      total_off_price_count: m.total_off_price_count,
      total_run_count: m.total_run_count,
    })
  }

  return assembleFromPeriods(byPeriod, historical_years, historical_months)
}

export async function buildLiveOffPriceAnalytics(): Promise<DemoOffPriceAnalytics> {
  try {
    const boot = await analyticsApi.getLiveBootstrap()
    if (boot?.periods?.daily && boot?.periods?.weekly) {
      return assembleFromBootstrap(boot)
    }
  } catch {
    /* fall through to legacy multi-request path */
  }
  return buildLiveOffPriceAnalyticsLegacy()
}

/** Best-effort purge of fabricated demo snapshot rows (ignore failures). */
export async function purgeDemoAnalyticsSnapshots(): Promise<number> {
  try {
    const res = await analyticsApi.deleteDemoSnapshots()
    return res.deleted || 0
  } catch {
    return 0
  }
}
