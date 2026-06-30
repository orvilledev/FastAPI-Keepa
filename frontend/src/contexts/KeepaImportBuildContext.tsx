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
import { keepaImportExportApi } from '../services/api'
import { downloadBlob, parseMicroToolDownloadResponse } from '../utils/downloadLinkedFile'

type KeepaImportBuildContextValue = {
  building: boolean
  buildingCategory: string | null
  buildingUpcCount: number | null
  error: string | null
  info: string | null
  setError: Dispatch<SetStateAction<string | null>>
  setInfo: Dispatch<SetStateAction<string | null>>
  startDownload: (category: string, upcCount: number | null) => Promise<void>
  clearMessages: () => void
}

const KeepaImportBuildContext = createContext<KeepaImportBuildContextValue | null>(null)

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
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

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

  const startDownload = useCallback(async (category: string, upcCount: number | null) => {
    if (building) return

    setBuilding(true)
    setBuildingCategory(category)
    setBuildingUpcCount(upcCount)
    setError(null)
    const countLabel = upcCount ? `${upcCount.toLocaleString()} UPCs` : 'this vendor'
    setInfo(
      `Building the Keepa file for ${countLabel}. This can take several minutes — you can leave this page and come back.`,
    )

    try {
      const response = await keepaImportExportApi.download(category)
      const { blob, filename } = parseMicroToolDownloadResponse(
        response.data as Blob,
        response.headers as Record<string, string | undefined>,
        `${category.toUpperCase()}_Keepa_Import`,
      )
      downloadBlob(blob, filename)
      setInfo(`Downloaded ${filename}.`)
    } catch (e: unknown) {
      console.error(e)
      setInfo(null)
      const err = e as { code?: string; message?: string }
      const timedOut =
        err?.code === 'ECONNABORTED' ||
        (err?.message ?? '').toLowerCase().includes('timeout')
      if (timedOut) {
        setError(
          'The file took too long to build and the request timed out. Try again, or use a vendor with fewer UPCs.',
        )
      } else {
        setError(extractDetail(e, 'Could not build the Keepa file. Please try again.'))
      }
    } finally {
      setBuilding(false)
      setBuildingCategory(null)
      setBuildingUpcCount(null)
    }
  }, [building])

  const value: KeepaImportBuildContextValue = {
    building,
    buildingCategory,
    buildingUpcCount,
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
