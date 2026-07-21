import XLSX from 'xlsx-js-style'
import type { AnalyticsPeriod, DemoOffPriceAnalytics } from '../lib/demoOffPriceAnalytics'

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '404040' } },
  alignment: { horizontal: 'left', vertical: 'center' },
}

const ALL_PERIODS: AnalyticsPeriod[] = ['daily', 'weekly', 'monthly', 'yearly']

export type OffPriceExcelExportOptions = {
  vendorCodes?: string[]
  /** Period sheets/columns to include. Default: all four. */
  periods?: AnalyticsPeriod[]
  /**
   * Historical year tabs to include.
   * - undefined: include all years (full download)
   * - []: include none
   * - [2024, 2025]: only those years
   */
  historicalYears?: number[]
}

function styleHeaderRow(ws: XLSX.WorkSheet, colCount: number) {
  for (let c = 0; c < colCount; c++) {
    const ref = XLSX.utils.encode_cell({ r: 0, c })
    const cell = ws[ref]
    if (cell) cell.s = HEADER_STYLE
  }
}

function aoaToStyledSheet(rows: (string | number)[][], colWidths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = colWidths.map((wch) => ({ wch }))
  if (rows.length > 0) styleHeaderRow(ws, rows[0].length)
  return ws
}

function sellerHitsForPeriod(
  seller: {
    daily_hits: number
    weekly_hits: number
    monthly_hits: number
    yearly_hits: number
  },
  period: AnalyticsPeriod,
): number {
  if (period === 'daily') return seller.daily_hits
  if (period === 'weekly') return seller.weekly_hits
  if (period === 'monthly') return seller.monthly_hits
  return seller.yearly_hits
}

function periodTitle(period: AnalyticsPeriod): string {
  return period.charAt(0).toUpperCase() + period.slice(1)
}

