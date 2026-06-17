import { useCallback, useEffect, useState } from 'react'
import { warehouseProductsApi } from '../../services/api'
import type { WarehouseProduct } from '../../types'

const PAGE_SIZE = 50

type WarehouseProductCatalogProps = {
  onSelectUpc?: (upc: string) => void
  onCountChange?: (count: number) => void
  refreshToken?: number
}

export default function WarehouseProductCatalog({
  onSelectUpc,
  onCountChange,
  refreshToken = 0,
}: WarehouseProductCatalogProps) {
  const [items, setItems] = useState<WarehouseProduct[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingUpc, setDeletingUpc] = useState<string | null>(null)

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await warehouseProductsApi.list(PAGE_SIZE, page * PAGE_SIZE, search || undefined)
      setItems(response.items)
      setTotal(response.total)
      onCountChange?.(response.total)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Failed to load catalog')
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
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
    void loadCatalog()
  }, [loadCatalog, refreshToken])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleDelete = async (upc: string) => {
    if (!window.confirm(`Remove UPC "${upc}" from the catalog?`)) return
    setDeletingUpc(upc)
    setError(null)
    try {
      await warehouseProductsApi.delete(upc)
      if (items.length === 1 && page > 0) {
        setPage((p) => p - 1)
      } else {
        await loadCatalog()
      }
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Delete failed')
    } finally {
      setDeletingUpc(null)
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Product catalog</h2>
          <p className="text-xs text-gray-600 mt-0.5">
            Browse imported UPC → FNSKU rows used for scan lookup.
            {total > 0 && (
              <span className="ml-1 font-medium">{total.toLocaleString()} total</span>
            )}
          </p>
        </div>
        <div className="w-full sm:w-72">
          <label htmlFor="catalog-search" className="sr-only">
            Search catalog
          </label>
          <input
            id="catalog-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search UPC, FNSKU, style…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#404040] focus:ring-1 focus:ring-[#404040]"
          />
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-white text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3 whitespace-nowrap">UPC</th>
              <th className="px-4 py-3 whitespace-nowrap">FNSKU</th>
              <th className="px-4 py-3 min-w-[12rem]">Style name</th>
              <th className="px-4 py-3 whitespace-nowrap">Condition</th>
              <th className="px-4 py-3 whitespace-nowrap text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  Loading catalog…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  {search
                    ? 'No products match your search.'
                    : 'No products yet. Upload a PRODUCTS file below.'}
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50/80">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-900 align-top">{row.upc}</td>
                  <td className="px-4 py-2.5 font-mono text-xs font-medium text-gray-900 align-top">
                    {row.fnsku}
                  </td>
                  <td className="px-4 py-2.5 text-gray-800 align-top leading-snug">{row.style_name}</td>
                  <td className="px-4 py-2.5 text-gray-700 align-top whitespace-nowrap">
                    {row.condition}
                  </td>
                  <td className="px-4 py-2.5 align-top whitespace-nowrap w-28">
                    <div className="flex items-center justify-between gap-6">
                      {onSelectUpc ? (
                        <button
                          type="button"
                          onClick={() => onSelectUpc(row.upc)}
                          className="text-xs font-medium text-[#404040] hover:underline"
                        >
                          Scan
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        disabled={deletingUpc === row.upc}
                        onClick={() => void handleDelete(row.upc)}
                        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                      >
                        {deletingUpc === row.upc ? '…' : 'Delete'}
                      </button>
                    </div>
                  </td>
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
    </section>
  )
}
