import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import {
  scanFilesInBrowser,
  type TrackingScanProgress,
  type TrackingScannerRow,
  type TrackingScannerAggregateResponse,
} from '../utils/trackingExtractor'
import { trackingScannerApi } from '../services/api'
import { useUser } from './UserContext'
import type { TrackingHistorySummary } from '../types'

export type TrackingScanStats = {
  sources: number
  files: number
  pairs: number
  matched: number
  needsReview: number
}

type TrackingScanContextValue = {
  files: File[]
  rows: TrackingScannerRow[]
  stats: TrackingScanStats | null
  scanning: boolean
  scanProgress: TrackingScanProgress | null
  error: string | null
  success: string | null
  history: TrackingHistorySummary[]
  historyLoading: boolean
  historyClearing: boolean
  historyBusyId: string | null
  /** Set when the visible rows came from opening a saved history record. */
  loadedHistoryId: string | null
  setError: Dispatch<SetStateAction<string | null>>
  setSuccess: Dispatch<SetStateAction<string | null>>
  selectFiles: (picked: File[]) => void
  startScan: () => Promise<void>
  updateRow: (index: number, key: keyof TrackingScannerRow, value: string) => void
  /** Clear everything back to the empty Tracking Extractor main view. */
  resetView: () => void
  loadHistory: () => Promise<void>
  openHistory: (id: string) => Promise<void>
  deleteHistory: (id: string) => Promise<void>
  clearAllHistory: () => Promise<void>
}

const TrackingScanContext = createContext<TrackingScanContextValue | null>(null)

/**
 * Holds the Tracking Extractor's scan lifecycle (selected files, in-flight
 * progress, extracted rows, scan history). Mounted above the router so an
 * in-browser scan keeps running — and its results stay intact — even when the
 * user navigates to another page and back. State is still in-memory only, so a
 * hard refresh clears it.
 */
