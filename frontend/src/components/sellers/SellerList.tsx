import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sellersApi } from '../../services/api'
import type { SellerName } from '../../types'

/** One row: `seller_id,seller_name` — split on first comma; name may contain commas if quoted. */
function parseSellerLine(line: string): { seller_id: string; seller_name: string } | null {
  const t = line.trim()
  if (!t) return null
  if (t.startsWith('#') || t.toLowerCase() === 'seller_id,seller_name' || t.toLowerCase() === 'code,name') {
    return null
  }
  const idx = t.indexOf(',')
  if (idx === -1) return null
  let seller_id = t.slice(0, idx).trim()
  let seller_name = t.slice(idx + 1).trim()
  if (
    seller_name.length >= 2 &&
    ((seller_name.startsWith('"') && seller_name.endsWith('"')) ||
      (seller_name.startsWith("'") && seller_name.endsWith("'")))
  ) {
    seller_name = seller_name.slice(1, -1)
  }
  if (!seller_id || !seller_name) return null
  return { seller_id, seller_name }
}

function parseBulkText(text: string): Array<{ seller_id: string; seller_name: string }> {
  const lines = text.split(/\r?\n/)
  const out: Array<{ seller_id: string; seller_name: string }> = []
  let skipHeader = false
  if (lines[0]) {
    const h = lines[0].toLowerCase()
    if (h.includes('seller_id') && h.includes('seller_name')) skipHeader = true
    if (h === 'code,name' || h === 'seller_id,seller_name') skipHeader = true
  }
  const start = skipHeader ? 1 : 0
  for (let i = start; i < lines.length; i++) {
    const row = parseSellerLine(lines[i])
    if (row) out.push(row)
  }
  return out
}

