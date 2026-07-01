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
  loadHistory: (options?: { silent?: boolean }) => Promise<void>
  downloadFromHistory: (item: KeepaImportBuildHistoryItem) => Promise<void>
}

const KeepaImportBuildContext = createContext<KeepaImportBuildContextValue | null>(null)

const POLL_MS = 2000
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const buildIdRef = useRef<string | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

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

  const loadHistory = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    if (!silent) setHistoryLoading(true)
    try {
      const rows = await keepaImportExportApi.listBuildHistory()
      setHistory(rows)
    } catch (e) {
      console.error(e)
    } finally {
      if (!silent) setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const finishBuild = useCallback(() => {
    stopPolling()
    buildIdRef.current = null
    clearPersisted()
    setBuilding(false)
    setBuildingCategory(null)
    setBuildingUpcCount(null)
    setProgress(null)
    void loadHistory({ silent: true })
  }, [loadHistory, stopPolling])

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
        void loadHistory({ silent: true })

        if (status.status === 'complete') {
          stopPolling()
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
          finishBuild()
          return
        }

        if (status.status === 'failed') {
          setInfo(null)
          setError(status.error || 'Could not build the Keepa file. Please try again.')
          finishBuild()
          return
        }

        if (status.status === 'cancelled') {
          setError(null)
          setInfo('Build cancelled.')
          finishBuild()
        }
      } catch (e: unknown) {
        console.error(e)
        if (statusCode(e) === 404) {
          setInfo(null)
          setError(
            'That build is no longer available on the server. Check Build history below for completed files.',
          )
          finishBuild()
        }
      }
    },
    [finishBuild, loadHistory, stopPolling],
  )

  const beginPolling = useCallback(
    (buildId: string, category: string, upcCount: number | null) => {
      stopPolling()
      buildIdRef.current = buildId
      savePersisted({ buildId, category, upcCount })
      setBuilding(true)
      setBuildingCategory(category)
      setBuildingUpcCount(upcCount)
      void pollBuild(buildId, category)
      pollRef.current = setInterval(() => {
        void pollBuild(buildId, category)
      }, POLL_MS)
    },
    [pollBuild, stopPolling],
  )

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
        finishBuild()
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
    setError(null)
    setInfo('Build cancelled.')
    finishBuild()
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
