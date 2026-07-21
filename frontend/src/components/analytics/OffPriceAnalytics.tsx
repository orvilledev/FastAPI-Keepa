import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  buildDemoOffPriceAnalytics,
  DEMO_ANALYTICS_CURRENT_YEAR,
  type AnalyticsPeriod,
  type DemoOffPriceAnalytics,
  type DemoVendorAnalytics,
  type DemoYearArchive,
} from '../../lib/demoOffPriceAnalytics'
import {
  analyticsSourceBadgeLabel,
  hasAnalyticsDemoEnded,
  resolveAnalyticsDataSource,
  type AnalyticsDataSource,
} from '../../lib/analyticsCutover'
import {
  buildLiveOffPriceAnalytics,
  purgeDemoAnalyticsSnapshots,
} from '../../lib/buildLiveOffPriceAnalytics'
import { useUser } from '../../contexts/UserContext'
import { analyticsApi } from '../../services/api'
import { downloadBlob } from '../../utils/downloadLinkedFile'
import {
  buildOffPriceAnalyticsExcelBlob,
  formatEmailReportRangesLabel,
  offPriceAnalyticsExcelFilename,
  parseHistoricalYearsInput,
} from '../../utils/exportOffPriceAnalyticsExcel'
import EmailRecipientsPicker from '../jobs/EmailRecipientsPicker'

const CHART_BLUE = '#3b9dd0'
const CHART_PINK = '#FA6781'
const CHART_YELLOW = '#F7E58C'
const VENDOR_BAR_COLORS = [
  '#3b9dd0',
  '#FA6781',
  '#81B81D',
  '#F97316',
  '#8ccbee',
  '#ffa5c8',
  '#404040',
  '#F7E58C',
]

const PERIODS: { id: AnalyticsPeriod; label: string; description: string }[] = [
  {
    id: 'daily',
    label: 'Daily',
    description: 'Off-price seller hits from today’s daily runs',
  },
  {
    id: 'weekly',
    label: 'Weekly',
    description: 'Off-price seller hits aggregated across this week’s daily runs',
  },
  {
    id: 'monthly',
    label: 'Monthly',
    description: 'Off-price seller hits aggregated across this month’s daily runs',
  },
  {
    id: 'yearly',
    label: 'Yearly',
    description: 'Year-to-date and archived full-year off-price analytics (kept for download)',
  },
]

function formatChange(value: number): { text: string; className: string } {
  if (value > 0) {
    return { text: `+${value.toFixed(1)}%`, className: 'text-amber-700 dark:text-amber-400' }
  }
  if (value < 0) {
    return { text: `${value.toFixed(1)}%`, className: 'text-emerald-700 dark:text-emerald-400' }
  }
  return { text: '0%', className: 'text-gray-500 dark:text-content-muted' }
}

