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
import { keepaImportExportApi } from '../services/api'
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
  setError: Dispatch<SetStateAction<string | null>>
  setInfo: Dispatch<SetStateAction<string | null>>
  startDownload: (category: string, upcCount: number | null) => Promise<void>
  clearMessages: () => void
}

const KeepaImportBuildContext = createContext<KeepaImportBuildContextValue | null>(null)

const POLL_MS = 2000

function extractDetail(e: unknown, fallback: string) {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback
}

/**
 * Holds the Keepa Import File download lifecycle above the router so a long
 * Keepa build keeps running — and its status stays visible — when the user
 * navigates to another page and back. State is in-memory only; a hard refresh
 * cancels the in-flight request.
 */
export function KeepaImportBuildProvider({ children }: { children: ReactNode }) {
  const [building, setBuilding] = useState(false)
  const [buildingCategory, setBuildingCategory] = useState<string | null>(null)
  const [buildingUpcCount, setBuildingUpcCount] = useState<number | null>(null)
  const [progress, setProgress] = useState<KeepaImportBuildProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const buildIdRef = useRef<string | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    buildIdRef.current = null
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

  const finishBuild = useCallback(() => {
    stopPolling()
    setBuilding(false)
    setBuildingCategory(null)
    setBuildingUpcCount(null)
    setProgress(null)
  }, [stopPolling])

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

        if (status.status === 'complete') {
          stopPolling()
          const response = await keepaImportExportApi.downloadBuild(buildId)
          const { blob, filename } = parseMicroToolDownloadResponse(
            response.data as Blob,
            response.headers as Record<string, string | undefined>,
            status.filename ?? `${category.toUpperCase()}_Keepa_Import`,
          )
          downloadBlob(blob, filename)
          setInfo(`Downloaded ${filename}.`)
          finishBuild()
          return
        }

        if (status.status === 'failed') {
          setInfo(null)
          setError(status.error || 'Could not build the Keepa file. Please try again.')
          finishBuild()
        }
      } catch (e: unknown) {
        console.error(e)
        setInfo(null)
        setError(extractDetail(e, 'Could not check build progress. Please try again.'))
        finishBuild()
      }
    },
    [finishBuild, stopPolling],
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
        `Building the Keepa file for ${countLabel}. This can take several minutes — you can leave this page and come back.`,
      )

      try {
        const { build_id } = await keepaImportExportApi.startBuild(category)
        buildIdRef.current = build_id
        await pollBuild(build_id, category)
        pollRef.current = setInterval(() => {
          void pollBuild(build_id, category)
        }, POLL_MS)
      } catch (e: unknown) {
        console.error(e)
        setInfo(null)
        setError(extractDetail(e, 'Could not start the Keepa file build. Please try again.'))
        finishBuild()
      }
    },
    [building, finishBuild, pollBuild, stopPolling],
  )

  const value: KeepaImportBuildContextValue = {
    building,
    buildingCategory,
    buildingUpcCount,
    progress,
    error,
    info,
    setError,
    setInfo,
    startDownload,
    clearMessages,
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
