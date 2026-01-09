import { useState, useEffect, useRef } from 'react'
import { mapApi } from '../../services/api'
import type { MAP } from '../../types'

export default function MAPManagement() {
  const [maps, setMaps] = useState<MAP[]>([])
  const [allMaps, setAllMaps] = useState<MAP[]>([]) // Store all MAPs for filtering
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [mapInput, setMapInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [currentPage, setCurrentPage] = useState(0)
  const [limit] = useState(100)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Reload when page or search term changes
  useEffect(() => {
    loadMAPCount()
    loadMAPs()
  }, [currentPage, searchTerm])

  // Reset to first page when search term changes
  useEffect(() => {
    if (searchTerm.trim()) {
      setCurrentPage(0)
    }
  }, [searchTerm])

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
      const data = await mapApi.getMAPCount(searchTerm.trim() || undefined)
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
      const data = await mapApi.listMAPs(limit, currentPage * limit, searchQuery)
      if (Array.isArray(data)) {
        // Ensure map_price is a number for all entries
        const normalizedData = data.map((map) => ({
          ...map,
          map_price: typeof map.map_price === 'string' ? parseFloat(map.map_price) : map.map_price
        }))
        setAllMaps(normalizedData)
        setMaps(normalizedData)
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
      // Parse MAP entries from textarea (format: UPC,PRICE or UPC PRICE)
      const lines = mapInput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      if (lines.length === 0) {
        setError('Please enter at least one MAP entry')
        setAdding(false)
        return
      }

      const mapEntries: Array<{ upc: string; map_price: number }> = []
      const invalidLines: string[] = []

      for (const line of lines) {
        // Check if operation was cancelled
        if (abortControllerRef.current?.signal.aborted) {
          return
        }

        // Try comma-separated format: UPC,PRICE
        let upc = ''
        let price = 0

        if (line.includes(',')) {
          const parts = line.split(',').map((p) => p.trim())
          if (parts.length === 2) {
            upc = parts[0]
            price = parseFloat(parts[1])
          }
        } else {
          // Try space-separated format: UPC PRICE
          const parts = line.split(/\s+/)
          if (parts.length >= 2) {
            upc = parts[0]
            price = parseFloat(parts[parts.length - 1])
          }
        }

        if (upc && !isNaN(price) && price > 0) {
          mapEntries.push({ upc, map_price: price })
        } else {
          invalidLines.push(line)
        }
      }

      if (mapEntries.length === 0) {
        setError('No valid MAP entries found. Format: UPC,PRICE or UPC PRICE (one per line)')
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
        
        const message = `The following UPC(s) already exist in the system:\n\n${duplicateList}${moreText}\n\nDo you want to replace the existing MAP entries with the new ones?`
        
        const confirmed = window.confirm(message)
        
        if (!confirmed) {
          setError(`Upload cancelled. ${duplicateCheck.duplicate_count} duplicate UPC(s) were not replaced.`)
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
      
      // Reload data
      try {
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

  const handleDeleteMAP = async (upc: string) => {
    if (!confirm(`Are you sure you want to delete MAP entry for UPC ${upc}?`)) {
      return
    }

    try {
      await mapApi.deleteMAP(upc)
      setSuccess(`MAP entry for UPC ${upc} deleted successfully`)
      loadMAPCount()
      loadMAPs()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete MAP entry')
    }
  }

  const handleDeleteAll = async () => {
    if (!confirm('Are you sure you want to delete ALL MAP entries? This cannot be undone.')) {
      return
    }

    try {
      await mapApi.deleteAllMAPs()
      setSuccess('All MAP entries deleted successfully')
      setMaps([])
      setTotalCount(0)
      setCurrentPage(0)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete all MAP entries')
    }
  }

  const totalPages = Math.ceil(totalCount / limit)

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Manage MAP (Minimum Advertised Price)</h1>
          <p className="mt-2 text-sm text-gray-600">
            Manage Minimum Advertised Prices for UPCs. Total: {totalCount} entries
          </p>
        </div>
        {totalCount > 0 && (
          <button
            onClick={handleDeleteAll}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Delete All MAPs
          </button>
        )}
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
              MAP Entries <span className="text-gray-500">(one per line: UPC,PRICE or UPC PRICE)</span>
            </label>
            <textarea
              id="maps"
              rows={10}
              value={mapInput}
              onChange={(e) => setMapInput(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm font-mono px-3 py-2 border"
              placeholder="123456789012,29.99&#10;987654321098 39.99&#10;..."
            />
            <p className="mt-2 text-sm text-gray-500">
              {mapInput.split('\n').filter((line) => line.trim().length > 0).length} entries entered
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Format examples: "123456789012,29.99" or "123456789012 29.99" (one per line)
            </p>
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
              className="bg-[#0B1020] hover:bg-[#1a2235] disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm font-medium"
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
            <h2 className="text-lg font-semibold text-gray-900">MAP Entries List</h2>
            <div className="text-sm text-gray-500">
              Showing {currentPage * limit + 1} - {Math.min((currentPage + 1) * limit, totalCount)} of {totalCount}
            </div>
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
              placeholder="Search by UPC..."
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
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-[#0B1020]">
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
                          onClick={() => handleDeleteMAP(map.upc)}
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

