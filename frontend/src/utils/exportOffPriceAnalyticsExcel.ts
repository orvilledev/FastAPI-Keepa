import XLSX from 'xlsx-js-style'
import type { DemoOffPriceAnalytics } from '../lib/demoOffPriceAnalytics'

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '404040' } },
  alignment: { horizontal: 'left', vertical: 'center' },
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

/** Build a multi-sheet Excel workbook from the analytics demo dataset. */
export function buildOffPriceAnalyticsExcelBlob(
  data: DemoOffPriceAnalytics,
  options?: { vendorCodes?: string[] },
): Blob {
  const selected = new Set(
    (options?.vendorCodes?.length
      ? options.vendorCodes
      : data.vendors.map((v) => v.code)
    ).map((c) => c.toLowerCase()),
  )
  const vendors = data.vendors.filter((v) => selected.has(v.code.toLowerCase()))
  const vendorCodeSet = new Set(vendors.map((v) => v.code.toLowerCase()))

  const sumHits = (period: 'daily' | 'weekly' | 'monthly' | 'yearly') =>
    vendors.reduce((s, v) => s + v[period].off_price_count, 0)
  const sumRuns = (period: 'daily' | 'weekly' | 'monthly' | 'yearly') =>
    vendors.reduce((s, v) => s + v[period].run_count, 0)
  const distinctSellers = (period: 'daily' | 'weekly' | 'monthly' | 'yearly') => {
    const names = new Set<string>()
    for (const v of vendors) {
      for (const s of v.sellers) {
        const hits =
          period === 'daily'
            ? s.daily_hits
            : period === 'weekly'
              ? s.weekly_hits
              : period === 'monthly'
                ? s.monthly_hits
                : s.yearly_hits
        if (hits > 0) names.add(s.seller_name)
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
    [
      'Historical archives',
      `${data.historical_years.length} years available for download (kept separate from Express Jobs).`,
    ],
    ['Source note', data.demo_label],
  ]

  const businessWs = aoaToStyledSheet(businessValueRows, [28, 42, 78])
  XLSX.utils.book_append_sheet(wb, businessWs, 'Business Value')

  const summaryRows: (string | number)[][] = [
    ['Metric', 'Daily', 'Weekly', 'Monthly', 'Yearly'],
    ['Off-price hits', sumHits('daily'), sumHits('weekly'), sumHits('monthly'), sumHits('yearly')],
    [
      'Distinct sellers',
      distinctSellers('daily'),
      distinctSellers('weekly'),
      distinctSellers('monthly'),
      distinctSellers('yearly'),
    ],
    [
      'Vendors included',
      vendors.filter((v) => v.daily.off_price_count > 0).length,
      vendors.filter((v) => v.weekly.off_price_count > 0).length,
      vendors.filter((v) => v.monthly.off_price_count > 0).length,
      vendors.filter((v) => v.yearly.off_price_count > 0).length,
    ],
    ['Daily runs in period', sumRuns('daily'), sumRuns('weekly'), sumRuns('monthly'), sumRuns('yearly')],
    [],
    ['Export scope', scopeLabel],
    ['As of', data.as_of],
  ]
  XLSX.utils.book_append_sheet(wb, aoaToStyledSheet(summaryRows, [24, 18, 18, 18, 18]), 'Summary')

  const vendorRows: (string | number)[][] = [
    [
      'Vendor code',
      'Vendor name',
      'Scheduler status',
      'Daily hits',
      'Weekly hits',
      'Monthly hits',
      'Yearly hits',
    ],
  ]
  for (const v of vendors) {
    vendorRows.push([
      v.code.toUpperCase(),
      v.name,
      v.scheduler_enabled ? 'Active' : 'Inactive',
      v.daily.off_price_count,
      v.weekly.off_price_count,
      v.monthly.off_price_count,
      v.yearly.off_price_count,
    ])
  }
  XLSX.utils.book_append_sheet(wb, aoaToStyledSheet(vendorRows, [12, 18, 14, 12, 12, 12, 12]), 'Vendors')

  const sellerRows: (string | number)[][] = [
    [
      'Vendor code',
      'Vendor name',
      'Seller name',
      'Daily hits',
      'Weekly hits',
      'Monthly hits',
      'Yearly hits',
      'Avg discount %',
      'Last seen',
    ],
  ]
  for (const v of vendors) {
    for (const s of v.sellers) {
      sellerRows.push([
        v.code.toUpperCase(),
        v.name,
        s.seller_name,
        s.daily_hits,
        s.weekly_hits,
        s.monthly_hits,
        s.yearly_hits,
        s.avg_discount_pct,
        s.last_seen,
      ])
    }
  }
  XLSX.utils.book_append_sheet(
    wb,
    aoaToStyledSheet(sellerRows, [12, 18, 24, 12, 12, 12, 12, 14, 12]),
    'Sellers by Vendor',
  )

  const topRows: (string | number)[][] = [
    ['Rank', 'Seller name', 'Vendors', 'Daily', 'Weekly', 'Monthly', 'Yearly'],
  ]
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
        s.daily_hits,
        s.weekly_hits,
        s.monthly_hits,
        s.yearly_hits,
      ])
    })
  XLSX.utils.book_append_sheet(wb, aoaToStyledSheet(topRows, [8, 24, 18, 10, 10, 10, 10]), 'Top Sellers')

  const periods: Array<'daily' | 'weekly' | 'monthly' | 'yearly'> = [
    'daily',
    'weekly',
    'monthly',
    'yearly',
  ]
  for (const period of periods) {
    const periodLabel = period.charAt(0).toUpperCase() + period.slice(1)
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
        const hits =
          period === 'daily'
            ? s.daily_hits
            : period === 'weekly'
              ? s.weekly_hits
              : period === 'monthly'
                ? s.monthly_hits
                : s.yearly_hits
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

  const historicalSummaryRows: (string | number)[][] = [
    ['Year', 'Label', 'Period range', 'Off-price hits', 'Runs', 'Distinct sellers', 'Vendors with hits'],
  ]
  for (const y of [...data.historical_years].sort((a, b) => b.year - a.year)) {
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

  // One tab per archived year (latest → oldest, including current year YTD)
  for (const y of [...data.historical_years].sort((a, b) => b.year - a.year)) {
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

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function offPriceAnalyticsExcelFilename(
  asOfIso: string,
  vendorCodes?: string[],
): string {
  const day = asOfIso.slice(0, 10) || new Date().toISOString().slice(0, 10)
  if (!vendorCodes?.length) return `off-price-analytics-all-${day}.xlsx`
  if (vendorCodes.length === 1) {
    return `off-price-analytics-${vendorCodes[0].toUpperCase()}-${day}.xlsx`
  }
  if (vendorCodes.length >= 8) return `off-price-analytics-all-${day}.xlsx`
  return `off-price-analytics-${vendorCodes.length}vendors-${day}.xlsx`
}