function ShareBar({ pct }: { pct: number }) {
  const width = Math.min(100, Math.max(0, pct))
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100 dark:bg-surface-muted sm:w-28">
        <div
          className="h-full rounded-full bg-[#404040] dark:bg-slate-300"
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="tabular-nums text-xs text-gray-500 dark:text-content-muted">
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

function sellerHitsForPeriod(seller: DemoVendorAnalytics['sellers'][number], period: AnalyticsPeriod) {
  if (period === 'daily') return seller.daily_hits
  if (period === 'weekly') return seller.weekly_hits
  if (period === 'monthly') return seller.monthly_hits
  return seller.yearly_hits
}

function vendorStatsForPeriod(vendor: DemoVendorAnalytics, period: AnalyticsPeriod) {
  return vendor[period]
}

function sellerHitsOverall(
  seller: DemoOffPriceTopSeller,
  period: AnalyticsPeriod,
): number {
  if (period === 'daily') return seller.daily_hits
  if (period === 'weekly') return seller.weekly_hits
  if (period === 'monthly') return seller.monthly_hits
  return seller.yearly_hits
}

type DemoOffPriceTopSeller = ReturnType<typeof buildDemoOffPriceAnalytics>['top_sellers_overall'][number]

const TRACKING_STORAGE_PREFIX = 'off-price-analytics-tracking-user-'
const DOWNLOAD_LOG_STORAGE_KEY = 'off-price-analytics-download-logs-v1'

type DownloadLogEntry = {
  id?: string | null
  user_display_name: string | null
  user_email?: string | null
  vendor_codes: string[]
  vendor_scope: 'all' | 'selected'
  vendor_label: string
  filename?: string | null
  period?: string | null
  downloaded_at: string
}

function trackingStorageKey(userId: string) {
  return `${TRACKING_STORAGE_PREFIX}${userId || 'anonymous'}`
}

function loadLocalTracking(userId: string, vendorCodes: string[]): Record<string, boolean> {
  const defaults = Object.fromEntries(vendorCodes.map((c) => [c, true]))
  try {
    const raw = localStorage.getItem(trackingStorageKey(userId))
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Record<string, boolean>
    return { ...defaults, ...parsed }
  } catch {
    return defaults
  }
}

function saveLocalTracking(userId: string, map: Record<string, boolean>) {
  try {
    localStorage.setItem(trackingStorageKey(userId), JSON.stringify(map))
  } catch {
    // ignore
  }
}

function loadLocalDownloadLogs(): DownloadLogEntry[] {
  try {
    const raw = localStorage.getItem(DOWNLOAD_LOG_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as DownloadLogEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveLocalDownloadLog(entry: DownloadLogEntry) {
  try {
    const prev = loadLocalDownloadLogs()
    localStorage.setItem(DOWNLOAD_LOG_STORAGE_KEY, JSON.stringify([entry, ...prev].slice(0, 100)))
  } catch {
    // ignore
  }
}

function formatVendorScopeLabel(
  codes: string[],
  vendorNames: Record<string, string>,
  totalVendorCount?: number,
): string {
  const allCount = totalVendorCount ?? codes.length
  if (!codes.length || (allCount > 0 && codes.length >= allCount)) return 'All vendors'
  if (codes.length === 1) return vendorNames[codes[0]] || codes[0].toUpperCase()
  if (codes.length <= 3) {
    return codes.map((c) => vendorNames[c] || c.toUpperCase()).join(', ')
  }
  return `${codes
    .slice(0, 3)
    .map((c) => vendorNames[c] || c.toUpperCase())
    .join(', ')} (+${codes.length - 3} more)`
}

function formatLogWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function TrackingSwitch({
  enabled,
  busy,
  onChange,
  label,
}: {
  enabled: boolean
  busy?: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!enabled)
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#404040]/40 disabled:opacity-50 ${
        enabled ? 'bg-emerald-600' : 'bg-gray-300 dark:bg-slate-600'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export default function OffPriceAnalytics() {
  const { displayName, userInfo, authUser } = useUser()
  const userId = userInfo?.id || authUser?.id || 'anonymous'
  const userLabel = displayName || userInfo?.email || 'Someone'

  const [searchParams, setSearchParams] = useSearchParams()
  const periodParam = searchParams.get('period')
  const period: AnalyticsPeriod =
    periodParam === 'daily' || periodParam === 'monthly' || periodParam === 'yearly'
      ? periodParam
      : 'weekly'
  const yearParam = searchParams.get('year')
  const dataSource: AnalyticsDataSource = resolveAnalyticsDataSource(searchParams)
  const showLivePreviewToggle = !hasAnalyticsDemoEnded()

  const [data, setData] = useState<DemoOffPriceAnalytics | null>(
    dataSource === 'demo' ? () => buildDemoOffPriceAnalytics() : null,
  )
  const [dataLoading, setDataLoading] = useState(dataSource === 'live')
  const [dataError, setDataError] = useState<string | null>(null)
  const [archiveStatus, setArchiveStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (dataSource === 'demo') {
      setData(buildDemoOffPriceAnalytics())
      setDataLoading(false)
      setDataError(null)
      analyticsApi
        .seedDemoHistory()
        .then((res) => {
          if (!cancelled) {
            setArchiveStatus(
              res.count > 0
                ? `Archived ${res.count} period snapshot(s) to the database for historical download.`
                : 'Archive table available — snapshots upserted when empty.',
            )
          }
        })
        .catch(() => {
          if (!cancelled) {
            setArchiveStatus(
              'Demo archives shown locally. Apply migration create_off_price_analytics_snapshots.sql to persist them in the DB.',
            )
          }
        })
      return () => {
        cancelled = true
      }
    }

    setDataLoading(true)
    setDataError(null)
    setArchiveStatus(null)
    ;(async () => {
      const purged = await purgeDemoAnalyticsSnapshots()
      try {
        const live = await buildLiveOffPriceAnalytics()
        if (cancelled) return
        setData(live)
        setArchiveStatus(
          purged > 0
            ? `Live data · removed ${purged} demo snapshot(s). Preview via ?source=live until Aug 1, 2026 Central.`
            : 'Live Daily Run data · demo snapshots excluded. Cutover Aug 1, 2026 Central.',
        )
      } catch (err: unknown) {
        if (cancelled) return
        const message =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
          (err as Error)?.message ||
          'Failed to load live analytics'
        setDataError(String(message))
        setData(null)
      } finally {
        if (!cancelled) setDataLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [dataSource])

  const vendorCodes = useMemo(() => data?.vendors.map((v) => v.code) ?? [], [data])
  const vendorNames = useMemo(
    () => Object.fromEntries((data?.vendors ?? []).map((v) => [v.code, v.name])),
    [data],
  )
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null)
  // Default-open the first vendor once data arrives. Do not re-open when the user
  // collapses (null) — that previously trapped alphabetical vendors[0] (often clk).
  useEffect(() => {
    setExpandedVendor((prev) => prev ?? data?.vendors[0]?.code ?? null)
  }, [data])
  const [downloading, setDownloading] = useState(false)
  const [tracking, setTracking] = useState<Record<string, boolean>>(() =>
    loadLocalTracking(userId, ['dnk', 'clk', 'obz', 'ref', 'bor', 'sff', 'tev', 'cha', 'jfs']),
  )
  const [trackingBusy, setTrackingBusy] = useState<string | null>(null)
  const [trackingSource, setTrackingSource] = useState<'local' | 'db'>('local')
  const [showTrackingPanel, setShowTrackingPanel] = useState(false)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [downloadSelection, setDownloadSelection] = useState<Record<string, boolean>>({})
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailSelection, setEmailSelection] = useState<Record<string, boolean>>({})
  const [emailPeriods, setEmailPeriods] = useState<Record<AnalyticsPeriod, boolean>>({
    daily: true,
    weekly: true,
    monthly: true,
    yearly: true,
  })
  const [emailIncludeHistorical, setEmailIncludeHistorical] = useState(false)
  const [emailHistoricalYearsInput, setEmailHistoricalYearsInput] = useState('')
  const [emailRecipients, setEmailRecipients] = useState('')
  const [emailBccRecipients, setEmailBccRecipients] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailStatus, setEmailStatus] = useState<string | null>(null)
  const [showDownloadLogs, setShowDownloadLogs] = useState(false)
  const [downloadLogs, setDownloadLogs] = useState<DownloadLogEntry[]>(() => loadLocalDownloadLogs())

  // Reload personal tracking when user changes
  useEffect(() => {
    setTracking(loadLocalTracking(userId, vendorCodes))
  }, [userId, vendorCodes])

  const currentAnalyticsYear = useMemo(() => {
    if (!data) return DEMO_ANALYTICS_CURRENT_YEAR
    const fromYears = data.historical_years[0]?.year
    if (fromYears) return fromYears
    const y = Number.parseInt(data.period_labels.yearly || '', 10)
    return Number.isFinite(y) ? y : DEMO_ANALYTICS_CURRENT_YEAR
  }, [data])

  const selectedYear = useMemo(() => {
    if (!data || period !== 'yearly') return null
    const years = data.historical_years.map((y) => y.year)
    const parsed = yearParam ? Number.parseInt(yearParam, 10) : NaN
    if (years.includes(parsed)) return parsed
    return years[0] ?? currentAnalyticsYear
  }, [period, yearParam, data, currentAnalyticsYear])

  const selectedYearArchive: DemoYearArchive | null = useMemo(() => {
    if (!data || selectedYear == null) return null
    return data.historical_years.find((y) => y.year === selectedYear) ?? null
  }, [data, selectedYear])

  useEffect(() => {
    let cancelled = false
    if (!data) return () => {
      cancelled = true
    }
    analyticsApi
      .listTracking()
      .then((res) => {
        if (cancelled) return
        const next: Record<string, boolean> = {}
        for (const row of res.vendors) {
          next[row.vendor_code] = row.tracking_enabled
        }
        setTracking((prev) => ({ ...prev, ...next }))
        saveLocalTracking(userId, { ...loadLocalTracking(userId, vendorCodes), ...next })
        setTrackingSource('db')
      })
      .catch(() => {
        if (!cancelled) setTrackingSource('local')
      })

    analyticsApi
      .listDownloadLogs(40)
      .then((res) => {
        if (cancelled || !res.available) return
        setDownloadLogs(res.logs as DownloadLogEntry[])
      })
      .catch(() => {
        /* keep local logs */
      })

    return () => {
      cancelled = true
    }
  }, [vendorCodes, userId, data])

  const setPeriod = (next: AnalyticsPeriod) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('period', next)
    if (next === 'yearly') {
      if (!nextParams.get('year')) {
        nextParams.set(
          'year',
          String(data?.historical_years[0]?.year ?? currentAnalyticsYear),
        )
      }
    } else {
      nextParams.delete('year')
    }
    setSearchParams(nextParams, { replace: true })
  }

  const setYear = (year: number) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('period', 'yearly')
    nextParams.set('year', String(year))
    setSearchParams(nextParams, { replace: true })
  }

  const setDataSourcePreference = (next: AnalyticsDataSource) => {
    if (!showLivePreviewToggle) return
    const nextParams = new URLSearchParams(searchParams)
    if (next === 'live') {
      nextParams.set('source', 'live')
    } else {
      nextParams.set('source', 'demo')
    }
    setSearchParams(nextParams, { replace: true })
  }

  const livePreviewToggle = showLivePreviewToggle ? (
    <div className="flex items-center gap-2.5">
      <TrackingSwitch
        enabled={dataSource === 'live'}
        onChange={(on) => setDataSourcePreference(on ? 'live' : 'demo')}
        label={dataSource === 'live' ? 'Switch to demo analytics' : 'Preview live analytics'}
      />
      <div className="min-w-0 text-left">
        <p className="text-sm font-medium text-gray-800 dark:text-content-primary">
          {dataSource === 'live' ? 'Live preview on' : 'Live preview off'}
        </p>
        <p className="text-xs text-gray-500 dark:text-content-muted">
          {dataSource === 'live'
            ? 'Showing Daily Run data · until Aug 1, 2026 Central'
            : 'Showing fabricated demo · toggle to preview live'}
        </p>
      </div>
    </div>
  ) : null

  const handleToggleTracking = async (vendorCode: string, enabled: boolean) => {
    const optimistic = { ...tracking, [vendorCode]: enabled }
    setTracking(optimistic)
    saveLocalTracking(userId, optimistic)
    setTrackingBusy(vendorCode)
    try {
      await analyticsApi.setTracking(vendorCode, enabled)
      setTrackingSource('db')
    } catch {
      setTrackingSource('local')
      setTracking(optimistic)
    } finally {
      setTrackingBusy(null)
    }
  }

  const openDownloadModal = () => {
    const initial = Object.fromEntries(
      vendorCodes.map((c) => [c, tracking[c] !== false]),
    )
    // If user paused everyone, still preselect all so they can pick
    if (!Object.values(initial).some(Boolean)) {
      for (const c of vendorCodes) initial[c] = true
    }
    setDownloadSelection(initial)
    setShowDownloadModal(true)
  }

  const openEmailModal = () => {
    const initial = Object.fromEntries(
      vendorCodes.map((c) => [c, tracking[c] !== false]),
    )
    if (!Object.values(initial).some(Boolean)) {
      for (const c of vendorCodes) initial[c] = true
    }
    setEmailSelection(initial)
    const nextPeriods: Record<AnalyticsPeriod, boolean> = {
      daily: period === 'daily',
      weekly: period === 'weekly',
      monthly: period === 'monthly',
      yearly: period === 'yearly',
    }
    if (!Object.values(nextPeriods).some(Boolean)) {
      nextPeriods.daily = true
    }
    setEmailPeriods(nextPeriods)
    setEmailIncludeHistorical(false)
    setEmailHistoricalYearsInput('')
    setEmailRecipients('')
    setEmailBccRecipients('')
    setEmailStatus(null)
    setShowEmailModal(true)
  }

  const selectedDownloadCodes = useMemo(
    () => vendorCodes.filter((c) => downloadSelection[c]),
    [vendorCodes, downloadSelection],
  )

  const selectedEmailCodes = useMemo(
    () => vendorCodes.filter((c) => emailSelection[c]),
    [vendorCodes, emailSelection],
  )

  const selectedEmailPeriodList = useMemo(
    () =>
      (['daily', 'weekly', 'monthly', 'yearly'] as AnalyticsPeriod[]).filter(
        (p) => emailPeriods[p],
      ),
    [emailPeriods],
  )

  const parsedEmailHistoricalYears = useMemo(() => {
    if (!emailIncludeHistorical || !data) return { years: [] as number[], unknown: [] as number[] }
    return parseHistoricalYearsInput(
      emailHistoricalYearsInput,
      data.historical_years.map((y) => y.year),
    )
  }, [emailIncludeHistorical, emailHistoricalYearsInput, data])

  const emailHasReportRanges =
    selectedEmailPeriodList.length > 0 || parsedEmailHistoricalYears.years.length > 0

  const handleConfirmDownload = async () => {
    if (!data || selectedDownloadCodes.length === 0) return
    setDownloading(true)
    try {
      const codes =
        selectedDownloadCodes.length >= vendorCodes.length ? vendorCodes : selectedDownloadCodes
      const blob = buildOffPriceAnalyticsExcelBlob(data, { vendorCodes: codes })
      const filename = offPriceAnalyticsExcelFilename(data.as_of, codes, vendorCodes.length)
      downloadBlob(blob, filename)

      const scope: 'all' | 'selected' = codes.length >= vendorCodes.length ? 'all' : 'selected'
      const entry: DownloadLogEntry = {
        user_display_name: userLabel,
        user_email: userInfo?.email || authUser?.email || null,
        vendor_codes: codes,
        vendor_scope: scope,
        vendor_label: formatVendorScopeLabel(codes, vendorNames, vendorCodes.length),
        filename,
        period,
        downloaded_at: new Date().toISOString(),
      }
      saveLocalDownloadLog(entry)
      setDownloadLogs((prev) => [entry, ...prev].slice(0, 100))

      try {
        const saved = await analyticsApi.recordDownloadLog({
          vendor_codes: codes,
          filename,
          period,
        })
        if (saved?.downloaded_at) {
          setDownloadLogs((prev) => [
            { ...entry, ...(saved as DownloadLogEntry) },
            ...prev.filter((l) => l.downloaded_at !== entry.downloaded_at),
          ])
        }
      } catch {
        // Local log already saved
      }

      setShowDownloadModal(false)
    } finally {
      setDownloading(false)
    }
  }

  const handleConfirmEmail = async () => {
    if (!data || selectedEmailCodes.length === 0) return
    const to = emailRecipients.trim()
    const bcc = emailBccRecipients.trim()
    if (!to && !bcc) {
      setEmailStatus('Select at least one To or BCC recipient.')
      return
    }
    if (!emailHasReportRanges) {
      setEmailStatus('Select at least one report range (period and/or historical years).')
      return
    }
    if (emailIncludeHistorical && parsedEmailHistoricalYears.unknown.length > 0) {
      setEmailStatus(
        `Unknown year(s): ${parsedEmailHistoricalYears.unknown.join(', ')}. Available: ${data.historical_years
          .map((y) => y.year)
          .slice(0, 8)
          .join(', ')}${data.historical_years.length > 8 ? '…' : ''}`,
      )
      return
    }
    if (emailIncludeHistorical && parsedEmailHistoricalYears.years.length === 0) {
      setEmailStatus('Enter historical years separated by commas (e.g. 2024, 2025).')
      return
    }
    setEmailSending(true)
    setEmailStatus(null)
    try {
      const codes =
        selectedEmailCodes.length >= vendorCodes.length ? vendorCodes : selectedEmailCodes
      const rangesLabel = formatEmailReportRangesLabel(
        selectedEmailPeriodList,
        parsedEmailHistoricalYears.years,
      )
      const blob = buildOffPriceAnalyticsExcelBlob(data, {
        vendorCodes: codes,
        periods: selectedEmailPeriodList,
        historicalYears: parsedEmailHistoricalYears.years,
      })
      const filename = offPriceAnalyticsExcelFilename(data.as_of, codes, vendorCodes.length)
      const result = await analyticsApi.emailReport({
        file: blob,
        filename,
        email_recipients: to,
        email_bcc_recipients: bcc || undefined,
        vendor_codes: codes,
        period: rangesLabel,
      })

      const scope: 'all' | 'selected' = codes.length >= vendorCodes.length ? 'all' : 'selected'
      const entry: DownloadLogEntry = {
        user_display_name: userLabel,
        user_email: userInfo?.email || authUser?.email || null,
        vendor_codes: codes,
        vendor_scope: scope,
        vendor_label: formatVendorScopeLabel(codes, vendorNames, vendorCodes.length),
        filename: `emailed:${result.filename || filename}`,
        period: rangesLabel,
        downloaded_at: new Date().toISOString(),
      }
      saveLocalDownloadLog(entry)
      setDownloadLogs((prev) => [entry, ...prev].slice(0, 100))

      setEmailStatus(
        `Sent to ${result.to_count} To` +
          (result.bcc_count ? ` and ${result.bcc_count} BCC` : '') +
          ' recipient(s).',
      )
      setTimeout(() => {
        setShowEmailModal(false)
        setEmailStatus(null)
      }, 1200)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as Error)?.message ||
        'Failed to send email'
      setEmailStatus(String(detail))
    } finally {
      setEmailSending(false)
    }
  }

  const trackedVendorCount = vendorCodes.filter((c) => tracking[c] !== false).length

  const totals = data?.totals[period] ?? {
    off_price_count: 0,
    distinct_sellers: 0,
    vendors_with_hits: 0,
    run_count: 0,
  }
  const sortedVendors = useMemo(
    () =>
      [...(data?.vendors ?? [])].sort((a, b) => {
        const aOn = tracking[a.code] !== false ? 1 : 0
        const bOn = tracking[b.code] !== false ? 1 : 0
        if (aOn !== bOn) return bOn - aOn
        return (
          vendorStatsForPeriod(b, period).off_price_count -
          vendorStatsForPeriod(a, period).off_price_count
        )
      }),
    [data?.vendors, period, tracking],
  )

  const topSellersForPeriod = useMemo(() => {
    return [...(data?.top_sellers_overall ?? [])].sort(
      (a, b) => sellerHitsOverall(b, period) - sellerHitsOverall(a, period),
    )
  }, [data?.top_sellers_overall, period])

  const vendorChartData = useMemo(
    () =>
      sortedVendors.map((v) => ({
        code: v.code.toUpperCase(),
        name: v.name,
        hits: vendorStatsForPeriod(v, period).off_price_count,
        tracking: tracking[v.code] !== false,
      })),
    [sortedVendors, period, tracking],
  )

  const topSellersChartData = useMemo(
    () =>
      [...(data?.top_sellers_overall ?? [])]
        .map((s) => ({
          name:
            s.seller_name.length > 18 ? `${s.seller_name.slice(0, 16)}…` : s.seller_name,
          fullName: s.seller_name,
          hits: sellerHitsOverall(s, period),
        }))
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 8),
    [data?.top_sellers_overall, period],
  )

  const historicalTrendData = useMemo(
    () =>
      [...(data?.historical_years ?? [])]
        .sort((a, b) => a.year - b.year)
        .slice(-20)
        .map((y) => ({
          year: String(y.year),
          hits: y.total_off_price_count,
          runs: y.total_run_count,
        })),
    [data?.historical_years],
  )

  const monthlyTrendData = useMemo(
    () =>
      [...(data?.historical_months ?? [])].map((m) => ({
        month: m.period_label,
        hits: m.total_off_price_count,
        runs: m.total_run_count,
      })),
    [data?.historical_months],
  )

  const archiveVendorChartData = useMemo(() => {
    if (!selectedYearArchive) return []
    return [...selectedYearArchive.vendors]
      .sort((a, b) => b.off_price_count - a.off_price_count)
      .map((v) => ({
        code: v.code.toUpperCase(),
        name: v.name,
        hits: v.off_price_count,
      }))
  }, [selectedYearArchive])

  const showingHistoricalYear =
    period === 'yearly' &&
    Boolean(selectedYearArchive) &&
    selectedYear !== currentAnalyticsYear

  const chartTooltipStyle = {
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    fontSize: 12,
  }

  if (dataLoading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8">
        <p className="text-sm text-gray-500 dark:text-content-muted">Loading live analytics…</p>
        {livePreviewToggle}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-medium text-gray-900 dark:text-content-primary">
          Could not load analytics
        </p>
        <p className="max-w-md text-sm text-gray-500 dark:text-content-muted">
          {dataError || 'Unknown error'}
        </p>
        {livePreviewToggle ? (
          <div className="mt-2">{livePreviewToggle}</div>
        ) : (
          dataSource === 'live' && (
            <p className="text-xs text-gray-400 dark:text-content-muted">
              Tip: before Aug 1, 2026 Central you can still open demo with{' '}
              <code className="rounded bg-gray-100 px-1 dark:bg-surface-muted">?source=demo</code>
            </p>
          )
        )}
      </div>
    )
  }

  const topSellerForPeriod = topSellersForPeriod[0]

  return (
    <div className="flex min-h-0 flex-col gap-6 lg:flex-row lg:gap-8">
      <aside className="w-full shrink-0 lg:w-52">
        <p className="sidebar-section-label mb-2">ANALYTICS</p>
        <nav className="flex flex-row gap-1 lg:flex-col lg:space-y-0.5 lg:gap-0">
          {PERIODS.map((item) => {
            const active = period === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPeriod(item.id)}
                className={`sidebar-link w-auto flex-1 text-left lg:w-full lg:flex-none ${
                  active ? 'sidebar-link-active' : 'sidebar-link-inactive'
                }`}
              >
                <span className="sidebar-link-label">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {period === 'yearly' && (
          <div className="mt-4 hidden lg:block">
            <p className="sidebar-section-label mb-2">ARCHIVED YEARS</p>
            <div className="max-h-[28rem] space-y-0.5 overflow-y-auto pr-1">
              {data.historical_years.map((y) => (
                <button
                  key={y.year}
                  type="button"
                  onClick={() => setYear(y.year)}
                  className={`sidebar-link w-full text-left ${
                    selectedYear === y.year ? 'sidebar-link-active' : 'sidebar-link-inactive'
                  }`}
                >
                  <span className="sidebar-link-label">{y.period_label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-4 hidden text-xs text-gray-500 dark:text-content-muted lg:block">
          Archives come from Daily Runs only. Deleting Express Jobs never removes or changes this analytics history.
        </p>
        {dataSource === 'demo' ? (
          <p className="mt-3 hidden text-[11px] font-medium uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80 lg:block">
            Fabricated · until Aug 1, 2026 Central
          </p>
        ) : showLivePreviewToggle ? (
          <p className="mt-3 hidden text-[11px] font-medium uppercase tracking-wide text-emerald-700/80 dark:text-emerald-400/80 lg:block">
            Live preview · use header toggle
          </p>
        ) : (
          <p className="mt-3 hidden text-[11px] font-medium uppercase tracking-wide text-emerald-700/80 dark:text-emerald-400/80 lg:block">
            Live Daily Run data
          </p>
        )}
      </aside>

      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-content-primary sm:text-3xl">
                Off-Price Analytics
              </h1>
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                  dataSource === 'live'
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                    : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                }`}
              >
                {analyticsSourceBadgeLabel(dataSource)}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-content-muted">
              {PERIODS.find((p) => p.id === period)?.description}
            </p>
            {archiveStatus && (
              <p className="mt-2 text-xs text-gray-500 dark:text-content-muted">{archiveStatus}</p>
            )}
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            {livePreviewToggle}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={openDownloadModal}
                disabled={downloading || emailSending}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2e2e2e] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"
                  />
                </svg>
                {downloading ? 'Preparing…' : 'Download Excel'}
              </button>
              <button
                type="button"
                onClick={openEmailModal}
                disabled={downloading || emailSending}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#3b9dd0] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f8bbc] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#3b9dd0] dark:hover:bg-[#4aadde]"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                {emailSending ? 'Sending…' : 'Email Report'}
              </button>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-sm font-medium text-gray-900 dark:text-content-primary">
                {showingHistoricalYear && selectedYearArchive
                  ? selectedYearArchive.period_label
                  : data.period_labels[period]}
              </p>
              <p className="text-xs text-gray-500 dark:text-content-muted">
                {showingHistoricalYear && selectedYearArchive
                  ? selectedYearArchive.period_range
                  : data.period_ranges[period]}
              </p>
            </div>
          </div>
        </div>

        {period === 'yearly' && (
          <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto lg:hidden">
            {data.historical_years.map((y) => (
              <button
                key={y.year}
                type="button"
                onClick={() => setYear(y.year)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  selectedYear === y.year
                    ? 'border-[#404040] bg-[#404040] text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                    : 'border-gray-200 bg-white text-gray-700 dark:border-border dark:bg-surface dark:text-content-secondary'
                }`}
              >
                {y.period_label}
              </button>
            ))}
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-content-primary">
                My analytics tracking
              </h3>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-content-muted">
                Personal to {userLabel} · {trackedVendorCount}/{vendorCodes.length || trackedVendorCount} vendors tracking
                {trackingSource === 'local' ? ' · saved on this device' : ' · saved to your account'}
                {!showTrackingPanel ? ' · open to start or stop per vendor' : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowTrackingPanel((open) => !open)}
              aria-expanded={showTrackingPanel}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#3b9dd0] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f8bbc] dark:bg-[#3b9dd0] dark:hover:bg-[#4aadde]"
            >
              <svg
                className={`h-4 w-4 shrink-0 transition-transform ${showTrackingPanel ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              {showTrackingPanel ? 'Hide vendor toggles' : 'Manage vendor tracking'}
            </button>
          </div>

          {showTrackingPanel && (
            <>
              <div className="border-t border-gray-200 px-5 py-3 dark:border-border">
                <p className="text-xs text-gray-500 dark:text-content-muted">
                  These toggles are yours alone — other users keep their own preferences. Stopping a
                  vendor pauses it for your future downloads only; shared historical archives stay.
                </p>
              </div>
              <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-border dark:border-border">
                {data.vendors.map((vendor) => {
                  const on = tracking[vendor.code] !== false
                  return (
                    <div
                      key={vendor.code}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-content-primary">
                          {vendor.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-content-muted">
                          {on
                            ? 'Tracking on — included in period totals & archives'
                            : 'Tracking stopped — excluded from new analytics'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`text-xs font-medium ${
                            on
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-gray-400 dark:text-content-muted'
                          }`}
                        >
                          {on ? 'On' : 'Off'}
                        </span>
                        <TrackingSwitch
                          enabled={on}
                          busy={trackingBusy === vendor.code}
                          label={`${on ? 'Stop' : 'Start'} analytics tracking for ${vendor.name}`}
                          onChange={(next) => handleToggleTracking(vendor.code, next)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {showDownloadModal &&
          createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="download-analytics-title"
            onClick={() => !downloading && setShowDownloadModal(false)}
          >
            <div
              className="w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-surface"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-gray-200 px-5 py-4 dark:border-border">
                <h2
                  id="download-analytics-title"
                  className="text-lg font-semibold text-gray-900 dark:text-content-primary"
                >
                  Download Excel
                </h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-content-muted">
                  Choose vendors for your personal export. This is logged with your name and the date.
                </p>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto px-5 py-3">
                <div className="mb-2 flex gap-2">
                  <button
                    type="button"
                    className="text-xs font-medium text-gray-600 underline dark:text-content-secondary"
                    onClick={() =>
                      setDownloadSelection(Object.fromEntries(vendorCodes.map((c) => [c, true])))
                    }
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-xs font-medium text-gray-600 underline dark:text-content-secondary"
                    onClick={() =>
                      setDownloadSelection(Object.fromEntries(vendorCodes.map((c) => [c, false])))
                    }
                  >
                    Clear
                  </button>
                </div>
                {data.vendors.map((vendor) => (
                  <label
                    key={vendor.code}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50 dark:hover:bg-surface-hover"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(downloadSelection[vendor.code])}
                      onChange={(e) =>
                        setDownloadSelection((prev) => ({
                          ...prev,
                          [vendor.code]: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-gray-300 text-[#404040] focus:ring-[#404040]"
                    />
                    <span className="text-sm text-gray-900 dark:text-content-primary">
                      {vendor.name}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-border">
                <button
                  type="button"
                  disabled={downloading}
                  onClick={() => setShowDownloadModal(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-border dark:text-content-secondary dark:hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={downloading || selectedDownloadCodes.length === 0}
                  onClick={() => void handleConfirmDownload()}
                  className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2e2e2e] disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900"
                >
                  {downloading
                    ? 'Downloading…'
                    : selectedDownloadCodes.length >= vendorCodes.length
                      ? 'Download all vendors'
                      : selectedDownloadCodes.length === 1
                        ? `Download ${selectedDownloadCodes[0].toUpperCase()}`
                        : `Download ${selectedDownloadCodes.length} vendors`}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

        {showEmailModal &&
          createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="email-analytics-title"
            onClick={() => !emailSending && setShowEmailModal(false)}
          >
            <div
              className="flex h-[min(90vh,44rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-surface"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 border-b border-gray-200 px-5 py-4 dark:border-border">
                <h2
                  id="email-analytics-title"
                  className="text-lg font-semibold text-gray-900 dark:text-content-primary"
                >
                  Email Report
                </h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-content-muted">
                  Choose vendors, report ranges, and recipients. Uses Analytics email only — does not
                  affect Daily Run or Express Job emails.
                </p>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-content-muted">
                    Vendors
                  </p>
                  <div className="mb-2 flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-gray-600 underline dark:text-content-secondary"
                      onClick={() =>
                        setEmailSelection(Object.fromEntries(vendorCodes.map((c) => [c, true])))
                      }
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-gray-600 underline dark:text-content-secondary"
                      onClick={() =>
                        setEmailSelection(Object.fromEntries(vendorCodes.map((c) => [c, false])))
                      }
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-100 p-2 dark:border-border">
                    {data.vendors.map((vendor) => (
                      <label
                        key={vendor.code}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-surface-hover"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(emailSelection[vendor.code])}
                          onChange={(e) =>
                            setEmailSelection((prev) => ({
                              ...prev,
                              [vendor.code]: e.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border-gray-300 text-[#3b9dd0] focus:ring-[#3b9dd0]"
                        />
                        <span className="text-sm text-gray-900 dark:text-content-primary">
                          {vendor.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-content-muted">
                    Report ranges
                  </p>
                  <div className="space-y-2 rounded-lg border border-gray-100 p-3 dark:border-border">
                    {(
                      [
                        ['daily', 'Daily'],
                        ['weekly', 'Weekly'],
                        ['monthly', 'Monthly'],
                        ['yearly', 'Yearly'],
                      ] as const
                    ).map(([id, label]) => (
                      <label
                        key={id}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1 hover:bg-gray-50 dark:hover:bg-surface-hover"
                      >
                        <input
                          type="checkbox"
                          checked={emailPeriods[id]}
                          onChange={(e) =>
                            setEmailPeriods((prev) => ({
                              ...prev,
                              [id]: e.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border-gray-300 text-[#3b9dd0] focus:ring-[#3b9dd0]"
                        />
                        <span className="min-w-0 flex-1 text-sm text-gray-900 dark:text-content-primary">
                          {label}
                        </span>
                        <span className="truncate text-xs text-gray-500 dark:text-content-muted">
                          {data.period_ranges[id]}
                        </span>
                      </label>
                    ))}
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-1 py-1 hover:bg-gray-50 dark:hover:bg-surface-hover">
                      <input
                        type="checkbox"
                        checked={emailIncludeHistorical}
                        onChange={(e) => setEmailIncludeHistorical(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#3b9dd0] focus:ring-[#3b9dd0]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-gray-900 dark:text-content-primary">
                          Historical years
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-content-muted">
                          Enter years separated by commas
                          {data.historical_years.length
                            ? ` (e.g. ${data.historical_years
                                .slice(0, 3)
                                .map((y) => y.year)
                                .join(', ')})`
                            : ''}
                        </span>
                      </span>
                    </label>
                    {emailIncludeHistorical && (
                      <div className="pl-7">
                        <input
                          type="text"
                          value={emailHistoricalYearsInput}
                          onChange={(e) => setEmailHistoricalYearsInput(e.target.value)}
                          placeholder="2024, 2025, 2026"
                          disabled={emailSending}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#3b9dd0] focus:outline-none focus:ring-2 focus:ring-[#3b9dd0]/30 disabled:opacity-50 dark:border-border dark:bg-surface dark:text-content-primary"
                        />
                        {parsedEmailHistoricalYears.years.length > 0 && (
                          <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                            Including {parsedEmailHistoricalYears.years.join(', ')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-content-muted">
                    Recipients
                  </p>
                  <EmailRecipientsPicker
                    value={emailRecipients}
                    bccValue={emailBccRecipients}
                    onChange={setEmailRecipients}
                    onBccChange={setEmailBccRecipients}
                    emptyMeansNoRecipients
                    allowVendorBcc
                    disabled={emailSending}
                    panelMaxHeightClass="max-h-56"
                  />
                </div>
                {emailStatus && (
                  <p
                    className={`text-sm ${
                      emailStatus.startsWith('Sent')
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    {emailStatus}
                  </p>
                )}
              </div>
              <div className="relative z-20 flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-white px-5 py-4 dark:border-border dark:bg-surface">
                <button
                  type="button"
                  disabled={emailSending}
                  onClick={() => setShowEmailModal(false)}
                  className="relative z-20 rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-border dark:text-content-secondary dark:hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    emailSending ||
                    selectedEmailCodes.length === 0 ||
                    !emailHasReportRanges ||
                    (!emailRecipients.trim() && !emailBccRecipients.trim())
                  }
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleConfirmEmail()
                  }}
                  className="relative z-20 rounded-lg bg-[#3b9dd0] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2f8bbc] disabled:opacity-50"
                >
                  {emailSending ? 'Sending…' : 'Send email'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

        {showingHistoricalYear && selectedYearArchive ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="card p-4 sm:p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                  Off-price hits
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-content-primary sm:text-3xl">
                  {selectedYearArchive.total_off_price_count.toLocaleString()}
                </p>
              </div>
              <div className="card p-4 sm:p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                  Distinct sellers
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-content-primary sm:text-3xl">
                  {selectedYearArchive.distinct_sellers.toLocaleString()}
                </p>
              </div>
              <div className="card p-4 sm:p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                  Vendors with hits
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-content-primary sm:text-3xl">
                  {selectedYearArchive.vendors_with_hits}
                  <span className="text-base font-normal text-gray-400">
                    {' '}
                    / {selectedYearArchive.vendors.length || vendorCodes.length}
                  </span>
                </p>
              </div>
              <div className="card p-4 sm:p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                  Daily runs
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-content-primary sm:text-3xl">
                  {selectedYearArchive.total_run_count.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="card p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-content-primary">
                  Hits by vendor — {selectedYearArchive.year}
                </h3>
                <p className="mb-3 text-xs text-gray-500 dark:text-content-muted">
                  Archived yearly off-price volume
                </p>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={archiveVendorChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis dataKey="code" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={48} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value: number) => [value.toLocaleString(), 'Hits']}
                        labelFormatter={(_, payload) =>
                          String(payload?.[0]?.payload?.name || '')
                        }
                      />
                      <Bar dataKey="hits" radius={[6, 6, 0, 0]}>
                        {archiveVendorChartData.map((_, idx) => (
                          <Cell
                            key={`archive-bar-${idx}`}
                            fill={VENDOR_BAR_COLORS[idx % VENDOR_BAR_COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-content-primary">
                  Historical trend
                </h3>
                <p className="mb-3 text-xs text-gray-500 dark:text-content-muted">
                  Last {historicalTrendData.length} years of total off-price hits
                </p>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historicalTrendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis dataKey="year" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} width={48} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value: number, name: string) => [
                          value.toLocaleString(),
                          name === 'hits' ? 'Hits' : 'Runs',
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="hits"
                        stroke={CHART_BLUE}
                        strokeWidth={2.5}
                        dot={{ r: 2, fill: CHART_BLUE }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="border-b border-gray-200 px-5 py-3 dark:border-border">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-content-primary">
                  Archived year {selectedYearArchive.year} — by vendor
                </h3>
                <p className="text-xs text-gray-500 dark:text-content-muted">
                  Stored for historical download · not removed when daily alerts age out
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-border">
                  <thead className="bg-gray-50 dark:bg-surface-muted">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                        Vendor
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                        Status
                      </th>
                      <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                        Hits
                      </th>
                      <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                        Share
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                        Top sellers
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white dark:divide-border dark:bg-surface">
                    {selectedYearArchive.vendors.map((v) => (
                      <tr key={v.code} className="hover:bg-gray-50 dark:hover:bg-surface-hover">
                        <td className="px-5 py-3 text-sm font-medium text-gray-900 dark:text-content-primary">
                          {v.name}
                        </td>
                        <td className="px-5 py-3 text-sm">
                          <span
                            className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                              v.scheduler_enabled
                                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : 'bg-gray-100 text-gray-600 dark:bg-surface-muted dark:text-content-muted'
                            }`}
                          >
                            {v.scheduler_enabled ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-content-primary">
                          {v.off_price_count.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <ShareBar pct={v.pct_of_total} />
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500 dark:text-content-muted">
                          {v.sellers
                            .slice(0, 3)
                            .map((s) => `${s.seller_name} (${s.hits})`)
                            .join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="card p-4 sm:p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                  Off-price hits
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-content-primary sm:text-3xl">
                  {totals.off_price_count.toLocaleString()}
                </p>
              </div>
              <div className="card p-4 sm:p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                  Distinct sellers
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-content-primary sm:text-3xl">
                  {totals.distinct_sellers.toLocaleString()}
                </p>
              </div>
              <div className="card p-4 sm:p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                  Vendors with hits
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-content-primary sm:text-3xl">
                  {totals.vendors_with_hits}
                  <span className="text-base font-normal text-gray-400">
                    {' '}
                    / {vendorCodes.length}
                  </span>
                </p>
              </div>
              <div className="card p-4 sm:p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">
                  Daily runs
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-content-primary sm:text-3xl">
                  {totals.run_count.toLocaleString()}
                </p>
              </div>
            </div>

            {topSellerForPeriod && (
              <div className="flex flex-col gap-1 rounded-xl border border-[#F7E58C] bg-[#F7E58C] p-4 text-[#111827] shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-[#111827]/70">
                    Top off-price seller ({period})
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[#111827]">
                    {topSellerForPeriod.seller_name}
                  </p>
                  <p className="text-xs text-[#111827]/70">
                    Seen on {topSellerForPeriod.vendor_codes.map((c) => c.toUpperCase()).join(', ')}
                  </p>
                </div>
                <div className="mt-2 flex gap-6 sm:mt-0 sm:text-right">
                  <div>
                    <p className="text-[11px] uppercase text-[#111827]/65">Hits</p>
                    <p className="text-xl font-bold tabular-nums text-[#111827]">
                      {sellerHitsOverall(topSellerForPeriod, period).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase text-[#111827]/65">Share</p>
                    <p className="text-xl font-bold tabular-nums text-[#111827]">
                      {(
                        (sellerHitsOverall(topSellerForPeriod, period) /
                          Math.max(1, totals.off_price_count)) *
                        100
                      ).toFixed(1)}
                      %
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="card p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-content-primary">
                  Hits by vendor — {period}
                </h3>
                <p className="mb-3 text-xs text-gray-500 dark:text-content-muted">
                  Off-price volume for the selected period
                </p>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={vendorChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis dataKey="code" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={48} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value: number, _name, item) => [
                          value.toLocaleString(),
                          item?.payload?.tracking === false ? 'Hits (tracking off)' : 'Hits',
                        ]}
                        labelFormatter={(_, payload) =>
                          String(payload?.[0]?.payload?.name || '')
                        }
                      />
                      <Bar dataKey="hits" radius={[6, 6, 0, 0]}>
                        {vendorChartData.map((row, idx) => (
                          <Cell
                            key={`vendor-bar-${row.code}`}
                            fill={
                              row.tracking === false
                                ? '#d1d5db'
                                : VENDOR_BAR_COLORS[idx % VENDOR_BAR_COLORS.length]
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-content-primary">
                  Top sellers — {period}
                </h3>
                <p className="mb-3 text-xs text-gray-500 dark:text-content-muted">
                  Highest hit counts across all vendors
                </p>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={topSellersChartData}
                      margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={110}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value: number) => [value.toLocaleString(), 'Hits']}
                        labelFormatter={(_, payload) =>
                          String(payload?.[0]?.payload?.fullName || '')
                        }
                      />
                      <Bar dataKey="hits" fill={CHART_PINK} radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {period === 'yearly' && historicalTrendData.length > 1 && (
              <div className="card p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-content-primary">
                  Historical trend
                </h3>
                <p className="mb-3 text-xs text-gray-500 dark:text-content-muted">
                  Last {historicalTrendData.length} years of total off-price hits
                </p>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historicalTrendData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis dataKey="year" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} width={48} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value: number) => [value.toLocaleString(), 'Hits']}
                      />
                      <Line
                        type="monotone"
                        dataKey="hits"
                        stroke={CHART_BLUE}
                        strokeWidth={2.5}
                        dot={{ r: 2.5, fill: CHART_BLUE }}
                        activeDot={{ r: 5, fill: CHART_YELLOW, stroke: CHART_BLUE }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {period === 'monthly' && monthlyTrendData.length > 1 && (
              <div className="card p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-content-primary">
                  Monthly trend
                </h3>
                <p className="mb-3 text-xs text-gray-500 dark:text-content-muted">
                  Last {monthlyTrendData.length} months of total off-price hits
                </p>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyTrendData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 10 }}
                        interval="preserveStartEnd"
                        minTickGap={28}
                      />
                      <YAxis tick={{ fontSize: 11 }} width={48} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value: number) => [value.toLocaleString(), 'Hits']}
                      />
                      <Line
                        type="monotone"
                        dataKey="hits"
                        stroke={CHART_BLUE}
                        strokeWidth={2.5}
                        dot={{ r: 2.5, fill: CHART_BLUE }}
                        activeDot={{ r: 5, fill: CHART_YELLOW, stroke: CHART_BLUE }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="card overflow-hidden">
              <div className="border-b border-gray-200 px-5 py-3 dark:border-border">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-content-primary">
                  Vendors — {period} view
                </h3>
                <p className="text-xs text-gray-500 dark:text-content-muted">
                  Expand a vendor for sellers with daily / weekly / monthly / yearly hits and share %
                </p>
              </div>

              <div className="divide-y divide-gray-200 dark:divide-border">
                {sortedVendors.map((vendor) => {
                  const stats = vendorStatsForPeriod(vendor, period)
                  const change = formatChange(stats.change_vs_prior_pct)
                  const open = expandedVendor === vendor.code
                  const trackingOn = tracking[vendor.code] !== false
                  const sellerTotal = vendor.sellers.reduce(
                    (sum, s) => sum + sellerHitsForPeriod(s, period),
                    0,
                  )

                  return (
                    <div
                      key={vendor.code}
                      className={!trackingOn ? 'bg-gray-50/70 opacity-70 dark:bg-surface-muted/30' : undefined}
                    >
                      <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
                        <button
                          type="button"
                          onClick={() => setExpandedVendor(open ? null : vendor.code)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-90"
                        >
                          <svg
                            className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                to={`/daily-run/${vendor.code}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-sm font-semibold text-gray-900 hover:underline dark:text-content-primary"
                              >
                                {vendor.name}
                              </Link>
                              <span
                                className={`inline-flex rounded px-2 py-0.5 text-[11px] font-medium ${
                                  vendor.scheduler_enabled
                                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                                    : 'bg-gray-100 text-gray-600 dark:bg-surface-muted dark:text-content-muted'
                                }`}
                              >
                                Scheduler {vendor.scheduler_enabled ? 'active' : 'inactive'}
                              </span>
                              <span
                                className={`inline-flex rounded px-2 py-0.5 text-[11px] font-medium ${
                                  trackingOn
                                    ? 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
                                    : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                                }`}
                              >
                                Tracking {trackingOn ? 'on' : 'off'}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-gray-500 dark:text-content-muted">
                              {trackingOn ? (
                                <>
                                  {stats.run_count} run{stats.run_count === 1 ? '' : 's'} · vs prior{' '}
                                  <span className={change.className}>{change.text}</span>
                                </>
                              ) : (
                                'Paused — not included in new analytics totals'
                              )}
                            </p>
                          </div>

                          <div className="hidden sm:block">
                            <ShareBar pct={trackingOn ? stats.pct_of_total : 0} />
                          </div>

                          <div className="text-right">
                            <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-content-primary">
                              {trackingOn ? stats.off_price_count.toLocaleString() : '—'}
                            </p>
                          </div>
                        </button>
                      </div>

                      {open && trackingOn && (
                        <div className="border-t border-gray-100 bg-gray-50/80 px-3 py-3 dark:border-border dark:bg-surface-muted/40 sm:px-5">
                          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                            {(
                              [
                                ['Daily', vendor.daily],
                                ['Weekly', vendor.weekly],
                                ['Monthly', vendor.monthly],
                                ['Yearly', vendor.yearly],
                              ] as const
                            ).map(([label, p]) => (
                              <div
                                key={label}
                                className={`rounded-lg border bg-white p-3 dark:border-border dark:bg-surface ${
                                  label.toLowerCase() === period
                                    ? 'border-[#404040] ring-1 ring-[#404040]/20 dark:border-slate-300'
                                    : 'border-gray-200'
                                }`}
                              >
                                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                                  {label}
                                </p>
                                <p className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-content-primary">
                                  {p.off_price_count.toLocaleString()}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-content-muted">
                                  {p.pct_of_total.toFixed(1)}% · {formatChange(p.change_vs_prior_pct).text}
                                </p>
                              </div>
                            ))}
                          </div>

                          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-border dark:bg-surface">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-border">
                              <thead className="bg-gray-50 dark:bg-surface-muted">
                                <tr>
                                  <th className="px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted sm:px-4">
                                    Off-price seller
                                  </th>
                                  <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted sm:px-4">
                                    Daily
                                  </th>
                                  <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted sm:px-4">
                                    Weekly
                                  </th>
                                  <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted sm:px-4">
                                    Monthly
                                  </th>
                                  <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted sm:px-4">
                                    Yearly
                                  </th>
                                  <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted sm:px-4">
                                    Share*
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-border">
                                {vendor.sellers.map((seller) => {
                                  const periodHits = sellerHitsForPeriod(seller, period)
                                  const share =
                                    sellerTotal > 0
                                      ? Math.round((periodHits / sellerTotal) * 1000) / 10
                                      : 0
                                  return (
                                    <tr
                                      key={seller.seller_name}
                                      className={
                                        periodHits === 0
                                          ? 'opacity-45'
                                          : 'hover:bg-gray-50 dark:hover:bg-surface-hover'
                                      }
                                    >
                                      <td className="whitespace-nowrap px-3 py-2.5 text-sm font-medium text-gray-900 dark:text-content-primary sm:px-4">
                                        {seller.seller_name}
                                      </td>
                                      <td className={`px-3 py-2.5 text-right text-sm tabular-nums sm:px-4 ${period === 'daily' ? 'font-semibold' : 'text-gray-600 dark:text-content-secondary'}`}>
                                        {seller.daily_hits.toLocaleString()}
                                      </td>
                                      <td className={`px-3 py-2.5 text-right text-sm tabular-nums sm:px-4 ${period === 'weekly' ? 'font-semibold' : 'text-gray-600 dark:text-content-secondary'}`}>
                                        {seller.weekly_hits.toLocaleString()}
                                      </td>
                                      <td className={`px-3 py-2.5 text-right text-sm tabular-nums sm:px-4 ${period === 'monthly' ? 'font-semibold' : 'text-gray-600 dark:text-content-secondary'}`}>
                                        {seller.monthly_hits.toLocaleString()}
                                      </td>
                                      <td className={`px-3 py-2.5 text-right text-sm tabular-nums sm:px-4 ${period === 'yearly' ? 'font-semibold' : 'text-gray-600 dark:text-content-secondary'}`}>
                                        {seller.yearly_hits.toLocaleString()}
                                      </td>
                                      <td className="px-3 py-2.5 text-right text-sm font-medium tabular-nums sm:px-4">
                                        {share.toFixed(1)}%
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                            <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400 dark:border-border dark:text-content-muted">
                              * Share = seller’s hits ÷ this vendor’s {period} total
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="border-b border-gray-200 px-5 py-3 dark:border-border">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-content-primary">
                  Top sellers across all vendors
                </h3>
                <p className="text-xs text-gray-500 dark:text-content-muted">
                  Ranked by yearly hits — daily / weekly / monthly shown for context
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-border">
                  <thead className="bg-gray-50 dark:bg-surface-muted">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">#</th>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">Seller</th>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">Vendors</th>
                      <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">Daily</th>
                      <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">Weekly</th>
                      <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">Monthly</th>
                      <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">Yearly</th>
                      <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-content-muted">Yearly %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white dark:divide-border dark:bg-surface">
                    {data.top_sellers_overall.map((seller, idx) => (
                      <tr key={seller.seller_name} className="hover:bg-gray-50 dark:hover:bg-surface-hover">
                        <td className="px-5 py-3 text-sm tabular-nums text-gray-400">{idx + 1}</td>
                        <td className="px-5 py-3 text-sm font-medium text-gray-900 dark:text-content-primary">
                          {seller.seller_name}
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500 dark:text-content-muted">
                          {seller.vendor_codes.map((c) => c.toUpperCase()).join(', ')}
                        </td>
                        <td className="px-5 py-3 text-right text-sm tabular-nums text-gray-700 dark:text-content-secondary">
                          {seller.daily_hits.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-right text-sm tabular-nums text-gray-700 dark:text-content-secondary">
                          {seller.weekly_hits.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-right text-sm tabular-nums text-gray-700 dark:text-content-secondary">
                          {seller.monthly_hits.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-content-primary">
                          {seller.yearly_hits.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <ShareBar pct={seller.pct_of_yearly_total} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <div className="card overflow-hidden">
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-content-primary">
                Download log
              </h3>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-content-muted">
                Who downloaded which vendor report and when
                {downloadLogs.length ? ` · ${downloadLogs.length} recent` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDownloadLogs((open) => !open)}
              aria-expanded={showDownloadLogs}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#3b9dd0] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f8bbc] dark:bg-[#3b9dd0] dark:hover:bg-[#4aadde]"
            >
              {showDownloadLogs ? 'Hide log' : 'View download log'}
            </button>
          </div>
          {showDownloadLogs && (
            <div className="border-t border-gray-200 dark:border-border">
              {downloadLogs.length === 0 ? (
                <p className="px-5 py-6 text-sm text-gray-500 dark:text-content-muted">
                  No downloads recorded yet.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-border">
                  {downloadLogs.slice(0, 25).map((log, idx) => (
                    <li key={`${log.downloaded_at}-${idx}`} className="px-5 py-3">
                      <p className="text-sm text-gray-900 dark:text-content-primary">
                        <span className="font-semibold">
                          {log.user_display_name || log.user_email || 'Someone'}
                        </span>{' '}
                        downloaded a report for{' '}
                        <span className="font-medium">{log.vendor_label}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-content-muted">
                        {formatLogWhen(log.downloaded_at)}
                        {log.filename ? ` · ${log.filename}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-gray-400 dark:text-content-muted">
          {data.demo_label} · {data.historical_years.length} historical years (
          {data.historical_years[data.historical_years.length - 1]?.year}–
          {data.historical_years[0]?.year}) · Download Excel includes every archived year
        </p>
      </div>
    </div>
  )
}
