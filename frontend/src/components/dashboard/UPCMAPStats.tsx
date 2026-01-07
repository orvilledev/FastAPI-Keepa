import { useState, useEffect } from 'react'
import { upcsApi, mapApi } from '../../services/api'
import { Link } from 'react-router-dom'

export default function UPCMAPStats() {
  const [upcCount, setUpcCount] = useState<number | null>(null)
  const [mapCount, setMapCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadCounts = async () => {
      try {
        setError(null)
        setLoading(true)
        
        // Load both counts in parallel
        const [upcData, mapData] = await Promise.all([
          upcsApi.getUPCCount(),
          mapApi.getMAPCount()
        ])
        
        setUpcCount(upcData.count)
        setMapCount(mapData.count)
      } catch (err: any) {
        console.error('Failed to load UPC/MAP counts:', err)
        setError(err?.response?.data?.detail || err?.message || 'Failed to load counts')
      } finally {
        setLoading(false)
      }
    }

    loadCounts()
    // Refresh every 30 seconds
    const interval = setInterval(loadCounts, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="card p-4">
        <div className="text-center text-gray-500 text-sm">Loading stats...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-4">
        <div className="text-center">
          <div className="text-red-600 text-xs font-medium mb-1">Error loading stats</div>
          <div className="text-xs text-gray-500">{error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Data Statistics</h3>
      <div className="grid grid-cols-2 gap-4">
        {/* UPC Count */}
        <Link
          to="/upcs"
          className="group hover:bg-indigo-50 rounded-lg p-3 transition-colors border border-transparent hover:border-indigo-200"
        >
          <div>
            <div className="text-xs text-gray-500 mb-1">UPCs</div>
            <div className="text-2xl font-bold text-indigo-600 group-hover:text-indigo-700">
              {upcCount !== null ? upcCount.toLocaleString() : '—'}
            </div>
          </div>
        </Link>

        {/* MAP Count */}
        <Link
          to="/map"
          className="group hover:bg-purple-50 rounded-lg p-3 transition-colors border border-transparent hover:border-purple-200"
        >
          <div>
            <div className="text-xs text-gray-500 mb-1">MAP Entries</div>
            <div className="text-2xl font-bold text-purple-600 group-hover:text-purple-700">
              {mapCount !== null ? mapCount.toLocaleString() : '—'}
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}

