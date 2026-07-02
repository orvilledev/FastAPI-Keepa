import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import {
  keepaImportExportApi,
  type KeepaImportBuildHistoryItem,
} from '../services/api'
import { downloadBlob, parseMicroToolDownloadResponse } from '../utils/downloadLinkedFile'

export type KeepaImportBuildProgress = {
  percent: number
  completed: number
  total: number
  phase: string
  message: string
}

type KeepaImportBuildContextValue = {
  building: boolean
  buildingCategory: string | null
  buildingUpcCount: number | null
  progress: KeepaImportBuildProgress | null
  error: string | null
  info: string | null
  history: KeepaImportBuildHistoryItem[]
  historyLoading: boolean
  historyBusyId: string | null
  setError: Dispatch<SetStateAction<string | null>>
  setInfo: Dispatch<SetStateAction<string | null>>
  startDownload: (category: string, upcCount: number | null) => Promise<void>
  cancelBuild: () => Promise<void>
  clearMessages: () => void
  loadHistory: (options?: { silent?: boolean }) => Promise<KeepaImportBuildHistoryItem[] | null>
  downloadFromHistory: (item: KeepaImportBuildHistoryItem) => Promise<void>
}

const KeepaImportBuildContext = createContext<KeepaImportBuildContextValue | null>(null)

const POLL_MS = 2000
const HISTORY_POLL_MS = 2000
const STORAGE_KEY = 'keepaImportBuild'

type PersistedBuild = {
  buildId: string
  category: string
  upcCount: number | null
}

function loadPersisted(): PersistedBuild | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedBuild
    if (parsed && typeof parsed.buildId === 'string' && parsed.buildId) {
      return parsed
    }
  } catch {
    // ignore malformed storage
  }
  return null
}

function savePersisted(value: PersistedBuild) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // storage may be unavailable (private mode); progress still works in-session
  }
}

function clearPersisted() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

function extractDetail(e: unknown, fallback: string) {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback
}

function statusCode(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status
}

async function triggerFileDownload(
  buildId: string,
  category: string,
  filenameHint?: string | null,
) {
  const response = await keepaImportExportApi.downloadBuild(buildId)
  const { blob, filename } = parseMicroToolDownloadResponse(
    response.data as Blob,
    response.headers as Record<string, string | undefined>,
    filenameHint ?? `${category.toUpperCase()}_Keepa_Import`,
  )
  downloadBlob(blob, filename)
  return filename
}

/**
 * Holds the Keepa Import File build lifecycle above the router so a long Keepa
 * build keeps running — and its status stays visible — when the user navigates
 * within the app. The build itself runs on the server, so it continues even if
 * the app is closed; on reopen we resume polling and completed files live in the
 * build history archive for re-download.
 */