/** Build a multi-sheet Excel workbook from the analytics demo dataset. */
export function buildOffPriceAnalyticsExcelBlob(
  data: DemoOffPriceAnalytics,
  options?: OffPriceExcelExportOptions,
): Blob {
  const selected = new Set(
    (options?.vendorCodes?.length
      ? options.vendorCodes
      : data.vendors.map((v) => v.code)
    ).map((c) => c.toLowerCase()),
  )
  const vendors = data.vendors.filter((v) => selected.has(v.code.toLowerCase()))
  const vendorCodeSet = new Set(vendors.map((v) => v.code.toLowerCase()))

  const periods: AnalyticsPeriod[] =
    options?.periods === undefined
      ? [...ALL_PERIODS]
      : ALL_PERIODS.filter((p) => options.periods!.includes(p))

  const availableYears = data.historical_years.map((y) => y.year)
  const historicalYears =
    options?.historicalYears === undefined
      ? availableYears
      : availableYears.filter((y) => options.historicalYears!.includes(y))

  const sumHits = (period: AnalyticsPeriod) =>
    vendors.reduce((s, v) => s + v[period].off_price_count, 0)
  const sumRuns = (period: AnalyticsPeriod) =>
    vendors.reduce((s, v) => s + v[period].run_count, 0)
  const distinctSellers = (period: AnalyticsPeriod) => {
    const names = new Set<string>()
    for (const v of vendors) {
      for (const s of v.sellers) {
        if (sellerHitsForPeriod(s, period) > 0) names.add(s.seller_name)
      }
    }
    return names.size
  }

  const scopeLabel =
    vendors.length === data.vendors.length
      ? 'All vendors'
      : vendors.length === 1
        ? vendors[0].name
        : `${vendors.length} vendors: ${vendors.map((v) => v.code.toUpperCase()).join(', ')}`

  const rangesLabel = [
    ...periods.map(periodTitle),
    ...(historicalYears.length
      ? [`Historical years: ${[...historicalYears].sort((a, b) => b - a).join(', ')}`]
      : []),
  ].join(' · ')

  const wb = XLSX.utils.book_new()

  const businessValueRows: (string | number)[][] = [
    ['#', 'Why this analytics matters', 'How it helps the business'],
    [
      1,
      'Protect brand MAP (Minimum Advertised Price)',
      'Surfaces sellers pricing below MAP so the team can intervene before brand relationships and authorized-dealer standing are damaged.',
    ],
    [
      2,
      'Prioritize high-impact offenders',
      'Ranks sellers by daily, weekly, and monthly hit counts so enforcement starts with the accounts causing the most leakage — not quieter one-off listings.',
    ],
    [
      3,
      'See trend, not just a single snapshot',
      'Daily / weekly / monthly views show whether off-price activity is spiking, steady, or improving after outreach — supporting stronger follow-up decisions.',
    ],
    [
      4,
      'Cover every vendor (active and inactive)',
      'Includes all vendor lines so inactive scheduled brands are not ignored; problems on quieter brands still surface in the same report.',
    ],
    [
      5,
      'Allocate team time with share %',
      'Percentage of total and share within each vendor show where to focus MAP monitoring and seller contact capacity for the biggest return.',
    ],
    [
      6,
      'Support brand and ops reporting',
      'Exportable Excel gives ops, category owners, and leadership a shared artifact for weekly standups, brand updates, and audit trails.',
    ],
    [
      7,
      'Catch repeat sellers across brands',
      'The Top Sellers sheet reveals accounts that undercut MAP on multiple vendors — a stronger signal for escalation or marketplace reporting.',
    ],
    [],
    ['Export scope', scopeLabel],
    ['Included ranges', rangesLabel || 'None'],
    [
      'Historical archives in this file',
      historicalYears.length
        ? `${historicalYears.length} year(s): ${[...historicalYears].sort((a, b) => b - a).join(', ')}`
        : 'None selected',
    ],
    ['Source note', data.demo_label],
  ]

  const businessWs = aoaToStyledSheet(businessValueRows, [28, 42, 78])
  XLSX.utils.book_append_sheet(wb, businessWs, 'Business Value')

  if (periods.length > 0) {
    const summaryHeader = ['Metric', ...periods.map(periodTitle)]
    const summaryRows: (string | number)[][] = [
      summaryHeader,
      ['Off-price hits', ...periods.map((p) => sumHits(p))],
      ['Distinct sellers', ...periods.map((p) => distinctSellers(p))],
      [
        'Vendors included',
        ...periods.map((p) => vendors.filter((v) => v[p].off_price_count > 0).length),
      ],
      ['Daily runs in period', ...periods.map((p) => sumRuns(p))],
      [],
      ['Export scope', scopeLabel],
      ['As of', data.as_of],
      ['Included ranges', rangesLabel],
    ]
    XLSX.utils.book_append_sheet(
      wb,
      aoaToStyledSheet(summaryRows, [24, ...periods.map(() => 18)]),
      'Summary',
    )

    const vendorHeader = [
      'Vendor code',
      'Vendor name',
      'Scheduler status',
      ...periods.map((p) => `${periodTitle(p)} hits`),
    ]
    const vendorRows: (string | number)[][] = [vendorHeader]
    for (const v of vendors) {
      vendorRows.push([
        v.code.toUpperCase(),
        v.name,
        v.scheduler_enabled ? 'Active' : 'Inactive',
        ...periods.map((p) => v[p].off_price_count),
      ])
    }
    XLSX.utils.book_append_sheet(
      wb,
      aoaToStyledSheet(vendorRows, [12, 18, 14, ...periods.map(() => 12)]),
      'Vendors',
    )

    const sellerHeader = [
      'Vendor code',
      'Vendor name',
      'Seller name',
      ...periods.map((p) => `${periodTitle(p)} hits`),
      'Avg discount %',
      'Last seen',
    ]
    const sellerRows: (string | number)[][] = [sellerHeader]
    for (const v of vendors) {
      for (const s of v.sellers) {
        sellerRows.push([
          v.code.toUpperCase(),
          v.name,
          s.seller_name,
          ...periods.map((p) => sellerHitsForPeriod(s, p)),
          s.avg_discount_pct,
          s.last_seen,
        ])
      }
    }
    XLSX.utils.book_append_sheet(
      wb,
      aoaToStyledSheet(sellerRows, [12, 18, 24, ...periods.map(() => 12), 14, 12]),
      'Sellers by Vendor',
    )

    const topHeader = ['Rank', 'Seller name', 'Vendors', ...periods.map(periodTitle)]
    const topRows: (string | number)[][] = [topHeader]
    data.top_sellers_overall
      .filter((s) => s.vendor_codes.some((c) => vendorCodeSet.has(c.toLowerCase())))
      .forEach((s, idx) => {
        topRows.push([
          idx + 1,
          s.seller_name,
          s.vendor_codes
            .filter((c) => vendorCodeSet.has(c.toLowerCase()))
            .map((c) => c.toUpperCase())
            .join(', '),
          ...periods.map((p) => sellerHitsForPeriod(s, p)),
        ])
      })
    XLSX.utils.book_append_sheet(
      wb,
      aoaToStyledSheet(topRows, [8, 24, 18, ...periods.map(() => 10)]),
      'Top Sellers',
    )

    for (const period of periods) {
      const periodLabel = periodTitle(period)
      const periodRows: (string | number)[][] = [
        [
          'Vendor code',
          'Vendor name',
          'Status',
          'Off-price hits',
          '% of total',
          'Runs',
          'Change vs prior %',
          'Period label',
          'Period range',
        ],
      ]
      const periodTotal = sumHits(period)
      for (const v of vendors) {
        const stats = v[period]
        periodRows.push([
          v.code.toUpperCase(),
          v.name,
          v.scheduler_enabled ? 'Active' : 'Inactive',
          stats.off_price_count,
          periodTotal > 0
            ? Math.round((stats.off_price_count / periodTotal) * 1000) / 10
            : 0,
          stats.run_count,
          stats.change_vs_prior_pct,
          data.period_labels[period],
          data.period_ranges[period],
        ])
      }
      periodRows.push([])
      periodRows.push(['Period total (selected)', periodTotal])
      periodRows.push(['Distinct sellers', distinctSellers(period)])
      periodRows.push(['Period label', data.period_labels[period]])
      periodRows.push(['Period range', data.period_ranges[period]])
      periodRows.push([])
      periodRows.push([
        'Seller name',
        'Vendor code',
        'Vendor name',
        `${periodLabel} hits`,
        'Avg discount %',
        'Last seen',
      ])
      for (const v of vendors) {
        for (const s of v.sellers) {
          const hits = sellerHitsForPeriod(s, period)
          if (hits <= 0) continue
          periodRows.push([
            s.seller_name,
            v.code.toUpperCase(),
            v.name,
            hits,
            s.avg_discount_pct,
            s.last_seen,
          ])
        }
      }
      XLSX.utils.book_append_sheet(
        wb,
        aoaToStyledSheet(periodRows, [14, 18, 12, 14, 12, 10, 16, 22, 28]),
        periodLabel,
      )
    }
  }

  const sortedHistorical = [...data.historical_years]
    .filter((y) => historicalYears.includes(y.year))
    .sort((a, b) => b.year - a.year)

  if (sortedHistorical.length > 0) {
    const historicalSummaryRows: (string | number)[][] = [
      ['Year', 'Label', 'Period range', 'Off-price hits', 'Runs', 'Distinct sellers', 'Vendors with hits'],
    ]
    for (const y of sortedHistorical) {
      const yearVendors = y.vendors.filter((v) => vendorCodeSet.has(v.code.toLowerCase()))
      historicalSummaryRows.push([
        y.year,
        y.period_label,
        y.period_range,
        yearVendors.reduce((s, v) => s + v.off_price_count, 0),
        yearVendors.reduce((s, v) => s + v.run_count, 0),
        y.distinct_sellers,
        yearVendors.filter((v) => v.off_price_count > 0).length,
      ])
    }
    XLSX.utils.book_append_sheet(
      wb,
      aoaToStyledSheet(historicalSummaryRows, [10, 14, 28, 14, 10, 16, 16]),
      'Historical Years',
    )

    for (const y of sortedHistorical) {
      const yearVendors = y.vendors.filter((v) => vendorCodeSet.has(v.code.toLowerCase()))
      const yearRows: (string | number)[][] = [
        ['Vendor code', 'Vendor name', 'Status', 'Off-price hits', '% of year', 'Runs', 'Top sellers'],
      ]
      for (const v of yearVendors) {
        yearRows.push([
          v.code.toUpperCase(),
          v.name,
          v.scheduler_enabled ? 'Active' : 'Inactive',
          v.off_price_count,
          v.pct_of_total,
          v.run_count,
          v.sellers
            .slice(0, 3)
            .map((s) => `${s.seller_name} (${s.hits})`)
            .join('; '),
        ])
      }
      yearRows.push([])
      yearRows.push(['Year total (selected)', yearVendors.reduce((s, v) => s + v.off_price_count, 0)])
      yearRows.push(['Period label', y.period_label])
      yearRows.push(['Period', y.period_range])
      yearRows.push([])
      yearRows.push(['Seller name', 'Vendor code', 'Vendor name', 'Hits', '% of vendor'])
      for (const v of yearVendors) {
        for (const s of v.sellers) {
          if (s.hits <= 0) continue
          yearRows.push([
            s.seller_name,
            v.code.toUpperCase(),
            v.name,
            s.hits,
            s.pct_of_vendor,
          ])
        }
      }
      XLSX.utils.book_append_sheet(
        wb,
        aoaToStyledSheet(yearRows, [12, 18, 12, 14, 12, 10, 50]),
        `Year ${y.year}`.slice(0, 31),
      )
    }
  }

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** Parse comma/space-separated years against available archive years. */
export function parseHistoricalYearsInput(
  raw: string,
  availableYears: number[],
): { years: number[]; unknown: number[] } {
  const available = new Set(availableYears)
  const seen = new Set<number>()
  const years: number[] = []
  const unknown: number[] = []
  for (const part of raw.split(/[,;\s]+/)) {
    const trimmed = part.trim()
    if (!trimmed || !/^\d{4}$/.test(trimmed)) continue
    const y = Number.parseInt(trimmed, 10)
    if (seen.has(y)) continue
    seen.add(y)
    if (available.has(y)) years.push(y)
    else unknown.push(y)
  }
  years.sort((a, b) => b - a)
  return { years, unknown }
}

export function formatEmailReportRangesLabel(
  periods: AnalyticsPeriod[],
  historicalYears: number[],
): string {
  const parts = [
    ...ALL_PERIODS.filter((p) => periods.includes(p)).map(periodTitle),
    ...(historicalYears.length
      ? [`Years ${[...historicalYears].sort((a, b) => b - a).join(', ')}`]
      : []),
  ]
  return parts.join(', ') || 'none'
}

export function offPriceAnalyticsExcelFilename(
  asOfIso: string,
  vendorCodes?: string[],
  totalVendorCount?: number,
): string {
  const day = asOfIso.slice(0, 10) || new Date().toISOString().slice(0, 10)
  if (!vendorCodes?.length) return `off-price-analytics-all-${day}.xlsx`
  if (vendorCodes.length === 1) {
    return `off-price-analytics-${vendorCodes[0].toUpperCase()}-${day}.xlsx`
  }
  const allCount = totalVendorCount ?? vendorCodes.length
  if (vendorCodes.length >= allCount) return `off-price-analytics-all-${day}.xlsx`
  return `off-price-analytics-${vendorCodes.length}vendors-${day}.xlsx`
}
