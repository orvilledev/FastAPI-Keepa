import { useState, useEffect } from 'react'
import { upcsApi, mapApi } from '../../services/api'
import { Link } from 'react-router-dom'

export default function UPCMAPStats() {
  const [dnkUpcCount, setDnkUpcCount] = useState<number | null>(null)
  const [clkUpcCount, setClkUpcCount] = useState<number | null>(null)
  const [mapCount, setMapCount] = useState<number | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadCounts = async (isInitialLoad: boolean = false) => {
      try {
        setError(null)
        if (isInitialLoad) {
          setInitialLoading(true)
        } else {
          setRefreshing(true)
        }

        // Load all counts in parallel
        const [dnkUpcData, clkUpcData, mapData] = await Promise.all([
          upcsApi.getUPCCount('dnk'),
          upcsApi.getUPCCount('clk'),
          mapApi.getMAPCount()
        ])

        setDnkUpcCount(dnkUpcData.count)
        setClkUpcCount(clkUpcData.count)
        setMapCount(mapData.count)
      } catch (err: any) {
        console.error('Failed to load UPC/MAP counts:', err)
        setError(err?.response?.data?.detail || err?.message || 'Failed to load counts')
      } finally {
        if (isInitialLoad) {
          setInitialLoading(false)
        } else {
          setRefreshing(false)
        }
      }
    }

    loadCounts(true)
    // Refresh every 30 seconds
    const interval = setInterval(loadCounts, 30000)
    return () => clearInterval(interval)
  }, [])

  if (initialLoading && dnkUpcCount === null && clkUpcCount === null && mapCount === null) {
    return (
      <div className="card p-4">
        <div className="text-center text-gray-500 text-sm">Loading stats...</div>
      </div>
    )
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Data Statistics</h3>
        {refreshing && (
          <span className="text-xs text-gray-400">Updating...</span>
        )}
      </div>
      {error && (
        <div className="mb-3 text-xs text-red-600">
          Error refreshing stats: {error}
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        {/* DNK UPC Count */}
        <Link
          to="/upcs?category=dnk"
          className="group hover:bg-indigo-50 rounded-lg p-3 transition-colors border border-transparent hover:border-indigo-200"
        >
          <div>
            <div className="text-xs text-gray-500 mb-1">DNK UPCs</div>
            <div className="text-2xl font-bold text-[#0B1020] group-hover:text-[#1a2235]">
              {dnkUpcCount !== null ? dnkUpcCount.toLocaleString() : '—'}
            </div>
          </div>
        </Link>

        {/* CLK UPC Count */}
        <Link
          to="/upcs?category=clk"
          className="group hover:bg-blue-50 rounded-lg p-3 transition-colors border border-transparent hover:border-blue-200"
        >
          <div>
            <div className="text-xs text-gray-500 mb-1">CLK UPCs</div>
            <div className="text-2xl font-bold text-[#0B1020] group-hover:text-[#1a2235]">
              {clkUpcCount !== null ? clkUpcCount.toLocaleString() : '—'}
            </div>
          </div>
        </Link>

        {/* MAP Count */}
        <Link
          to="/map"
          className="group hover:bg-orange-50 rounded-lg p-3 transition-colors border border-transparent hover:border-orange-200"
        >
          <div>
            <div className="text-xs text-gray-500 mb-1">MAP Entries</div>
            <div className="text-2xl font-bold text-[#0B1020] group-hover:text-[#1a2235]">
              {mapCount !== null ? mapCount.toLocaleString() : '—'}
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}

