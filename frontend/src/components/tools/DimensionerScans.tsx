import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { dimensionerApi, getApiBaseUrl, type DimensionerScan } from '../../services/api'
import { useUser } from '../../contexts/UserContext'
import { canAccessFreightClassCalculator } from '../../lib/freightClassAccess'
import {
  buildHandoffState,
  canSendToFreightClass,
  toHandoffRows,
} from '../../lib/dimensionerHandoff'
import { getApiErrorDetail } from '../../utils/apiErrorMessage'

const REFRESH_MS = 10_000
const PAGE_SIZE = 100
const SEARCH_DEBOUNCE_MS = 300
const DEFAULT_RECEIVE_PATH = '/api/v1/dimensioner/new-entry'

function formatInches(value: number | null): string {
  return value == null ? '—' : value.toFixed(2)
}

function formatPounds(value: number | null): string {
  return value == null ? '—' : value.toFixed(2)
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

function millimetreTitle(scan: DimensionerScan): string {
  const parts = [scan.length_mm, scan.width_mm, scan.height_mm]
  const size = parts.every((part) => part != null) ? `${parts.join(' × ')} mm` : 'size not captured'
  return scan.weight_g != null ? `${size}, ${scan.weight_g} g` : size
}

function detailLine(scan: DimensionerScan): string {
  const attributes = Object.entries(scan.attributes || {})
    .map(([key, value]) => (value ? `${key}: ${value}` : key))
    .join(', ')
  return [scan.note, attributes].filter(Boolean).join(' · ')
}

function receivedMs(scan: DimensionerScan): number {
  const ms = scan.received_at ? Date.parse(scan.received_at) : NaN
  return Number.isNaN(ms) ? 0 : ms
}

function RulerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 17l14-14 4 4L7 21l-4-4zm4-2l2 2m1-5l2 2m1-5l2 2"
      />
    </svg>
  )
}

