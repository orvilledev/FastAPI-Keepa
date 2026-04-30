import { useState, useEffect, useRef } from 'react'
import { mapApi } from '../../services/api'
import type { MAP, MapVendorType } from '../../types'

/** Matches backend app.utils.vendor_code (1–32 chars, lowercase alnum + _ -, starts with alnum). */
const VENDOR_CODE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

function normalizeVendorToken(raw: string): MapVendorType | null {
  const v = raw.trim().toLowerCase()
  if (!v || !VENDOR_CODE_RE.test(v)) return null
  return v
}

function sortedUniqueVendors(arr: string[]): string[] {
  return [...new Set(arr)].sort()
}

function parseMapLine(line: string): { upc: string; map_price: number; vendor_type: MapVendorType } | null {
  const raw = line.trim()
  if (!raw) return null

  let parts: string[] = []
  if (raw.includes(',')) {
    // CSV: Column A=UPC, B=price, C=vendor (no header required)
    parts = raw.split(',').map((p) => p.trim())
  } else if (raw.includes('\t')) {
    parts = raw.split('\t').map((p) => p.trim())
  } else {
    parts = raw.split(/\s+/).filter(Boolean)
  }

  if (parts.length < 3) return null

  const upc = parts[0]
  const price = parseFloat(parts[1].replace(/\$/g, ''))
  const vendor = normalizeVendorToken(parts[2])
  if (!upc || isNaN(price) || price <= 0 || !vendor) return null
  return { upc, map_price: price, vendor_type: vendor }
}

function parseMapEntriesFromText(text: string): Array<{ upc: string; map_price: number; vendor_type: MapVendorType }> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const out: Array<{ upc: string; map_price: number; vendor_type: MapVendorType }> = []
  for (const line of lines) {
    const parsed = parseMapLine(line)
    if (parsed) out.push(parsed)
  }
  return out
}

/** One UPC per line; if the line looks like CSV, use the first column as UPC. */
function parseUpcOnlyLine(line: string): string | null {
  const t = line.trim()
  if (!t) return null
  const first = t.includes(',') ? t.split(',')[0].trim() : t
  return first || null
}

