import { useState, useEffect } from 'react'
import { upcsApi } from '../../services/api'
import type { UPC } from '../../types'

export default function UPCManagement() {
  const [upcs, setUpcs] = useState<UPC[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [upcInput, setUpcInput] = useState('')
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
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900">UPCs List</h2>
          <div className="text-sm text-gray-500">
            Showing {currentPage * limit + 1} - {Math.min((currentPage + 1) * limit, totalCount)} of {totalCount}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : upcs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No UPCs found</div>
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

