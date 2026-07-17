/**
 * Fabricated off-price analytics for local demos only.
 * Includes daily / weekly / monthly / yearly plus multi-year archives
 * mirroring what the DB table ``off_price_analytics_snapshots`` will store.
 */

export type AnalyticsPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface SellerHits {
  seller_name: string
  daily_hits: number
  weekly_hits: number
  monthly_hits: number
  yearly_hits: number
  avg_discount_pct: number
  last_seen: string
}

export interface VendorPeriodStats {
  off_price_count: number
  run_count: number
  pct_of_total: number
  change_vs_prior_pct: number
}

export interface DemoVendorAnalytics {
  code: string
  name: string
  scheduler_enabled: boolean
  daily: VendorPeriodStats
  weekly: VendorPeriodStats
  monthly: VendorPeriodStats
  yearly: VendorPeriodStats
  sellers: SellerHits[]
}

export interface DemoYearArchive {
  year: number
  period_key: string
  period_label: string
  period_range: string
  total_off_price_count: number
  total_run_count: number
  distinct_sellers: number
  vendors_with_hits: number
  vendors: Array<{
    code: string
    name: string
    scheduler_enabled: boolean
    off_price_count: number
    run_count: number
    pct_of_total: number
    sellers: Array<{ seller_name: string; hits: number; pct_of_vendor: number }>
  }>
}

export interface DemoOffPriceAnalytics {
  demo: boolean
  demo_label: string
  as_of: string
  period_labels: Record<AnalyticsPeriod, string>
  period_ranges: Record<AnalyticsPeriod, string>
  totals: Record<
    AnalyticsPeriod,
    {
      off_price_count: number
      distinct_sellers: number
      vendors_with_hits: number
      run_count: number
    }
  >
  vendors: DemoVendorAnalytics[]
  top_sellers_overall: Array<{
    seller_name: string
    vendor_codes: string[]
    daily_hits: number
    weekly_hits: number
    monthly_hits: number
    yearly_hits: number
    pct_of_yearly_total: number
  }>
  /** Past + current year archives — durable history for download. */
  historical_years: DemoYearArchive[]
  /** Month-by-month totals for the Monthly trend chart. */
  historical_months: DemoMonthPoint[]
}

