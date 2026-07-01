import { useCallback, useEffect, useState } from 'react'
import {
  keepaImportExportApi,
  type KeepaImportBuildContentRow,
  type KeepaImportBuildHistoryItem,
} from '../../services/api'

const PAGE_SIZE = 500

type KeepaImportBuildContentsModalProps = {
  open: boolean
  item: KeepaImportBuildHistoryItem | null
  vendorLabel: string
  onClose: () => void
  onDownloadReport: (item: KeepaImportBuildHistoryItem) => void
  downloading: boolean
}

export default function KeepaImportBuildContentsModal({
  open,
  item,
  vendorLabel,
  onClose,
  onDownloadReport,
  downloading,
}: KeepaImportBuildContentsModalProps) {
  const [rows, setRows] = useState<KeepaImportBuildContentRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filename, setFilename] = useState<string | null>(null)

  const loadPage = useCallback(
    async (buildId: string, pageOffset: number, append: boolean) => {
      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }
      setError(null)
      try {
        const data = await keepaImportExportApi.getBuildHistoryContents(buildId, {
          offset: pageOffset,
          limit: PAGE_SIZE,
        })
        setFilename(data.filename ?? null)
        setTotal(data.total)
        setOffset(pageOffset + data.rows.length)
        setRows((prev) => (append ? [...prev, ...data.rows] : data.rows))
      } catch (e: unknown) {
        console.error(e)
        const detail =
          (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          'Could not load report contents.'
        setError(detail)
        if (!append) {
          setRows([])
          setTotal(0)
        }
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!open || !item) return
    setRows([])
    setTotal(0)
    setOffset(0)
    setFilename(null)
    void loadPage(item.id, 0, false)
  }, [open, item, loadPage])

  if (!open || !item) return null

  const hasMore = rows.length < total

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Report contents</h2>
            <p className="mt-1 text-sm text-gray-500">
              {vendorLabel}
              {filename ? ` · ${filename}` : ''}
              {total > 0 ? ` · ${total.toLocaleString()} row${total === 1 ? '' : 's'}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onDownloadReport(item)}
              disabled={downloading}
              className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#3B3B3B] disabled:opacity-50"
            >
              {downloading ? 'Downloading…' : 'Download report'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {loading ? (
            <p className="py-8 text-center text-sm text-gray-500">Loading report contents…</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No rows in this report.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                      UPC
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                      Title
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                      Buy Box Seller
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                      Buy Box Price
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                      ASIN
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                      Amazon URL
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {rows.map((row, index) => (
                    <tr key={`${row.upc}-${index}`} className="hover:bg-gray-50/50">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                        {row.upc || '—'}
                      </td>
                      <td
                        className="max-w-[240px] truncate px-3 py-2 text-gray-700"
                        title={row.title ?? undefined}
                      >
                        {row.title || '—'}
                      </td>
                      <td
                        className="max-w-[200px] truncate px-3 py-2 text-gray-700"
                        title={row.buy_box_seller ?? undefined}
                      >
                        {row.buy_box_seller || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                        {row.buy_box_price || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                        {row.asin || '—'}
                      </td>
                      <td className="px-3 py-2">
                        {row.amazon_url ? (
                          <a
                            href={row.amazon_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-[#404040] hover:underline"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && hasMore && (
          <div className="border-t border-gray-200 px-6 py-3 text-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadPage(item.id, offset, true)}
              className="text-sm font-medium text-[#404040] hover:underline disabled:opacity-50"
            >
              {loadingMore
                ? 'Loading more…'
                : `Load more (${rows.length.toLocaleString()} of ${total.toLocaleString()})`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