export default function MAPManagement() {
  const [maps, setMaps] = useState<MAP[]>([])
  const [allMaps, setAllMaps] = useState<MAP[]>([]) // Store all MAPs for filtering
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [mapInput, setMapInput] = useState('')
  const [uploadedFileName, setUploadedFileName] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [vendorFilter, setVendorFilter] = useState<string>('')
  const [vendorOptions, setVendorOptions] = useState<string[]>(['dnk', 'clk'])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [currentPage, setCurrentPage] = useState(0)
  const [limit] = useState(100)
  const abortControllerRef = useRef<AbortController | null>(null)

  /** UPCs queued for bulk delete (server removes all MAP rows for each UPC, any vendor) */
  const [deleteQueue, setDeleteQueue] = useState<string[]>([])
  const [queueBulkText, setQueueBulkText] = useState('')
  const [bulkDeleting, setBulkDeleting] = useState(false)
  /** Result of “Delete listed MAPs” — shown in the Delete list card only */
  const [deleteListFeedback, setDeleteListFeedback] = useState<{
    message: string
    variant: 'success' | 'error'
  } | null>(null)

  const vendorForApi = vendorFilter || undefined

  const loadVendorOptions = async () => {
    try {
      const { vendors } = await mapApi.listVendors()
      if (vendors?.length) {
        setVendorOptions(sortedUniqueVendors(vendors))
      }
    } catch (e) {
      console.warn('Failed to load MAP vendor list', e)
    }
  }

  useEffect(() => {
    void loadVendorOptions()
  }, [])

  // Reload when page, search, or vendor filter changes
  useEffect(() => {
    loadMAPCount()
    loadMAPs()
  }, [currentPage, searchTerm, vendorFilter])

  // Reset to first page when search or vendor filter changes
  useEffect(() => {
    if (searchTerm.trim()) {
      setCurrentPage(0)
    }
  }, [searchTerm])

  useEffect(() => {
    setCurrentPage(0)
  }, [vendorFilter])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  const loadMAPCount = async () => {
    try {
      const data = await mapApi.getMAPCount(searchTerm.trim() || undefined, vendorForApi)
      setTotalCount(data.count)
    } catch (error) {
      console.error('Failed to load MAP count:', error)
    }
  }

  const loadMAPs = async () => {
    try {
      setLoading(true)
      setError('') // Clear previous errors
      const searchQuery = searchTerm.trim() || undefined
      const data = await mapApi.listMAPs(limit, currentPage * limit, searchQuery, vendorForApi)
      if (Array.isArray(data)) {
        // Ensure map_price is a number for all entries
        const normalizedData = data.map((map) => ({
          ...map,
          map_price: typeof map.map_price === 'string' ? parseFloat(map.map_price) : map.map_price,
          vendor_type: String(map.vendor_type ?? 'dnk').toLowerCase() as MapVendorType,
        }))
        setAllMaps(normalizedData)
        setMaps(normalizedData)
        const fromRows = normalizedData.map((m) => m.vendor_type).filter(Boolean)
        if (fromRows.length) {
          setVendorOptions((prev) => sortedUniqueVendors([...prev, ...fromRows]))
        }
      } else {
        setAllMaps([])
        setMaps([])
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const errorMessage = error.response?.data?.detail || error.message || 'Failed to load MAP entries'
        setError(errorMessage)
        console.error('Error loading MAP entries:', error)
        // Set empty arrays on error to prevent crashes
        setAllMaps([])
        setMaps([])
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setAdding(false)
    setError('')
    setSuccess('Operation cancelled')
  }

  const handleAddMAPs = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setAdding(true)

    // Create abort controller for this operation
    abortControllerRef.current = new AbortController()

    try {
      if (!mapInput.trim()) {
        setError('Please enter at least one MAP entry')
        setAdding(false)
        return
      }

      const mapEntries = parseMapEntriesFromText(mapInput)
      for (const line of mapInput.split(/\r?\n/)) {
        if (abortControllerRef.current?.signal.aborted) {
          return
        }
      }

      if (mapEntries.length === 0) {
        setError(
          'No valid MAP entries found. Each line must have three fields: UPC, price, and vendor code (lowercase letters, digits, hyphens, or underscores; 1–32 chars).'
        )
        setAdding(false)
        return
      }

      // Check if cancelled before API call
      if (abortControllerRef.current?.signal.aborted) {
        return
      }

      // First, check for duplicates
      const duplicateCheck = await mapApi.checkMAPDuplicates(mapEntries)

      // Check if cancelled after duplicate check
      if (abortControllerRef.current?.signal.aborted) {
        return
      }

      // If duplicates found, show confirmation dialog
      let replaceDuplicates = false
      if (duplicateCheck.duplicate_count > 0) {
        const duplicateList = duplicateCheck.duplicate_upcs.slice(0, 10).join(', ')
        const moreText = duplicateCheck.duplicate_upcs.length > 10 
          ? ` and ${duplicateCheck.duplicate_upcs.length - 10} more` 
          : ''
        
        const message = `The following MAP entries (UPC + vendor) already exist:\n\n${duplicateList}${moreText}\n\nReplace them with the new prices?`
        
        const confirmed = window.confirm(message)
        
        if (!confirmed) {
          setError(`Upload cancelled. ${duplicateCheck.duplicate_count} duplicate MAP row(s) were not replaced.`)
          setAdding(false)
          return
        }
        
        replaceDuplicates = true
      }

      // Proceed with adding MAP entries (with replacement if confirmed)
      const result = await mapApi.addMAPs(mapEntries, replaceDuplicates)

      // Check if cancelled after API call
      if (abortControllerRef.current?.signal.aborted) {
        return
      }

      // Safely handle response with defaults
      const added = result?.added || 0
      const rejected = result?.rejected || 0
      const replaced = result?.replaced || 0
      const invalid = result?.invalid || 0

      // Success case - if we replaced duplicates, show appropriate message
      let successMessage = ''
      if (replaceDuplicates && duplicateCheck.duplicate_count > 0) {
        const newEntries = added - replaced
        if (newEntries > 0 && replaced > 0) {
          successMessage = `Successfully added ${newEntries} new MAP entry/entries and replaced ${replaced} existing entry/entries.`
        } else if (replaced > 0) {
          successMessage = `Successfully replaced ${replaced} existing MAP entry/entries.`
        } else {
          successMessage = `Successfully added ${added} MAP entry/entries.`
        }
      } else {
        successMessage = `Successfully added ${added} MAP entry/entries.`
      }
      
      if (invalid > 0) {
        successMessage += ` ${invalid} invalid entries were skipped.`
      }
      
      setSuccess(successMessage)
      setError('')
      setMapInput('')
      setUploadedFileName('')
      
      // Reload data
      try {
        await loadVendorOptions()
        await loadMAPCount()
        await loadMAPs()
      } catch (reloadError: any) {
        console.error('Error reloading MAP data:', reloadError)
        // Don't show error for reload failures, just log them
      }
    } catch (err: any) {
      if (err.name !== 'AbortError' && !abortControllerRef.current?.signal.aborted) {
        const errorMessage = err.response?.data?.detail || err.message || 'Failed to add MAP entries'
        setError(errorMessage)
        console.error('Error adding MAP entries:', err)
      }
    } finally {
      if (!abortControllerRef.current?.signal.aborted) {
        setAdding(false)
      }
      abortControllerRef.current = null
    }
  }

  const handleMapFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const name = file.name.toLowerCase()
    if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
      setError('Only .csv and .txt files are allowed for MAP upload.')
      e.target.value = ''
      return
    }

    try {
      const text = await file.text()
      setMapInput(text)
      setUploadedFileName(file.name)
      setSuccess(`Loaded file "${file.name}". Review and click Add MAP Entries to upload.`)
      setError('')
    } catch (err) {
      console.error('Failed reading MAP upload file', err)
      setError('Could not read the uploaded file. Please try again.')
    } finally {
      // Allow re-selecting the same file
      e.target.value = ''
    }
  }

  const handleDeleteMAP = async (upc: string, vendorType: MapVendorType) => {
    if (!confirm(`Delete MAP for UPC ${upc} (${vendorType.toUpperCase()})?`)) {
      return
    }

    try {
      await mapApi.deleteMAP(upc, vendorType)
      setSuccess(`MAP entry for UPC ${upc} deleted successfully`)
      loadMAPCount()
      loadMAPs()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete MAP entry')
    }
  }

  const addUpcToDeleteQueue = (rawUpc: string) => {
    const upc = rawUpc.trim()
    if (!upc) return
    setDeleteListFeedback(null)
    setDeleteQueue((prev) => (prev.includes(upc) ? prev : [...prev, upc]))
  }

  const handleAddPastedLinesToDeleteQueue = () => {
    const lines = queueBulkText.split(/\r?\n/)
    const nextUpcs: string[] = []
    for (const line of lines) {
      const u = parseUpcOnlyLine(line)
      if (u) nextUpcs.push(u)
    }
    if (nextUpcs.length === 0) return
    setDeleteListFeedback(null)
    setDeleteQueue((prev) => {
      const seen = new Set(prev)
      const merged = [...prev]
      for (const u of nextUpcs) {
        if (seen.has(u)) continue
        seen.add(u)
        merged.push(u)
      }
      return merged
    })
    setQueueBulkText('')
  }

  const handleAddSearchTextToQueue = () => {
    const u = parseUpcOnlyLine(searchTerm)
    if (u) addUpcToDeleteQueue(u)
  }

  const removeFromDeleteQueue = (upc: string) => {
    setDeleteListFeedback(null)
    setDeleteQueue((prev) => prev.filter((p) => p !== upc))
  }

  const clearDeleteQueue = () => {
    setDeleteListFeedback(null)
    setDeleteQueue([])
  }

  const handleDeleteQueuedMAPs = async () => {
    if (deleteQueue.length === 0) return
    if (
      !confirm(
        `Delete all MAP entries for ${deleteQueue.length} UPC(s)? All vendor rows for those UPCs will be removed. This cannot be undone.`
      )
    ) {
      return
    }
    setBulkDeleting(true)
    setError('')
    setSuccess('')
    setDeleteListFeedback(null)
    try {
      const r = await mapApi.deleteMAPsByUpcs(deleteQueue)
      setDeleteQueue([])
      let msg = `Removed ${r.deleted_rows} MAP row(s) across ${r.upcs_requested} UPC(s).`
      if (r.upcs_not_found?.length) {
        msg += ` No MAP row for ${r.upcs_not_found.length} listed UPC(s).`
      }
      if (r.deleted_rows === 0) {
        setDeleteListFeedback({ message: msg, variant: 'error' })
      } else {
        setDeleteListFeedback({ message: msg, variant: 'success' })
      }
      await loadMAPCount()
      await loadMAPs()
    } catch (err: any) {
      setDeleteListFeedback({
        message: err.response?.data?.detail || err.message || 'Bulk delete failed',
        variant: 'error',
      })
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleDeleteAll = async () => {
    const scoped = vendorFilter
    const msg = scoped
      ? `Delete ALL MAP entries for vendor ${scoped.toUpperCase()}? This cannot be undone.`
      : 'Delete ALL MAP entries for every vendor? This cannot be undone.'
    if (!confirm(msg)) {
      return
    }

    try {
      await mapApi.deleteAllMAPs(scoped || undefined)
      setSuccess(
        scoped
          ? `All ${scoped.toUpperCase()} MAP entries deleted successfully`
          : 'All MAP entries deleted successfully'
      )
      setCurrentPage(0)
      await loadMAPCount()
      await loadMAPs()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete all MAP entries')
    }
  }

  const totalPages = Math.ceil(totalCount / limit)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Manage MAP (Minimum Advertised Price)</h1>
        <p className="mt-2 text-sm text-gray-600">
          Manage Minimum Advertised Prices for UPCs. Total: {totalCount} entries
        </p>
      </div>

      {/* Add MAPs Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Add MAP Entries</h2>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4">
            <div className="text-sm text-red-800">{error}</div>
          </div>
        )}

        {success && (
          <div className="mb-4 rounded-md bg-green-50 p-4">
            <div className="text-sm text-green-800">{success}</div>
          </div>
        )}

        <form onSubmit={handleAddMAPs} className="space-y-4">
          <div>
            <label htmlFor="maps" className="block text-sm font-medium text-gray-700">
              MAP Entries{' '}
              <span className="text-gray-500">
                (one per line: UPC,PRICE,VENDOR or UPC PRICE VENDOR — vendor code, e.g. dnk, clk, or custom)
              </span>
            </label>
            <textarea
              id="maps"
              rows={10}
              value={mapInput}
              onChange={(e) => setMapInput(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm font-mono px-3 py-2 border"
              placeholder={"123456789012,29.99,dnk\n987654321098 39.99 clk\n111111111111,19.00,clk"}
            />
            <p className="mt-2 text-sm text-gray-500">
              {mapInput.split('\n').filter((line) => line.trim().length > 0).length} lines entered
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Vendor must be the third field on every line (1–32 lowercase letters, digits, hyphens, or underscores).
            </p>
            <div className="mt-3">
              <label htmlFor="map-upload-file" className="block text-sm font-medium text-gray-700">
                Upload `.csv` or `.txt` (no header)
              </label>
              <input
                id="map-upload-file"
                type="file"
                accept=".csv,.txt,text/plain,text/csv"
                onChange={handleMapFileUpload}
                className="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-gray-50"
              />
              <p className="mt-1 text-xs text-gray-500">
                CSV format: Column A = UPC, Column B = price, Column C = vendor. No header needed.
              </p>
              {uploadedFileName && (
                <p className="mt-1 text-xs text-gray-500">Loaded file: {uploadedFileName}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {adding && (
              <button
                type="button"
                onClick={handleCancel}
                className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={adding}
              className="bg-[#404040] hover:bg-[#3B3B3B] disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm font-medium"
            >
              {adding ? 'Adding...' : 'Add MAP Entries'}
            </button>
          </div>
        </form>
      </div>

      {/* MAPs List */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Delete MAP Entries</h2>
            <div className="text-sm text-gray-500">
              Showing {currentPage * limit + 1} - {Math.min((currentPage + 1) * limit, totalCount)} of {totalCount}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <label htmlFor="vendor-filter" className="text-sm text-gray-600 whitespace-nowrap">
                Vendor
              </label>
              <select
                id="vendor-filter"
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value)}
                className="rounded-md border-gray-300 shadow-sm text-sm border px-2 py-1.5 min-w-[140px]"
              >
                <option value="">All vendors</option>
                {sortedUniqueVendors(vendorOptions).map((v) => (
                  <option key={v} value={v}>
                    {v.toUpperCase()}
                  </option>
                ))}
              </select>
              {vendorFilter && totalCount > 0 && (
                <button
                  type="button"
                  onClick={handleDeleteAll}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-md text-sm font-medium"
                >
                  Delete all {vendorFilter.toUpperCase()}
                </button>
              )}
            </div>
          </div>

          {/* Delete queue: add UPCs, then bulk delete */}
          <div className="mb-4 rounded-lg border border-[#81B81D]/40 bg-[#81B81D]/10 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Delete list</h3>
            {deleteListFeedback && (
              <div
                className={`mb-3 rounded-md border p-3 text-sm ${
                  deleteListFeedback.variant === 'success'
                    ? 'border-green-200 bg-green-50 text-green-900'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                {deleteListFeedback.message}
              </div>
            )}
            <p className="text-xs text-gray-600 mb-3">
              Paste UPCs below (one per line), or use the table filter + “Add search text to list.” Vendor is
              resolved from existing rows. Duplicates ignored. Deletes every MAP row for each UPC (all vendors
              if multiple exist).
            </p>
            {searchTerm.trim() && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={handleAddSearchTextToQueue}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Add search text to list
                </button>
              </div>
            )}

            <div className="border-t border-[#81B81D]/40 pt-4">
              <label htmlFor="queue-bulk" className="block text-sm font-medium text-gray-800 mb-1">
                Paste many UPCs (one per line)
              </label>
              <p className="text-xs text-gray-600 mb-2">
                One UPC per line. If you paste CSV, only the first column is used as the UPC.
              </p>
              <textarea
                id="queue-bulk"
                rows={5}
                value={queueBulkText}
                onChange={(e) => setQueueBulkText(e.target.value)}
                placeholder={'673088508890\n673088508906\n673088508913'}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddPastedLinesToDeleteQueue}
                  className="rounded-md bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-900"
                >
                  Add pasted lines to list
                </button>
                <span className="text-xs text-gray-500">
                  {queueBulkText.split(/\r?\n/).filter((l) => l.trim().length > 0).length} non-empty lines
                </span>
              </div>
            </div>

            {deleteQueue.length > 0 && (
              <div className="mt-3">
                <div className="flex flex-wrap gap-2 mb-2">
                  {deleteQueue.map((upc) => (
                    <span
                      key={upc}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-mono border border-gray-200"
                    >
                      {upc}
                      <button
                        type="button"
                        onClick={() => removeFromDeleteQueue(upc)}
                        className="ml-1 text-gray-500 hover:text-red-600"
                        aria-label={`Remove ${upc}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={clearDeleteQueue}
                    className="text-sm text-gray-600 underline hover:text-gray-900"
                  >
                    Clear list
                  </button>
                  <button
                    type="button"
                    disabled={bulkDeleting}
                    onClick={handleDeleteQueuedMAPs}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {bulkDeleting ? 'Deleting…' : `Delete listed MAPs (${deleteQueue.length})`}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Search Box */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg
                className="h-5 w-5 text-gray-400"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter table by UPC (partial match)..."
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm font-mono"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                <svg
                  className="h-5 w-5 text-gray-400 hover:text-gray-600"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
          {searchTerm && (
            <div className="mt-2 text-sm text-gray-600">
              Found {totalCount} MAP entr{totalCount !== 1 ? 'ies' : 'y'} matching "{searchTerm}" (showing page {currentPage + 1})
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : maps.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchTerm ? `No MAP entries found matching "${searchTerm}"` : 'No MAP entries found'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      UPC
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Vendor
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      MAP Price
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Updated
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {maps.map((map) => (
                    <tr key={map.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-medium text-gray-900">
                        {map.upc}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {map.vendor_type.toUpperCase()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-[#404040]">
                        ${Number(map.map_price).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(map.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(map.updated_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          type="button"
                          onClick={() => handleDeleteMAP(map.upc, map.vendor_type)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
                <button
                  onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                  disabled={currentPage === 0}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-700">
                  Page {currentPage + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
                  disabled={currentPage >= totalPages - 1}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