export interface DemoMonthPoint {
  year: number
  month: number
  period_key: string
  period_label: string
  total_off_price_count: number
  total_run_count: number
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

type RawSeller = {
  name: string
  d: number
  w: number
  m: number
  discount: number
  lastSeen: string
}

type RawVendor = {
  code: string
  name: string
  enabled: boolean
  runs: { d: number; w: number; m: number; y: number }
  prior: { d: number; w: number; m: number; y: number }
  sellers: RawSeller[]
}

const RAW: RawVendor[] = [
  {
    code: 'dnk',
    name: 'DNK (Dansko)',
    enabled: true,
    runs: { d: 1, w: 7, m: 28, y: 198 },
    prior: { d: 38, w: 210, m: 820, y: 2710 },
    sellers: [
      { name: 'ShoeDealz Outlet', d: 14, w: 61, m: 248, discount: 18.4, lastSeen: '2026-07-15' },
      { name: 'Comfort Footwear Co', d: 9, w: 44, m: 176, discount: 12.1, lastSeen: '2026-07-15' },
      { name: 'Pacific Step Mart', d: 7, w: 33, m: 129, discount: 15.6, lastSeen: '2026-07-14' },
      { name: 'Maple Ridge Shoes', d: 5, w: 28, m: 98, discount: 9.8, lastSeen: '2026-07-15' },
      { name: 'Urban Sole Direct', d: 4, w: 19, m: 71, discount: 21.3, lastSeen: '2026-07-13' },
      { name: 'Northwest Boot Hub', d: 3, w: 15, m: 54, discount: 11.0, lastSeen: '2026-07-12' },
    ],
  },
  {
    code: 'clk',
    name: 'CLK (Clarks)',
    enabled: true,
    runs: { d: 1, w: 7, m: 27, y: 190 },
    prior: { d: 29, w: 168, m: 640, y: 2210 },
    sellers: [
      { name: 'British Walk Co', d: 11, w: 52, m: 201, discount: 14.2, lastSeen: '2026-07-15' },
      { name: 'Trail & Town Outlet', d: 8, w: 39, m: 154, discount: 16.7, lastSeen: '2026-07-15' },
      { name: 'Harbor Style Shoes', d: 6, w: 27, m: 112, discount: 10.5, lastSeen: '2026-07-14' },
      { name: 'Evergreen Footwear', d: 4, w: 21, m: 88, discount: 13.9, lastSeen: '2026-07-15' },
      { name: 'Cascade Kick Shop', d: 3, w: 14, m: 59, discount: 19.1, lastSeen: '2026-07-11' },
    ],
  },
  {
    code: 'obz',
    name: 'OBZ (Oboz)',
    enabled: true,
    runs: { d: 1, w: 6, m: 24, y: 172 },
    prior: { d: 22, w: 120, m: 490, y: 1590 },
    sellers: [
      { name: 'Mountain Gear Depot', d: 10, w: 41, m: 167, discount: 17.8, lastSeen: '2026-07-15' },
      { name: 'Alpine Trail Supply', d: 7, w: 32, m: 128, discount: 12.4, lastSeen: '2026-07-14' },
      { name: 'Summit Step Co', d: 5, w: 24, m: 96, discount: 20.2, lastSeen: '2026-07-15' },
      { name: 'Ridge Runner Outfit', d: 3, w: 16, m: 67, discount: 8.6, lastSeen: '2026-07-13' },
      { name: 'Wildpath Trading', d: 2, w: 11, m: 43, discount: 15.0, lastSeen: '2026-07-10' },
    ],
  },
  {
    code: 'ref',
    name: 'REF (Reef)',
    enabled: true,
    runs: { d: 1, w: 7, m: 26, y: 180 },
    prior: { d: 18, w: 95, m: 380, y: 1290 },
    sellers: [
      { name: 'Coastal Flip Co', d: 8, w: 36, m: 142, discount: 22.5, lastSeen: '2026-07-15' },
      { name: 'Boardwalk Sandals', d: 5, w: 25, m: 99, discount: 14.8, lastSeen: '2026-07-14' },
      { name: 'Sunshine Softsole', d: 4, w: 18, m: 74, discount: 11.3, lastSeen: '2026-07-15' },
      { name: 'Pacific Breeze Gear', d: 3, w: 14, m: 58, discount: 16.0, lastSeen: '2026-07-12' },
      { name: 'TideLine Retail', d: 2, w: 9, m: 36, discount: 9.4, lastSeen: '2026-07-09' },
    ],
  },
  {
    code: 'bor',
    name: 'BOR (Born)',
    enabled: false,
    runs: { d: 0, w: 4, m: 18, y: 96 },
    prior: { d: 12, w: 70, m: 260, y: 780 },
    sellers: [
      { name: 'Heritage Leather Co', d: 0, w: 19, m: 81, discount: 13.2, lastSeen: '2026-07-12' },
      { name: 'Old Town Bootery', d: 0, w: 14, m: 62, discount: 10.7, lastSeen: '2026-07-11' },
      { name: 'Crafted Step Market', d: 0, w: 11, m: 48, discount: 18.5, lastSeen: '2026-07-10' },
      { name: 'Mill Creek Footwear', d: 0, w: 8, m: 34, discount: 7.9, lastSeen: '2026-07-08' },
    ],
  },
  {
    code: 'sff',
    name: 'SFF (Sofft)',
    enabled: true,
    runs: { d: 1, w: 6, m: 22, y: 155 },
    prior: { d: 15, w: 82, m: 310, y: 970 },
    sellers: [
      { name: 'SoftStep Boutique', d: 6, w: 29, m: 118, discount: 11.6, lastSeen: '2026-07-15' },
      { name: 'Comfort Curve Shop', d: 5, w: 22, m: 89, discount: 15.4, lastSeen: '2026-07-14' },
      { name: 'EasyWalk Express', d: 3, w: 16, m: 67, discount: 9.2, lastSeen: '2026-07-15' },
      { name: 'Lily Lane Shoes', d: 2, w: 10, m: 41, discount: 13.8, lastSeen: '2026-07-13' },
      { name: 'Garden Path Retail', d: 1, w: 7, m: 28, discount: 6.5, lastSeen: '2026-07-11' },
    ],
  },
  {
    code: 'tev',
    name: 'TEV (Teva)',
    enabled: true,
    runs: { d: 1, w: 7, m: 25, y: 175 },
    prior: { d: 20, w: 110, m: 430, y: 1410 },
    sellers: [
      { name: 'River Sandal Co', d: 9, w: 38, m: 151, discount: 19.6, lastSeen: '2026-07-15' },
      { name: 'Adventure Footpath', d: 6, w: 28, m: 114, discount: 12.9, lastSeen: '2026-07-15' },
      { name: 'Desert Trek Outlet', d: 4, w: 20, m: 82, discount: 17.1, lastSeen: '2026-07-14' },
      { name: 'Canyon Kick Deal', d: 3, w: 13, m: 55, discount: 10.1, lastSeen: '2026-07-12' },
      { name: 'Hydrotrail Merch', d: 2, w: 9, m: 37, discount: 14.4, lastSeen: '2026-07-10' },
    ],
  },
  {
    code: 'cha',
    name: 'CHA (Chaco)',
    enabled: false,
    runs: { d: 0, w: 3, m: 14, y: 72 },
    prior: { d: 9, w: 55, m: 210, y: 520 },
    sellers: [
      { name: 'Z-Strap Traders', d: 0, w: 17, m: 72, discount: 16.3, lastSeen: '2026-07-11' },
      { name: 'Riverbed Outfitters', d: 0, w: 12, m: 51, discount: 12.0, lastSeen: '2026-07-09' },
      { name: 'Grip & Go Market', d: 0, w: 8, m: 36, discount: 21.8, lastSeen: '2026-07-08' },
      { name: 'Rapids Edge Shoes', d: 0, w: 6, m: 25, discount: 8.3, lastSeen: '2026-07-07' },
    ],
  },
]

/** Yearly hit ≈ YTD scale from monthly rhythm (demo only). */
function yearlyFromMonthly(monthly: number, vendorCode: string): number {
  const bump = vendorCode.charCodeAt(0) % 5
  return monthly * 11 + bump * 3
}

function changePct(current: number, prior: number): number {
  if (prior <= 0) return current > 0 ? 100 : 0
  return Math.round(((current - prior) / prior) * 1000) / 10
}

/** Demo archive span: current year + 49 prior full years = 50 years total. */
export const DEMO_ANALYTICS_CURRENT_YEAR = 2026
export const DEMO_HISTORICAL_YEAR_COUNT = 50

const HISTORICAL_BASELINE_HITS: Record<string, number> = {
  dnk: 2180,
  clk: 1740,
  obz: 1210,
  ref: 980,
  bor: 640,
  sff: 720,
  tev: 1100,
  cha: 410,
}

const ARCHIVE_SELLER_NAMES = [
  'ShoeDealz Outlet',
  'British Walk Co',
  'Mountain Gear Depot',
  'Coastal Flip Co',
  'River Sandal Co',
  'Comfort Footwear Co',
]

function historicalHitsForYear(year: number): Record<string, number> {
  const firstYear = DEMO_ANALYTICS_CURRENT_YEAR - DEMO_HISTORICAL_YEAR_COUNT + 1
  const progress = (year - firstYear) / Math.max(1, DEMO_HISTORICAL_YEAR_COUNT - 2)
  // Older decades start lower; ramp toward recent known levels (~2023–2025).
  const factor = 0.28 + Math.max(0, Math.min(1, progress)) * 0.97
  const jitterSeed = year * 17
  const hits: Record<string, number> = {}
  for (const [code, base] of Object.entries(HISTORICAL_BASELINE_HITS)) {
    const wobble = ((jitterSeed + code.charCodeAt(0) * 13) % 11) - 5
    hits[code] = Math.max(40, Math.round(base * factor + wobble * 8))
  }
  return hits
}

/** Demo month span ending at the current demo month (Jul 2026). */
export const DEMO_ANALYTICS_CURRENT_MONTH = 7
export const DEMO_HISTORICAL_MONTH_COUNT = 24

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function historicalHitsForMonth(year: number, month: number): number {
  // Seasonal-ish demo curve: summer higher, winter lower, mild year-over-year growth.
  const yearsBack = DEMO_ANALYTICS_CURRENT_YEAR - year
  const season = 0.82 + 0.28 * Math.sin(((month - 3) / 12) * Math.PI * 2)
  const growth = 1 + Math.max(0, 1.5 - yearsBack) * 0.06
  const base = 2680
  const wobble = ((year * 31 + month * 17) % 19) - 9
  return Math.max(400, Math.round(base * season * growth + wobble * 22))
}

function buildHistoricalMonths(currentMonthTotal: number, currentMonthRuns: number): DemoMonthPoint[] {
  const points: DemoMonthPoint[] = []
  let year = DEMO_ANALYTICS_CURRENT_YEAR
  let month = DEMO_ANALYTICS_CURRENT_MONTH

  for (let i = 0; i < DEMO_HISTORICAL_MONTH_COUNT; i++) {
    const isCurrent = i === 0
    const hits = isCurrent ? currentMonthTotal : historicalHitsForMonth(year, month)
    const runs = isCurrent
      ? currentMonthRuns
      : 140 + ((year * 5 + month * 11) % 80)
    points.push({
      year,
      month,
      period_key: `${year}-${String(month).padStart(2, '0')}`,
      period_label: `${MONTH_SHORT[month - 1]} ${year}`,
      total_off_price_count: hits,
      total_run_count: runs,
    })
    month -= 1
    if (month < 1) {
      month = 12
      year -= 1
    }
  }

  return points.reverse()
}

function buildHistoricalYears(currentYearVendors: DemoVendorAnalytics[]): DemoYearArchive[] {
  const archives: DemoYearArchive[] = []
  const firstYear = DEMO_ANALYTICS_CURRENT_YEAR - DEMO_HISTORICAL_YEAR_COUNT + 1

  for (let year = firstYear; year < DEMO_ANALYTICS_CURRENT_YEAR; year++) {
    const hitsByCode = historicalHitsForYear(year)
    const total = Object.values(hitsByCode).reduce((s, n) => s + n, 0)
    const vendors = RAW.map((v) => {
      const off = hitsByCode[v.code] ?? 0
      let remaining = off
      const sellers = ARCHIVE_SELLER_NAMES.slice(0, 4)
        .map((name, i) => {
          const share = i < 3 ? Math.floor(off / 4) : remaining
          remaining -= share
          return {
            seller_name: name,
            hits: share,
            pct_of_vendor: pct(share, off),
          }
        })
        .filter((s) => s.hits > 0)

      return {
        code: v.code,
        name: v.name,
        scheduler_enabled: v.enabled,
        off_price_count: off,
        run_count: 120 + ((year * 3 + v.code.charCodeAt(0)) % 90),
        pct_of_total: pct(off, total),
        sellers,
      }
    }).sort((a, b) => b.off_price_count - a.off_price_count)

    archives.push({
      year,
      period_key: String(year),
      period_label: String(year),
      period_range: `Jan 1 – Dec 31, ${year}`,
      total_off_price_count: total,
      total_run_count: vendors.reduce((s, v) => s + v.run_count, 0),
      distinct_sellers: ARCHIVE_SELLER_NAMES.length,
      vendors_with_hits: vendors.filter((v) => v.off_price_count > 0).length,
      vendors,
    })
  }

  // Current YTD year as an archive entry too (from live demo vendors)
  const ytdTotal = currentYearVendors.reduce((s, v) => s + v.yearly.off_price_count, 0)
  archives.push({
    year: DEMO_ANALYTICS_CURRENT_YEAR,
    period_key: String(DEMO_ANALYTICS_CURRENT_YEAR),
    period_label: `${DEMO_ANALYTICS_CURRENT_YEAR} (YTD)`,
    period_range: `Jan 1 – Jul 15, ${DEMO_ANALYTICS_CURRENT_YEAR}`,
    total_off_price_count: ytdTotal,
    total_run_count: currentYearVendors.reduce((s, v) => s + v.yearly.run_count, 0),
    distinct_sellers: new Set(
      currentYearVendors.flatMap((v) =>
        v.sellers.filter((s) => s.yearly_hits > 0).map((s) => s.seller_name),
      ),
    ).size,
    vendors_with_hits: currentYearVendors.filter((v) => v.yearly.off_price_count > 0).length,
    vendors: currentYearVendors
      .map((v) => ({
        code: v.code,
        name: v.name,
        scheduler_enabled: v.scheduler_enabled,
        off_price_count: v.yearly.off_price_count,
        run_count: v.yearly.run_count,
        pct_of_total: v.yearly.pct_of_total,
        sellers: v.sellers
          .filter((s) => s.yearly_hits > 0)
          .map((s) => ({
            seller_name: s.seller_name,
            hits: s.yearly_hits,
            pct_of_vendor: pct(s.yearly_hits, v.yearly.off_price_count),
          })),
      }))
      .sort((a, b) => b.off_price_count - a.off_price_count),
  })

  return archives.sort((a, b) => b.year - a.year)
}

export function buildDemoOffPriceAnalytics(): DemoOffPriceAnalytics {
  const withYearly = RAW.map((v) => ({
    ...v,
    sellers: v.sellers.map((s) => ({
      ...s,
      y: yearlyFromMonthly(s.m, v.code),
    })),
  }))

  const grand = {
    daily: withYearly.reduce((s, v) => s + v.sellers.reduce((a, x) => a + x.d, 0), 0),
    weekly: withYearly.reduce((s, v) => s + v.sellers.reduce((a, x) => a + x.w, 0), 0),
    monthly: withYearly.reduce((s, v) => s + v.sellers.reduce((a, x) => a + x.m, 0), 0),
    yearly: withYearly.reduce((s, v) => s + v.sellers.reduce((a, x) => a + x.y, 0), 0),
  }

  const sellersByName = new Map<
    string,
    { daily: number; weekly: number; monthly: number; yearly: number; vendors: Set<string> }
  >()

  for (const v of withYearly) {
    for (const s of v.sellers) {
      const existing = sellersByName.get(s.name) || {
        daily: 0,
        weekly: 0,
        monthly: 0,
        yearly: 0,
        vendors: new Set<string>(),
      }
      existing.daily += s.d
      existing.weekly += s.w
      existing.monthly += s.m
      existing.yearly += s.y
      existing.vendors.add(v.code)
      sellersByName.set(s.name, existing)
    }
  }

  const vendors: DemoVendorAnalytics[] = withYearly
    .map((v) => {
      const dailyCount = v.sellers.reduce((s, x) => s + x.d, 0)
      const weeklyCount = v.sellers.reduce((s, x) => s + x.w, 0)
      const monthlyCount = v.sellers.reduce((s, x) => s + x.m, 0)
      const yearlyCount = v.sellers.reduce((s, x) => s + x.y, 0)

      const sellers: SellerHits[] = [...v.sellers]
        .sort((a, b) => b.y - a.y)
        .map((s) => ({
          seller_name: s.name,
          daily_hits: s.d,
          weekly_hits: s.w,
          monthly_hits: s.m,
          yearly_hits: s.y,
          avg_discount_pct: s.discount,
          last_seen: s.lastSeen,
        }))

      return {
        code: v.code,
        name: v.name,
        scheduler_enabled: v.enabled,
        daily: {
          off_price_count: dailyCount,
          run_count: v.runs.d,
          pct_of_total: pct(dailyCount, grand.daily),
          change_vs_prior_pct: changePct(dailyCount, v.prior.d),
        },
        weekly: {
          off_price_count: weeklyCount,
          run_count: v.runs.w,
          pct_of_total: pct(weeklyCount, grand.weekly),
          change_vs_prior_pct: changePct(weeklyCount, v.prior.w),
        },
        monthly: {
          off_price_count: monthlyCount,
          run_count: v.runs.m,
          pct_of_total: pct(monthlyCount, grand.monthly),
          change_vs_prior_pct: changePct(monthlyCount, v.prior.m),
        },
        yearly: {
          off_price_count: yearlyCount,
          run_count: v.runs.y,
          pct_of_total: pct(yearlyCount, grand.yearly),
          change_vs_prior_pct: changePct(yearlyCount, v.prior.y),
        },
        sellers,
      }
    })
    .sort((a, b) => b.yearly.off_price_count - a.yearly.off_price_count)

  const top_sellers_overall = [...sellersByName.entries()]
    .map(([seller_name, info]) => ({
      seller_name,
      vendor_codes: [...info.vendors].sort(),
      daily_hits: info.daily,
      weekly_hits: info.weekly,
      monthly_hits: info.monthly,
      yearly_hits: info.yearly,
      pct_of_yearly_total: pct(info.yearly, grand.yearly),
    }))
    .sort((a, b) => b.yearly_hits - a.yearly_hits)
    .slice(0, 8)

  const distinctFor = (period: 'd' | 'w' | 'm' | 'y') => {
    const names = new Set<string>()
    for (const v of withYearly) {
      for (const s of v.sellers) {
        const hits = period === 'd' ? s.d : period === 'w' ? s.w : period === 'm' ? s.m : s.y
        if (hits > 0) names.add(s.name)
      }
    }
    return names.size
  }

  return {
    demo: true,
    demo_label: 'Fabricated demo dataset (archives mirror DB snapshots)',
    as_of: '2026-07-15T18:00:00Z',
    period_labels: {
      daily: 'Today — Jul 15, 2026',
      weekly: 'Week 29, 2026',
      monthly: 'July 2026',
      yearly: '2026 (YTD)',
    },
    period_ranges: {
      daily: 'Jul 15, 2026',
      weekly: 'Jul 13 – Jul 19, 2026',
      monthly: 'Jul 1 – Jul 31, 2026',
      yearly: 'Jan 1 – Jul 15, 2026',
    },
    totals: {
      daily: {
        off_price_count: grand.daily,
        distinct_sellers: distinctFor('d'),
        vendors_with_hits: vendors.filter((v) => v.daily.off_price_count > 0).length,
        run_count: RAW.reduce((s, v) => s + v.runs.d, 0),
      },
      weekly: {
        off_price_count: grand.weekly,
        distinct_sellers: distinctFor('w'),
        vendors_with_hits: vendors.filter((v) => v.weekly.off_price_count > 0).length,
        run_count: RAW.reduce((s, v) => s + v.runs.w, 0),
      },
      monthly: {
        off_price_count: grand.monthly,
        distinct_sellers: distinctFor('m'),
        vendors_with_hits: vendors.filter((v) => v.monthly.off_price_count > 0).length,
        run_count: RAW.reduce((s, v) => s + v.runs.m, 0),
      },
      yearly: {
        off_price_count: grand.yearly,
        distinct_sellers: distinctFor('y'),
        vendors_with_hits: vendors.filter((v) => v.yearly.off_price_count > 0).length,
        run_count: RAW.reduce((s, v) => s + v.runs.y, 0),
      },
    },
    vendors,
    top_sellers_overall,
    historical_years: buildHistoricalYears(vendors),
    historical_months: buildHistoricalMonths(
      grand.monthly,
      RAW.reduce((s, v) => s + v.runs.m, 0),
    ),
  }
}
