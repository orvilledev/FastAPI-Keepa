import { useState, useEffect } from 'react'
import { upcsApi } from '../../services/api'
import type { UPC } from '../../types'

export default function UPCManagement() {
  const [upcs, setUpcs] = useState<UPC[]>([])
  const [allUpcs, setAllUpcs] = useState<UPC[]>([]) // Store all UPCs for filtering
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [upcInput, setUpcInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [currentPage, setCurrentPage] = useState(0)
  const [limit] = useState(100)

  useEffect(() => {
    loadUPCCount()
    loadUPCs()
  }, [currentPage])

  const loadUPCCount = async () => {
    try {
      const data = await upcsApi.getUPCCount()
      setTotalCount(data.count)
    } catch (error) {
      console.error('Failed to load UPC count:', error)
    }
  }

  const loadUPCs = async () => {
    try {
      setLoading(true)
      const data = await upcsApi.listUPCs(limit, currentPage * limit)
      setAllUpcs(data)
      // Apply search filter if there's a search term
      if (searchTerm.trim()) {
        const filtered = data.filter((upc) =>
          upc.upc.toLowerCase().includes(searchTerm.toLowerCase().trim())
        )
        setUpcs(filtered)
      } else {
        setUpcs(data)
      }
    } catch (error: any) {
      setError(error.response?.data?.detail || 'Failed to load UPCs')
    } finally {
      setLoading(false)
    }
  }

  // Filter UPCs when search term changes
  useEffect(() => {
    if (searchTerm.trim()) {
      const filtered = allUpcs.filter((upc) =>
        upc.upc.toLowerCase().includes(searchTerm.toLowerCase().trim())
      )
      setUpcs(filtered)
    } else {
      setUpcs(allUpcs)
    }
  }, [searchTerm, allUpcs])

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

      const result = await upcsApi.addUPCs(upcList)
      
      setSuccess(
        `Successfully added ${result.added} UPCs. ` +
        (result.duplicates_skipped > 0 ? `${result.duplicates_skipped} duplicates skipped. ` : '') +
        (result.invalid > 0 ? `${result.invalid} invalid UPCs. ` : '')
      )
      
      setUpcInput('')
      loadUPCCount()
      loadUPCs()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to add UPCs')
    } finally {
      setAdding(false)
    }
  }

  const handleDeleteUPC = async (upc: string) => {
    if (!confirm(`Are you sure you want to delete UPC ${upc}?`)) {
      return
    }

    try {
      await upcsApi.deleteUPC(upc)
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
      await upcsApi.deleteAllUPCs()
      setSuccess('All UPCs deleted successfully')
      setUpcs([])
      setTotalCount(0)
      setCurrentPage(0)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete all UPCs')
    }
  }

  const totalPages = Math.ceil(totalCount / limit)

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Manage UPCs</h1>
          <p className="mt-2 text-sm text-gray-600">
            Manage UPCs for daily scheduler processing. Total: {totalCount} UPCs
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
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md text-sm font-medium"
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
              placeholder="Search UPCs..."
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