export default function SellerList() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [sellers, setSellers] = useState<SellerName[]>([])
  const [loading, setLoading] = useState(true)
  const [bulkText, setBulkText] = useState('')
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyDelete, setBusyDelete] = useState<string | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [message, setMessage] = useState<{ text: string; variant: 'ok' | 'err' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const data = await sellersApi.list()
      setSellers(data.sellers || [])
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'response' in e ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail : undefined
      setMessage({ text: typeof msg === 'string' ? msg : 'Failed to load sellers', variant: 'err' })
      setSellers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sellers
    return sellers.filter(
      (s) =>
        s.seller_id.toLowerCase().includes(q) || s.seller_name.toLowerCase().includes(q)
    )
  }, [sellers, search])

  const toggle = (seller_id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(seller_id)) next.delete(seller_id)
      else next.add(seller_id)
      return next
    })
  }

  const toggleAllVisible = () => {
    const ids = filtered.map((s) => s.seller_id)
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        ids.forEach((id) => next.delete(id))
      } else {
        ids.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const handleBulkImport = async (rows: Array<{ seller_id: string; seller_name: string }>) => {
    if (rows.length === 0) {
      setMessage({ text: 'No valid rows. Use seller_id,seller_name per line (comma after the ID).', variant: 'err' })
      return
    }
    setImporting(true)
    setMessage(null)
    try {
      await sellersApi.bulkUpsert(rows)
      setMessage({ text: `Added ${rows.length} seller(s).`, variant: 'ok' })
      setBulkText('')
      setSelected(new Set())
      await load()
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setMessage({ text: typeof msg === 'string' ? msg : 'Import failed', variant: 'err' })
    } finally {
      setImporting(false)
    }
  }

  const onImportText = () => handleBulkImport(parseBulkText(bulkText))

  const onFile = (file: File | null) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result.replace(/^\uFEFF/, '') : ''
      const rows = parseBulkText(text)
      void handleBulkImport(rows)
    }
    reader.onerror = () => setMessage({ text: 'Could not read file.', variant: 'err' })
    reader.readAsText(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  const onDeleteOne = async (seller_id: string) => {
    if (!window.confirm(`Remove seller ${seller_id}?`)) return
    setBusyDelete(seller_id)
    setMessage(null)
    try {
      await sellersApi.delete(seller_id)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(seller_id)
        return next
      })
      setMessage({ text: 'Seller removed.', variant: 'ok' })
      await load()
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setMessage({ text: typeof msg === 'string' ? msg : 'Delete failed', variant: 'err' })
    } finally {
      setBusyDelete(null)
    }
  }

  const onDeleteSelected = async () => {
    const ids = filtered.filter((s) => selected.has(s.seller_id)).map((s) => s.seller_id)
    if (ids.length === 0) {
      setMessage({ text: 'Select at least one seller.', variant: 'err' })
      return
    }
    if (!window.confirm(`Delete ${ids.length} seller mapping(s)?`)) return
    setBulkDeleting(true)
    setMessage(null)
    try {
      const res = await sellersApi.bulkDelete(ids)
      setMessage({ text: res.message || `Deleted ${res.count} row(s).`, variant: 'ok' })
      setSelected(new Set())
      await load()
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setMessage({ text: typeof msg === 'string' ? msg : 'Bulk delete failed', variant: 'err' })
    } finally {
      setBulkDeleting(false)
    }
  }

  const visibleIds = filtered.map((s) => s.seller_id)
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900">Add Sellers</h1>
      <p className="mt-1 text-sm text-gray-500">
        Amazon seller IDs and display names used in reports. One seller per line — seller code, comma, then name (e.g.{' '}
        <span className="font-mono text-gray-700">A1HQOHOLTUK58E,Buy DBDeals</span>).
      </p>

      {message && (
        <div
          className={`mt-4 rounded-lg px-4 py-3 text-sm ${
            message.variant === 'ok' ? 'bg-green-50 text-green-800 border border-green-100' : 'bg-red-50 text-red-800 border border-red-100'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="mt-8 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-5 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Paste or upload your list</h2>
            <p className="mt-1 text-sm text-gray-500">
              Put one seller per line. After you paste, click <strong className="font-semibold text-gray-700">Add sellers</strong>{' '}
              to save them to the system.
            </p>
          </div>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={8}
            placeholder={'A1HQOHOLTUK58E,Buy DBDeals\nA2EXAMPLE1234567,Another Store'}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono text-gray-900 focus:ring-2 focus:ring-[#0B1020]/20 focus:border-[#0B1020]"
            aria-label="Paste seller list: seller code, comma, then name, one per line"
          />
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:items-center">
            <button
              type="button"
              disabled={importing}
              onClick={() => void onImportText()}
              className="inline-flex justify-center items-center px-6 py-3 rounded-lg bg-[#0B1020] text-white text-base font-semibold shadow-sm hover:bg-[#1a2235] disabled:opacity-50 min-w-[200px]"
            >
              {importing ? 'Adding…' : 'Add sellers'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              className="inline-flex justify-center items-center px-4 py-3 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              Or upload a .csv / .txt file
            </button>
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-900">Sellers in the system</h2>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code or name…"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm w-56 text-gray-900"
            />
            <button
              type="button"
              disabled={bulkDeleting || selected.size === 0}
              onClick={() => void onDeleteSelected()}
              className="inline-flex items-center px-3 py-2 rounded-lg border border-red-200 text-red-700 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
            >
              {bulkDeleting ? 'Deleting…' : `Delete selected (${selected.size})`}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-center text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">
            {sellers.length === 0
              ? 'No sellers saved yet. Paste your list above and click Add sellers.'
              : 'No matches for this search.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-600">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      aria-label="Select all visible"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Seller code</th>
                  <th className="px-4 py-3 font-medium">Seller name</th>
                  <th className="px-4 py-3 font-medium w-28 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(s.seller_id)}
                        onChange={() => toggle(s.seller_id)}
                        aria-label={`Select ${s.seller_id}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-900">{s.seller_id}</td>
                    <td className="px-4 py-3 text-gray-900">{s.seller_name}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={busyDelete === s.seller_id}
                        onClick={() => void onDeleteOne(s.seller_id)}
                        className="text-red-600 text-sm font-medium hover:underline disabled:opacity-50"
                      >
                        {busyDelete === s.seller_id ? '…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
