import { useCallback, useEffect, useRef, useState } from 'react'
import { labelStation2Api } from '../../services/api'
import type { LabelStation2Product } from '../../types'

const PAGE_SIZE = 50

type LabelStation2CatalogProps = {
  onSelectScan?: (value: string) => void
  onCountChange?: (count: number) => void
  refreshToken?: number
  canManageCatalog?: boolean
  /** Row count to show while collapsed, before the list has been fetched. */
  totalHint?: number | null
}

export default function LabelStation2Catalog({
  onSelectScan,
  onCountChange,
  refreshToken = 0,
  canManageCatalog = false,
  totalHint = null,
}: LabelStation2CatalogProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<LabelStation2Product[]>([])
  const [total, setTotal] = useState(0)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingUpc, setDeletingUpc] = useState<string | null>(null)
  const loadRequestId = useRef(0)

  const loadCatalog = useCallback(async () => {
    const requestId = ++loadRequestId.current
    setLoading(true)
    setError(null)
    try {
      const response = await labelStation2Api.list(PAGE_SIZE, page * PAGE_SIZE, search || undefined)
      if (requestId !== loadRequestId.current) return
      setItems(response.items)
      setTotal(response.total)
      setLoadedOnce(true)
      if (!search) onCountChange?.(response.total)
    } catch (err: unknown) {
      if (requestId !== loadRequestId.current) return
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Failed to load catalog')
      setItems([])
      setTotal(0)
    } finally {
      if (requestId === loadRequestId.current) setLoading(false)
    }
  }, [page, search, onCountChange])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(0)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (refreshToken > 0) {
      loadRequestId.current += 1
      setPage(0)
      setSearch('')
      setSearchInput('')
    }
  }, [refreshToken])

  // Collapsed by default, so the row query is deferred until the panel is opened.
  useEffect(() => {
    if (!open) return
    void loadCatalog()
  }, [open, loadCatalog])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showActions = Boolean(onSelectScan) || canManageCatalog
  const columnCount = showActions ? 9 : 8
  const headerTotal = loadedOnce ? total : (totalHint ?? 0)

  const handleDelete = async (upc: string) => {
    if (!window.confirm(`Remove UPC "${upc}" from the Label Station II catalog?`)) return
    setDeletingUpc(upc)
    setError(null)
    try {
      await labelStation2Api.delete(upc)
      if (items.length === 1 && page > 0) {
        setPage((p) => p - 1)
      } else {
        await loadCatalog()
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Delete failed')
    } finally {
      setDeletingUpc(null)
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls="ls2-catalog-panel"
          className={`flex w-full items-center justify-between gap-3 bg-gray-50 px-4 py-3 text-left hover:bg-gray-100 ${
            open ? 'border-b border-gray-200' : ''
          }`}
        >
          <span className="block">
            <span className="block text-sm font-semibold text-gray-800">Product catalog</span>
            <span className="mt-0.5 block text-xs font-normal text-gray-600">
              Label Station II rows. FNSKU is looked up from the Label Station catalog by UPC.
              {headerTotal > 0 && (
                <span className="ml-1 font-medium">{headerTotal.toLocaleString()} total</span>
              )}
            </span>
          </span>
          <svg
            className={`w-5 h-5 shrink-0 text-gray-500 transition-transform duration-200 ${
              open ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </h2>

      <div id="ls2-catalog-panel" hidden={!open}>
        <div className="border-b border-gray-200 px-4 py-3">
          <label htmlFor="ls2-catalog-search" className="sr-only">
            Search catalog
          </label>
          <input
            id="ls2-catalog-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search UPC, FNSKU, vendor, description…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#404040] focus:ring-1 focus:ring-[#404040] sm:w-80"
          />
        </div>

        {error && (
          <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Fit all columns in the panel width — do not use app-table-scroll (that forces max-content + horizontal scroll). */}
        <div className="w-full overflow-x-hidden">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className={showActions ? 'w-[12%]' : 'w-[13%]'} />
              <col className={showActions ? 'w-[12%]' : 'w-[13%]'} />
              <col className={showActions ? 'w-[12%]' : 'w-[13%]'} />
              <col className={showActions ? 'w-[18%]' : 'w-[22%]'} />
              <col className="w-[8%]" />
              <col className="w-[7%]" />
              <col className={showActions ? 'w-[9%]' : 'w-[12%]'} />
              <col className={showActions ? 'w-[10%]' : 'w-[12%]'} />
              {showActions && <col className="w-[12%]" />}
            </colgroup>
            <thead>
              <tr className="border-b border-gray-200 bg-white text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-2 py-3 sm:px-3">UPC</th>
                <th className="px-2 py-3 sm:px-3">External ID</th>
                <th className="px-2 py-3 sm:px-3">FNSKU</th>
                <th className="px-2 py-3 sm:px-3">Description</th>
                <th className="px-2 py-3 sm:px-3">Vendor name</th>
                <th className="px-2 py-3 sm:px-3">Size</th>
                <th className="px-2 py-3 sm:px-3">Color</th>
                <th className="px-2 py-3 sm:px-3">MPN</th>
                {showActions && <th className="px-2 py-3 text-right sm:px-3">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={columnCount} className="px-3 py-8 text-center text-gray-500">
                    Loading catalog…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-3 py-8 text-center text-gray-500">
                    {error
                      ? 'Could not load the catalog.'
                      : search
                        ? 'No products match your search.'
                        : 'No products yet. Upload a Label Station II file above.'}
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/80">
                    <td
                      className="px-2 py-2.5 align-top font-mono text-xs text-gray-900 break-all sm:px-3"
                      title={row.upc}
                    >
                      {row.upc}
                    </td>
                    <td
                      className="px-2 py-2.5 align-top font-mono text-xs text-gray-800 break-all sm:px-3"
                      title={row.external_id || undefined}
                    >
                      {row.external_id || '—'}
                    </td>
                    <td className="px-2 py-2.5 align-top font-mono text-xs font-medium sm:px-3">
                      {row.fnsku ? (
                        <span className="break-all text-gray-900" title={row.fnsku}>
                          {row.fnsku}
                        </span>
                      ) : (
                        <span
                          className="leading-snug text-amber-700"
                          title="This UPC is not in the Label Station catalog, so its FNSKU cannot be scanned."
                        >
                          Not in Label Station
                        </span>
                      )}
                    </td>
                    <td
                      className="px-2 py-2.5 align-top leading-snug text-gray-800 break-words sm:px-3"
                      title={row.description || undefined}
                    >
                      {row.description || '—'}
                    </td>
                    <td
                      className="px-2 py-2.5 align-top text-gray-800 break-words sm:px-3"
                      title={row.vendor_name || undefined}
                    >
                      {row.vendor_name || '—'}
                    </td>
                    <td
                      className="px-2 py-2.5 align-top text-gray-800 break-words sm:px-3"
                      title={row.size || undefined}
                    >
                      {row.size || '—'}
                    </td>
                    <td
                      className="px-2 py-2.5 align-top text-gray-800 break-words sm:px-3"
                      title={row.color || undefined}
                    >
                      {row.color || '—'}
                    </td>
                    <td
                      className="px-2 py-2.5 align-top font-mono text-xs text-gray-800 break-all sm:px-3"
                      title={row.mpn || undefined}
                    >
                      {row.mpn || '—'}
                    </td>
                    {showActions && (
                      <td className="px-2 py-2.5 align-top sm:px-3">
                        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                          {onSelectScan ? (
                            <button
                              type="button"
                              onClick={() => onSelectScan(row.fnsku || row.upc)}
                              className="text-xs font-medium text-[#404040] hover:underline"
                            >
                              Scan
                            </button>
                          ) : null}
                          {canManageCatalog && (
                            <button
                              type="button"
                              disabled={deletingUpc === row.upc}
                              onClick={() => void handleDelete(row.upc)}
                              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                            >
                              {deletingUpc === row.upc ? '…' : 'Delete'}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-gray-50/80 px-4 py-3 text-sm text-gray-600">
            <span>
              Page {page + 1} of {totalPages}
              <span className="text-gray-400 mx-1">·</span>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{' '}
              {total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages - 1 || loading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-40"
              >
                Next
              </button>
              <button
                type="button"
                disabled={page >= totalPages - 1 || loading}
                onClick={() => setPage(totalPages - 1)}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-40"
              >
                Last
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
