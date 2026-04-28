import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { upcsApi } from '../../services/api'
import type { UPC } from '../../types'

const VENDOR_CODE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

async function runChunked<T>(
  items: T[],
  worker: (item: T) => Promise<unknown>,
  chunkSize = 8
): Promise<{ ok: number; failed: number }> {
  let ok = 0
  let failed = 0
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize)
    const results = await Promise.allSettled(chunk.map((item) => worker(item)))
    for (const r of results) {
      if (r.status === 'fulfilled') ok += 1
      else failed += 1
    }
  }
  return { ok, failed }
}

export default function UPCManagement() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [category, setCategory] = useState<string>('dnk')
  const [upcs, setUpcs] = useState<UPC[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [upcInput, setUpcInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [currentPage, setCurrentPage] = useState(0)
  const [limit] = useState(100)
  const [deleteQueue, setDeleteQueue] = useState<string[]>([])
  const [queueInput, setQueueInput] = useState('')
  const [queueBulkText, setQueueBulkText] = useState('')
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const displayTitle = `Manage ${category.toUpperCase()} UPCs`
  const displayDescription = `Manage UPCs for vendor "${category.toUpperCase()}" for daily scheduler processing. Total: ${totalCount} UPCs`

  useEffect(() => {
    const fromUrl = searchParams.get('category')?.trim().toLowerCase() || ''
    if (!fromUrl) {
      setSearchParams({ category: 'dnk' }, { replace: true })
      return
    }
    if (VENDOR_CODE_RE.test(fromUrl)) {
      setCategory(fromUrl)
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    loadUPCCount()
    loadUPCs()
  }, [currentPage, category, searchTerm])

  useEffect(() => {
    setDeleteQueue([])
    setQueueInput('')
    setQueueBulkText('')
  }, [category])

  useEffect(() => {
    setCurrentPage(0)
  }, [searchTerm, category])

  const loadUPCCount = async () => {
    try {
      const data = await upcsApi.getUPCCount(category, searchTerm)
      setTotalCount(data.count)
    } catch (error) {
      console.error('Failed to load UPC count:', error)
    }
  }

  const loadUPCs = async () => {
    try {
      setLoading(true)
      const data = await upcsApi.listUPCs(limit, currentPage * limit, category, searchTerm)
      setUpcs(data)
    } catch (error: any) {
      setError(error.response?.data?.detail || 'Failed to load UPCs')
    } finally {
      setLoading(false)
    }
  }

  const handleAddUPCs = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setAdding(true)

    try {
      // Parse UPCs from textarea (one per line)
      const upcList = upcInput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      if (upcList.length === 0) {
        setError('Please enter at least one UPC')
        setAdding(false)
        return
      }

      // Ensure upcList is an array
      if (!Array.isArray(upcList)) {
        setError('Invalid UPC format')
        setAdding(false)
        return
      }

      const result = await upcsApi.addUPCs(upcList, category)
      
      // Check if there are duplicates or if nothing was added
      const duplicatesRejected = result.duplicates_rejected || 0
      const added = result.added || 0
      
      if (duplicatesRejected > 0 || (added === 0 && upcList.length > 0)) {
        // Show error message for duplicates
        let errorMessage = ''
        if (duplicatesRejected > 0) {
          errorMessage = `Failed to upload ${duplicatesRejected} duplicate UPC(s). `
          if (result.duplicate_upcs && result.duplicate_upcs.length > 0) {
            const duplicateList = result.duplicate_upcs.slice(0, 10).join(', ')
            const moreText = result.duplicate_upcs.length > 10 ? ` and ${result.duplicate_upcs.length - 10} more` : ''
            errorMessage += `Duplicate UPCs: ${duplicateList}${moreText}. `
          }
          errorMessage += 'These UPCs already exist in the system.'
        } else if (added === 0) {
          errorMessage = 'Failed to upload UPCs. All entries were rejected as duplicates or invalid.'
        }
        
        if (added > 0) {
          errorMessage += ` ${added} UPC(s) were successfully added.`
        }
        
        setError(errorMessage)
        setSuccess('')
      } else {
        // Success case
        let successMessage = `Successfully added ${added} UPC(s).`
        if (result.invalid > 0) {
          successMessage += ` ${result.invalid} invalid UPC(s) were skipped.`
        }
        setSuccess(successMessage)
        setError('')
        setUpcInput('')
      }
      
      loadUPCCount()
      loadUPCs()
    } catch (err: any) {
      console.error('Error adding UPCs:', err)
      // Handle FastAPI validation errors (422) - they have a different structure
      let errorMessage = 'Failed to add UPCs'
      if (err.response?.data) {
        const errorData = err.response.data
        // FastAPI validation errors return an array of errors
        if (Array.isArray(errorData)) {
          errorMessage = errorData.map((e: any) => e.msg || e.message || JSON.stringify(e)).join(', ')
        } else if (errorData.detail) {
          // Single error detail
          if (Array.isArray(errorData.detail)) {
            errorMessage = errorData.detail.map((e: any) => e.msg || e.message || JSON.stringify(e)).join(', ')
          } else {
            errorMessage = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail)
          }
        } else if (errorData.message) {
          errorMessage = typeof errorData.message === 'string' ? errorData.message : JSON.stringify(errorData.message)
        } else {
          errorMessage = JSON.stringify(errorData)
        }
      } else if (err.message) {
        errorMessage = err.message
      }
      setError(errorMessage)
    } finally {
      setAdding(false)
    }
  }

  const handleDeleteUPC = async (upc: string) => {
    if (!confirm(`Are you sure you want to delete UPC ${upc}?`)) {
      return
    }

    try {
      await upcsApi.deleteUPC(upc, category)
      setSuccess(`UPC ${upc} deleted successfully`)
      loadUPCCount()
      loadUPCs()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete UPC')
    }
  }

  const handleDeleteAll = async () => {
    if (!confirm('Are you sure you want to delete ALL UPCs? This cannot be undone.')) {
      return
    }

    try {
      await upcsApi.deleteAllUPCs(category)
      setSuccess(`All ${category.toUpperCase()} UPCs deleted successfully`)
      setUpcs([])
      setTotalCount(0)
      setCurrentPage(0)
      setDeleteQueue([])
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete all UPCs')
    }
  }

  const addUpcToDeleteQueue = (raw: string) => {
    const upc = raw.trim()
    if (!upc) return
    setDeleteQueue((prev) => (prev.includes(upc) ? prev : [...prev, upc]))
  }

  const handleAddQueueFromInput = () => {
    addUpcToDeleteQueue(queueInput)
    setQueueInput('')
  }

  const handleAddSearchTextToQueue = () => {
    addUpcToDeleteQueue(searchTerm)
  }

  const handleAddPastedLinesToDeleteQueue = () => {
    const lines = queueBulkText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) return
    setDeleteQueue((prev) => {
      const seen = new Set(prev)
      const next = [...prev]
      for (const upc of lines) {
        if (seen.has(upc)) continue
        seen.add(upc)
        next.push(upc)
      }
      return next
    })
    setQueueBulkText('')
  }

  const removeFromDeleteQueue = (upc: string) => {
    setDeleteQueue((prev) => prev.filter((u) => u !== upc))
  }

  const clearDeleteQueue = () => setDeleteQueue([])

  const handleDeleteQueuedUPCs = async () => {
    if (deleteQueue.length === 0) return
    if (
      !confirm(
        `Delete ${deleteQueue.length} UPC(s) from the list for ${category.toUpperCase()}? This cannot be undone.`
      )
    ) {
      return
    }
    setBulkDeleting(true)
    setError('')
    try {
      const { ok, failed } = await runChunked(deleteQueue, (upc) => upcsApi.deleteUPC(upc, category))
      setDeleteQueue([])
      setSuccess(
        failed
          ? `Deleted ${ok} UPC(s). ${failed} could not be deleted (missing or error).`
          : `Deleted ${ok} UPC(s).`
      )
      await loadUPCCount()
      await loadUPCs()
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Bulk delete failed')
    } finally {
      setBulkDeleting(false)
    }
  }

  const totalPages = Math.ceil(totalCount / limit)

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-gray-900">{displayTitle}</h1>
          <p className="mt-2 text-sm text-gray-600">
            {displayDescription}
          </p>
        </div>
        {totalCount > 0 && (
          <button
            onClick={handleDeleteAll}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Delete All UPCs
          </button>
        )}
      </div>

      {/* Add UPCs Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Add UPCs</h2>
        
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

        <form onSubmit={handleAddUPCs} className="space-y-4">
          <div>
            <label htmlFor="upcs" className="block text-sm font-medium text-gray-700">
              UPCs <span className="text-gray-500">(one per line)</span>
            </label>
            <textarea
              id="upcs"
              rows={10}
              value={upcInput}
              onChange={(e) => setUpcInput(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm font-mono px-3 py-2 border"
              placeholder="Enter UPCs, one per line..."
            />
            <p className="mt-2 text-sm text-gray-500">
              {upcInput.split('\n').filter((line) => line.trim().length > 0).length} UPCs entered
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={adding}
              className="bg-[#0B1020] hover:bg-[#1a2235] disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm font-medium"
            >
              {adding ? 'Adding...' : 'Add UPCs'}
            </button>
          </div>
        </form>
      </div>

      {/* UPCs List */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">UPCs List</h2>
            <div className="text-sm text-gray-500">
              Showing {currentPage * limit + 1} - {Math.min((currentPage + 1) * limit, totalCount)} of {totalCount}
            </div>
          </div>

          {/* Delete queue */}
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Delete list</h3>
            <p className="text-xs text-gray-600 mb-3">
              Add UPCs one at a time, paste many below, or use search + “Add search text.” Duplicates are ignored.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <input
                type="text"
                value={queueInput}
                onChange={(e) => setQueueInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddQueueFromInput()
                  }
                }}
                placeholder="UPC to add to delete list"
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleAddQueueFromInput}
                  className="rounded-md bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-900"
                >
                  Add to list
                </button>
                {searchTerm.trim() && (
                  <button
                    type="button"
                    onClick={handleAddSearchTextToQueue}
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Add search text to list
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 border-t border-amber-200/80 pt-4">
              <label htmlFor="queue-bulk-upcs" className="block text-sm font-medium text-gray-800 mb-1">
                Paste many UPCs (one per line)
              </label>
              <textarea
                id="queue-bulk-upcs"
                rows={5}
                value={queueBulkText}
                onChange={(e) => setQueueBulkText(e.target.value)}
                placeholder="Paste UPCs from a spreadsheet or file, one per line..."
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
                    onClick={handleDeleteQueuedUPCs}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {bulkDeleting ? 'Deleting…' : `Delete listed UPCs (${deleteQueue.length})`}
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
              placeholder="Search UPCs in this category (partial match)..."
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
              Found {upcs.length} UPC{upcs.length !== 1 ? 's' : ''} matching "{searchTerm}"
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : upcs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchTerm ? `No UPCs found matching "${searchTerm}"` : 'No UPCs found'}
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
                      Added
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {upcs.map((upc) => (
                    <tr key={upc.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-medium text-gray-900">
                        {upc.upc}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(upc.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => handleDeleteUPC(upc.upc)}
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