export function TrackingScanProvider({ children }: { children: ReactNode }) {
  const { isSuperadmin } = useUser()
  const [files, setFiles] = useState<File[]>([])
  const [rows, setRows] = useState<TrackingScannerRow[]>([])
  const [stats, setStats] = useState<TrackingScanStats | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [scanProgress, setScanProgress] = useState<TrackingScanProgress | null>(null)
  const [history, setHistory] = useState<TrackingHistorySummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyClearing, setHistoryClearing] = useState(false)
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null)
  const [loadedHistoryId, setLoadedHistoryId] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const next = await trackingScannerApi.listHistory()
      setHistory(next)
    } catch {
      setError('Could not load tracking history.')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  // A scan survives in-app navigation (this provider stays mounted), but a hard
  // refresh or tab close wipes the in-memory files and OCR workers — there's no
  // way to resume. Warn the user before they lose an in-progress scan.
  useEffect(() => {
    if (!scanning) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Legacy browsers require returnValue to be set; modern ones ignore the text.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [scanning])

  const selectFiles = useCallback((picked: File[]) => {
    setFiles(picked)
    setRows([])
    setStats(null)
    setScanProgress(null)
    setError(null)
    setSuccess(null)
    setLoadedHistoryId(null)
  }, [])

  const resetView = useCallback(() => {
    setFiles([])
    setRows([])
    setStats(null)
    setScanProgress(null)
    setError(null)
    setSuccess(null)
    setLoadedHistoryId(null)
  }, [])

  const startScan = useCallback(async () => {
    if (files.length === 0) return
    setScanning(true)
    setScanProgress({ completed: 0, total: files.length, percent: 0, current_file: '' })
    setError(null)
    setSuccess(null)
    // A fresh scan's results are "live", not opened from history.
    setLoadedHistoryId(null)
    try {
      const result: TrackingScannerAggregateResponse = await scanFilesInBrowser(files, (progress) => {
        setScanProgress(progress)
      })
      setRows(result.rows)
      setStats({
        sources: result.source_count,
        files: result.file_count,
        pairs: result.pair_count,
        matched: result.matched_count,
        needsReview: result.needs_review_count,
      })
      try {
        const saved = await trackingScannerApi.saveHistory({
          name: `Scan ${new Date().toLocaleString()}`,
          source_count: result.source_count,
          file_count: result.file_count,
          pair_count: result.pair_count,
          matched_count: result.matched_count,
          needs_review_count: result.needs_review_count,
          rows: result.rows,
        })
        setHistory((prev) => [saved, ...prev])
      } catch {
        // Non-blocking: scan results are still available in-memory even if save fails.
      }
      if (result.matched_count === 0) {
        setSuccess(
          `Scanned ${result.file_count} PDF(s) from ${result.source_count} upload(s), with ${result.pair_count} page pair(s). No complete matches were found. Review and edit rows below before exporting.`
        )
      } else {
        setSuccess(
          `Scanned ${result.file_count} PDF(s) from ${result.source_count} upload(s): ${result.pair_count} pair(s), ${result.matched_count} matched, ${result.needs_review_count} need review.`
        )
      }
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
          ?.detail ||
        (err as { message?: string })?.message ||
        'Failed to scan files.'
      setError(typeof detail === 'string' ? detail : 'Failed to scan files.')
    } finally {
      setScanning(false)
      setScanProgress(null)
    }
  }, [files])

  const openHistory = useCallback(async (id: string) => {
    setHistoryBusyId(id)
    setError(null)
    setSuccess(null)
    try {
      const record = await trackingScannerApi.getHistory(id)
      setRows(record.rows)
      setStats({
        sources: record.source_count,
        files: record.file_count,
        pairs: record.pair_count,
        matched: record.matched_count,
        needsReview: record.needs_review_count,
      })
      setLoadedHistoryId(id)
      setSuccess(`Loaded ${record.row_count} row(s) from history.`)
    } catch {
      setError('Could not load selected history record.')
    } finally {
      setHistoryBusyId(null)
    }
  }, [])

  const deleteHistory = useCallback(async (id: string) => {
    if (!window.confirm('Delete this history record?')) return
    setHistoryBusyId(id)
    setError(null)
    try {
      await trackingScannerApi.deleteHistory(id)
      setHistory((prev) => prev.filter((item) => item.id !== id))
    } catch {
      setError('Could not delete selected history record.')
    } finally {
      setHistoryBusyId(null)
    }
  }, [])

  const clearAllHistory = useCallback(async () => {
    const msg = isSuperadmin
      ? 'Delete ALL tracking scan history for every user? This cannot be undone.'
      : 'Delete all of your saved tracking scans? This cannot be undone.'
    if (!window.confirm(msg)) return
    setHistoryClearing(true)
    setError(null)
    setSuccess(null)
    try {
      await trackingScannerApi.clearAllHistory()
      setHistory([])
      setSuccess(isSuperadmin ? "All users' scan history was cleared." : 'Your scan history was cleared.')
    } catch {
      setError('Could not clear scan history.')
    } finally {
      setHistoryClearing(false)
    }
  }, [isSuperadmin])

  const updateRow = useCallback(
    (index: number, key: keyof TrackingScannerRow, value: string) => {
      setRows((prev) => {
        const next = [...prev]
        next[index] = { ...next[index], [key]: value }
        return next
      })
    },
    []
  )

  const value: TrackingScanContextValue = {
    files,
    rows,
    stats,
    scanning,
    scanProgress,
    error,
    success,
    history,
    historyLoading,
    historyClearing,
    historyBusyId,
    loadedHistoryId,
    setError,
    setSuccess,
    selectFiles,
    startScan,
    updateRow,
    resetView,
    loadHistory,
    openHistory,
    deleteHistory,
    clearAllHistory,
  }

  return <TrackingScanContext.Provider value={value}>{children}</TrackingScanContext.Provider>
}

export function useTrackingScan(): TrackingScanContextValue {
  const ctx = useContext(TrackingScanContext)
  if (!ctx) {
    throw new Error('useTrackingScan must be used within a TrackingScanProvider')
  }
  return ctx
}