export default function DimensionerScans() {
  const navigate = useNavigate()
  const { isSuperadmin, userInfoLoading, userInfo, authUser } = useUser()
  const canUse = canAccessFreightClassCalculator(userInfo?.email || authUser?.email, isSuperadmin)
  const enabled = canUse && !userInfoLoading

  const [scans, setScans] = useState<DimensionerScan[]>([])
  const [receiverConfigured, setReceiverConfigured] = useState(true)
  const [receivePath, setReceivePath] = useState(DEFAULT_RECEIVE_PATH)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showSetup, setShowSetup] = useState(false)
  const [copied, setCopied] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const requestSeq = useRef(0)
  const inFlight = useRef(0)
  // Newest scan time seen on the first load; anything later arrived while this page was open.
  const baselineRef = useRef<{ ready: boolean; newest: number }>({ ready: false, newest: 0 })

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(async () => {
    const mine = ++requestSeq.current
    inFlight.current += 1
    setRefreshing(true)
    try {
      const data = await dimensionerApi.listScans({
        limit: PAGE_SIZE,
        search: search || undefined,
      })
      // A newer request (for example a changed search) has started; drop this answer.
      if (mine !== requestSeq.current) return
      // Only an unfiltered list can say what was already there when the page opened.
      if (!baselineRef.current.ready && !search) {
        baselineRef.current = {
          ready: true,
          newest: data.scans.reduce((max, scan) => Math.max(max, receivedMs(scan)), 0),
        }
      }
      setScans(data.scans)
      setReceiverConfigured(data.receiver_configured)
      setReceivePath(data.receive_path || DEFAULT_RECEIVE_PATH)
      setError(null)
      setLastUpdated(new Date())
      setSelected((previous) => {
        const present = new Set(data.scans.map((scan) => scan.id))
        const kept = new Set([...previous].filter((id) => present.has(id)))
        return kept.size === previous.size ? previous : kept
      })
    } catch (err) {
      if (mine !== requestSeq.current) return
      setError(getApiErrorDetail(err) || 'Could not load scans. Check your connection and try again.')
    } finally {
      inFlight.current -= 1
      if (inFlight.current === 0) setRefreshing(false)
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    if (!enabled) return
    void load()
  }, [enabled, load])

  // Keep the list live while the tab is in front, and catch up when it comes back.
  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      if (document.visibilityState === 'visible' && inFlight.current === 0) void load()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const timer = window.setInterval(tick, REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, load])

  const sendableScans = useMemo(() => scans.filter(canSendToFreightClass), [scans])
  const allSendableSelected =
    sendableScans.length > 0 && sendableScans.every((scan) => selected.has(scan.id))
  const selectedCount = selected.size
  const endpointUrl = `${getApiBaseUrl()}${receivePath}`

  const toggleOne = useCallback((scanId: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(scanId)) next.delete(scanId)
      else next.add(scanId)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected(allSendableSelected ? new Set() : new Set(sendableScans.map((scan) => scan.id)))
  }, [allSendableSelected, sendableScans])

  const sendToFreightClass = useCallback(
    (chosen: DimensionerScan[]) => {
      // Oldest first, so pallets land in the calculator in the order they were measured.
      const ordered = [...chosen].sort((a, b) => receivedMs(a) - receivedMs(b))
      const rows = toHandoffRows(ordered)
      if (rows.length === 0) return
      navigate('/freight-class-calculator', { state: buildHandoffState(rows) })
    },
    [navigate],
  )

  const sendSelected = useCallback(() => {
    sendToFreightClass(scans.filter((scan) => selected.has(scan.id)))
  }, [scans, selected, sendToFreightClass])

  const deleteScan = useCallback(
    async (scan: DimensionerScan) => {
      const label = scan.barcode ? `the scan for ${scan.barcode}` : 'this scan'
      if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return
      setDeletingId(scan.id)
      try {
        await dimensionerApi.deleteScan(scan.id)
        setScans((previous) => previous.filter((row) => row.id !== scan.id))
        setSelected((previous) => {
          if (!previous.has(scan.id)) return previous
          const next = new Set(previous)
          next.delete(scan.id)
          return next
        })
        setError(null)
      } catch (err) {
        setError(getApiErrorDetail(err) || 'Could not delete the scan.')
      } finally {
        setDeletingId(null)
      }
    },
    [],
  )

  const copyEndpoint = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(endpointUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy to the clipboard. Select the address and copy it by hand.')
    }
  }, [endpointUrl])

  if (userInfoLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#404040] border-t-transparent" />
      </div>
    )
  }

  if (!canUse) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        The Dimensioner is not available for this account.
      </div>
    )
  }

  const newestKnown = baselineRef.current.newest
  const isNew = (scan: DimensionerScan) =>
    baselineRef.current.ready && receivedMs(scan) > newestKnown

  return (
    <div className="mx-auto max-w-5xl px-1 pb-16 pt-2">
      <header className="mb-6">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#404040]/12 text-[#404040] dark:bg-white/12 dark:text-white">
            <RulerIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 sm:text-2xl">
              Dimensioner
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              Measurements from the QBOID M2 · inches and pounds
            </p>
          </div>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
        >
          {error}
        </div>
      )}

      {!receiverConfigured && (
        <div
          role="status"
          className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
        >
          The M2 receiver is not switched on yet, so uploads from the device are being refused. An
          admin needs to set <span className="font-mono">DIMENSIONER_API_KEY</span> on the server.
        </div>
      )}

      <div className="rounded-2xl border border-gray-300 bg-white shadow-md dark:border-gray-600 dark:bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search barcode"
            aria-label="Search barcode"
            className="w-full min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-[#81B81D] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#81B81D]/25 dark:border-gray-600 dark:bg-gray-800/60 dark:text-gray-100 sm:w-auto sm:max-w-xs"
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString()} · refreshes every ${REFRESH_MS / 1000}s`
              : 'Loading…'}
          </span>
          <button
            type="button"
            onClick={sendSelected}
            disabled={selectedCount === 0}
            className="ml-auto inline-flex items-center justify-center rounded-xl bg-[#81B81D] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#6fa019] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {selectedCount > 0
              ? `Send ${selectedCount} to Freight Class`
              : 'Select scans to send to Freight Class'}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#404040] border-t-transparent" />
          </div>
        ) : scans.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-gray-600 dark:text-gray-400">
            {search ? (
              <>No scans match “{search}”.</>
            ) : (
              <>
                <p className="font-medium text-gray-800 dark:text-gray-200">No scans yet.</p>
                <p className="mt-1">
                  Measure something with the M2 and tap Save. It shows up here within a few seconds.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-gray-600 dark:bg-gray-800/50 dark:text-gray-400">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSendableSelected}
                      onChange={toggleAll}
                      disabled={sendableScans.length === 0}
                      aria-label="Select all scans that can be sent"
                      className="h-4 w-4 rounded border-gray-300 accent-[#81B81D]"
                    />
                  </th>
                  <th className="px-3 py-3">Received</th>
                  <th className="px-3 py-3">Barcode</th>
                  <th className="px-3 py-3 text-right">Length</th>
                  <th className="px-3 py-3 text-right">Width</th>
                  <th className="px-3 py-3 text-right">Height</th>
                  <th className="px-3 py-3 text-right">Weight (lb)</th>
                  <th className="px-3 py-3">Shape</th>
                  <th className="px-3 py-3">Device</th>
                  <th className="px-3 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {scans.map((scan) => {
                  const sendable = canSendToFreightClass(scan)
                  const extra = detailLine(scan)
                  return (
                    <tr
                      key={scan.id}
                      className={`text-gray-900 dark:text-gray-100 ${
                        selected.has(scan.id) ? 'bg-[#81B81D]/[0.07]' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(scan.id)}
                          onChange={() => toggleOne(scan.id)}
                          disabled={!sendable}
                          aria-label={`Select scan ${scan.barcode || scan.id}`}
                          title={sendable ? undefined : 'No size was captured for this scan'}
                          className="h-4 w-4 rounded border-gray-300 accent-[#81B81D]"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-700 dark:text-gray-300">
                        {formatWhen(scan.received_at)}
                        {isNew(scan) && (
                          <span className="ml-2 rounded-full bg-[#81B81D]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#4d7010] dark:text-[#a6d94a]">
                            New
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium">{scan.barcode || '—'}</div>
                        {extra && (
                          <div className="mt-0.5 max-w-xs truncate text-xs text-gray-500 dark:text-gray-400" title={extra}>
                            {extra}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums" title={millimetreTitle(scan)}>
                        {formatInches(scan.length_in)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums" title={millimetreTitle(scan)}>
                        {formatInches(scan.width_in)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums" title={millimetreTitle(scan)}>
                        {formatInches(scan.height_in)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatPounds(scan.weight_lb)}</td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{scan.shape || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">
                        {scan.device || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => sendToFreightClass([scan])}
                          disabled={!sendable}
                          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#4d7010] transition-colors hover:bg-[#81B81D]/15 disabled:cursor-not-allowed disabled:opacity-40 dark:text-[#a6d94a]"
                        >
                          Use in Freight Class
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteScan(scan)}
                          disabled={deletingId === scan.id}
                          className="ml-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-red-950/30"
                          aria-label={`Delete scan ${scan.barcode || scan.id}`}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowSetup((value) => !value)}
          aria-expanded={showSetup}
          className="flex w-full items-center justify-between rounded-xl border border-gray-300 bg-gray-100 px-4 py-3 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100/80 dark:border-gray-600 dark:bg-gray-800/50 dark:text-gray-300"
        >
          <span>Set up the M2</span>
          <svg
            className={`h-4 w-4 transition-transform ${showSetup ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showSetup && (
          <div className="mt-2 space-y-4 rounded-xl border border-gray-300 bg-white p-5 text-sm text-gray-700 dark:border-gray-600 dark:bg-surface dark:text-gray-300">
            <p>
              Do this once on each M2, under{' '}
              <span className="font-semibold">Settings → Data Settings → WiFi API</span>. The M2 and
              this server need a network connection to each other.
            </p>
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                Set <span className="font-semibold">API endpoint</span> to:
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <code className="break-all rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-900 dark:bg-gray-800 dark:text-gray-100">
                    {endpointUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyEndpoint()}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </li>
              <li>
                Under <span className="font-semibold">Custom request header → Authorization header</span>,
                enter the key your admin set as{' '}
                <span className="font-mono text-xs">DIMENSIONER_API_KEY</span>. It is not shown here.
              </li>
              <li>
                Turn on <span className="font-semibold">Realtime WMS upload</span> so every Save is sent
                right away.
              </li>
              <li>
                Leave the photo options off. Photos are not used here and make each upload much larger.
              </li>
            </ol>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              The M2 reports millimetres and grams. This page converts them to inches and pounds, rounded
              to two decimals. Hover a size to see the original millimetres.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