export function KeepaImportBuildProvider({ children }: { children: ReactNode }) {
  const [building, setBuilding] = useState(false)
  const [buildingCategory, setBuildingCategory] = useState<string | null>(null)
  const [buildingUpcCount, setBuildingUpcCount] = useState<number | null>(null)
  const [progress, setProgress] = useState<KeepaImportBuildProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [history, setHistory] = useState<KeepaImportBuildHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof window.setInterval> | null>(null)
  const historyPollRef = useRef<ReturnType<typeof window.setInterval> | null>(null)
  const buildIdRef = useRef<string | null>(null)
  const buildingCategoryRef = useRef<string | null>(null)

  useEffect(() => {
    buildingCategoryRef.current = buildingCategory
  }, [buildingCategory])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const stopHistoryPolling = useCallback(() => {
    if (historyPollRef.current) {
      clearInterval(historyPollRef.current)
      historyPollRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      stopPolling()
      stopHistoryPolling()
    }
  }, [stopPolling, stopHistoryPolling])

  useEffect(() => {
    if (!building) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [building])

  const clearMessages = useCallback(() => {
    setError(null)
    setInfo(null)
  }, [])

  const syncProgressFromHistory = useCallback((rows: KeepaImportBuildHistoryItem[]) => {
    const buildId = buildIdRef.current
    if (!buildId) return
    const row = rows.find((item) => item.id === buildId && item.status === 'building')
    if (!row) return
    setProgress({
      percent: row.progress_percent,
      completed: row.completed_upcs,
      total: row.upc_count,
      phase: row.phase ?? '',
      message: row.message ?? '',
    })
  }, [])

  const loadHistory = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    if (!silent) setHistoryLoading(true)
    try {
      const rows = await keepaImportExportApi.listBuildHistory()
      setHistory(rows)
      syncProgressFromHistory(rows)
      return rows
    } catch (e) {
      console.error(e)
      return null
    } finally {
      if (!silent) setHistoryLoading(false)
    }
  }, [syncProgressFromHistory])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const finishBuild = useCallback(async () => {
    stopPolling()
    stopHistoryPolling()
    buildIdRef.current = null
    buildingCategoryRef.current = null
    clearPersisted()
    setBuilding(false)
    setBuildingCategory(null)
    setBuildingUpcCount(null)
    setProgress(null)
    await loadHistory({ silent: true })
  }, [loadHistory, stopHistoryPolling, stopPolling])

  const downloadFromHistory = useCallback(
    async (item: KeepaImportBuildHistoryItem) => {
      if (item.status !== 'complete') return
      setHistoryBusyId(item.id)
      setError(null)
      try {
        const response = await keepaImportExportApi.downloadBuildHistory(item.id)
        const { blob, filename } = parseMicroToolDownloadResponse(
          response.data as Blob,
          response.headers as Record<string, string | undefined>,
          item.filename ?? `${item.category.toUpperCase()}_Keepa_Import`,
        )
        downloadBlob(blob, filename)
        setInfo(`Downloaded ${filename}.`)
      } catch (e: unknown) {
        console.error(e)
        setError(extractDetail(e, 'Could not download the file. Please try again.'))
      } finally {
        setHistoryBusyId(null)
      }
    },
    [],
  )

  const pollBuild = useCallback(
    async (buildId: string, category: string) => {
      try {
        const status = await keepaImportExportApi.getBuildStatus(buildId)
        setProgress({
          percent: status.progress_percent,
          completed: status.completed,
          total: status.total,
          phase: status.phase,
          message: status.message,
        })

        if (status.status === 'building') {
          return
        }

        stopPolling()
        void loadHistory({ silent: true })

        if (status.status === 'complete') {
          try {
            const filename = await triggerFileDownload(
              buildId,
              category,
              status.filename,
            )
            setInfo(`Build complete — downloaded ${filename}. You can also re-download from Build history below.`)
          } catch (e: unknown) {
            console.error(e)
            setInfo(
              'Build complete. The file is saved in Build history below — click Download to get your Excel file.',
            )
            if (statusCode(e) !== 409) {
              setError(
                extractDetail(
                  e,
                  'Auto-download failed. Use Download in Build history below.',
                ),
              )
            }
          }
          await finishBuild()
          return
        }

        if (status.status === 'failed') {
          setInfo(null)
          setError(status.error || 'Could not build the Keepa file. Please try again.')
          await finishBuild()
          return
        }

        if (status.status === 'cancelled') {
          setError(null)
          setInfo('Build cancelled.')
          await finishBuild()
        }
      } catch (e: unknown) {
        console.error(e)
        if (statusCode(e) === 404) {
          setInfo(null)
          setError(
            'That build is no longer available on the server. Check Build history below for completed files.',
          )
          await finishBuild()
        }
      }
    },
    [finishBuild, loadHistory, stopPolling],
  )

  const beginPolling = useCallback(
    (buildId: string, category: string, upcCount: number | null) => {
      stopPolling()
      buildIdRef.current = buildId
      buildingCategoryRef.current = category
      savePersisted({ buildId, category, upcCount })
      setBuilding(true)
      setBuildingCategory(category)
      setBuildingUpcCount(upcCount)
      void pollBuild(buildId, category)
      pollRef.current = window.setInterval(() => {
        const id = buildIdRef.current
        const cat = buildingCategoryRef.current
        if (id && cat) {
          void pollBuild(id, cat)
        }
      }, POLL_MS)
    },
    [pollBuild, stopPolling],
  )

  const startHistoryPolling = useCallback(() => {
    if (historyPollRef.current) return
    const tick = () => {
      void loadHistory({ silent: true })
      const id = buildIdRef.current
      const cat = buildingCategoryRef.current
      if (id && cat && !pollRef.current) {
        void pollBuild(id, cat)
      }
    }
    void tick()
    historyPollRef.current = window.setInterval(tick, HISTORY_POLL_MS)
  }, [loadHistory, pollBuild])

  const refreshLiveProgress = useCallback(() => {
    const id = buildIdRef.current
    const cat = buildingCategoryRef.current
    void loadHistory({ silent: true })
    if (id && cat) {
      void pollBuild(id, cat)
    }
  }, [loadHistory, pollBuild])

  // Keep build history percentages fresh for everyone while any build is running.
  useEffect(() => {
    let active = true

    const ensureHistoryPolling = async () => {
      try {
        const busy = await keepaImportExportApi.getGlobalBuildBusy()
        if (!active) return
        if (busy.busy || building) {
          startHistoryPolling()
          return
        }
        stopHistoryPolling()
      } catch {
        if (building) {
          startHistoryPolling()
        }
      }
    }

    void ensureHistoryPolling()
    const id = window.setInterval(() => void ensureHistoryPolling(), HISTORY_POLL_MS)
    return () => {
      active = false
      window.clearInterval(id)
    }
  }, [building, startHistoryPolling, stopHistoryPolling])

  // Restart status polling if the interval was lost while a build is still active.
  useEffect(() => {
    if (!building || !buildIdRef.current || !buildingCategoryRef.current) return

    const watchdog = window.setInterval(() => {
      if (!building || !buildIdRef.current || !buildingCategoryRef.current) return
      if (pollRef.current) return
      const id = buildIdRef.current
      const cat = buildingCategoryRef.current
      void pollBuild(id, cat)
      pollRef.current = window.setInterval(() => {
        const currentId = buildIdRef.current
        const currentCat = buildingCategoryRef.current
        if (currentId && currentCat) {
          void pollBuild(currentId, currentCat)
        }
      }, POLL_MS)
    }, 3000)

    return () => window.clearInterval(watchdog)
  }, [building, pollBuild])

  // Catch up immediately when the window regains focus.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      refreshLiveProgress()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refreshLiveProgress])

  const startDownload = useCallback(
    async (category: string, upcCount: number | null) => {
      if (building) return

      stopPolling()
      setBuilding(true)
      setBuildingCategory(category)
      setBuildingUpcCount(upcCount)
      setProgress(null)
      setError(null)
      const countLabel = upcCount ? `${upcCount.toLocaleString()} UPCs` : 'this vendor'
      setInfo(
        `Building the Keepa file for ${countLabel}. This runs on the server — you can leave this page, or even close the app, and it keeps building. When it finishes, the file is saved to Build history below.`,
      )

      try {
        const { build_id } = await keepaImportExportApi.startBuild(category)
        beginPolling(build_id, category, upcCount)
        void loadHistory({ silent: true })
      } catch (e: unknown) {
        console.error(e)
        setInfo(null)
        setError(extractDetail(e, 'Could not start the Keepa file build. Please try again.'))
        await finishBuild()
      }
    },
    [building, finishBuild, beginPolling, stopPolling, loadHistory],
  )

  const cancelBuild = useCallback(async () => {
    const buildId = buildIdRef.current
    if (!buildId) return
    stopPolling()
    try {
      await keepaImportExportApi.cancelBuild(buildId)
    } catch (e: unknown) {
      console.error(e)
    }
    setHistory((prev) =>
      prev.map((row) =>
        row.id === buildId
          ? {
              ...row,
              status: 'cancelled',
              phase: 'cancelled',
              message: 'Build cancelled',
              completed_at: row.completed_at ?? new Date().toISOString(),
            }
          : row,
      ),
    )
    setError(null)
    setInfo('Build cancelled.')
    await finishBuild()
  }, [finishBuild, stopPolling])

  // On mount, resume any build that is still running (or just finished) on the server.
  useEffect(() => {
    let active = true
    const resume = async () => {
      const persisted = loadPersisted()
      let target: { buildId: string; category: string; upcCount: number | null } | null =
        persisted
          ? {
              buildId: persisted.buildId,
              category: persisted.category,
              upcCount: persisted.upcCount,
            }
          : null

      try {
        const serverBuild = await keepaImportExportApi.getActiveBuild()
        if (serverBuild) {
          if (serverBuild.status === 'building') {
            target = {
              buildId: serverBuild.build_id,
              category: serverBuild.category,
              upcCount: serverBuild.total,
            }
          } else if (serverBuild.status === 'complete') {
            if (active) {
              setInfo(
                'Your Keepa file finished while you were away. Download it from Build history below.',
              )
            }
            clearPersisted()
            target = null
          } else if (serverBuild.status === 'failed') {
            if (active) {
              setError(
                serverBuild.error ||
                  'Your Keepa file build was interrupted. Start a new build from Build history below.',
              )
            }
            clearPersisted()
            target = null
          } else if (!persisted) {
            target = null
          }
        } else if (persisted) {
          clearPersisted()
          target = null
        }
      } catch {
        // Active lookup failed; fall back to the persisted id if present.
      }

      if (active && target) {
        setInfo('Resuming your Keepa file build…')
        beginPolling(target.buildId, target.category, target.upcCount)
      }
    }
    void resume()
    return () => {
      active = false
    }
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value: KeepaImportBuildContextValue = {
    building,
    buildingCategory,
    buildingUpcCount,
    progress,
    error,
    info,
    history,
    historyLoading,
    historyBusyId,
    setError,
    setInfo,
    startDownload,
    cancelBuild,
    clearMessages,
    loadHistory,
    downloadFromHistory,
  }

  return (
    <KeepaImportBuildContext.Provider value={value}>{children}</KeepaImportBuildContext.Provider>
  )
}

export function useKeepaImportBuild(): KeepaImportBuildContextValue {
  const ctx = useContext(KeepaImportBuildContext)
  if (!ctx) {
    throw new Error('useKeepaImportBuild must be used within a KeepaImportBuildProvider')
  }
  return ctx
}
