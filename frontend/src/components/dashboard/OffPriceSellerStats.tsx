import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { dashboardApi } from '../../services/api'
import type { OffPriceSellerStats as OffPriceSellerStatsType } from '../../types'

export default function OffPriceSellerStats() {
  const [stats, setStats] = useState<OffPriceSellerStatsType | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadStats = async (isInitialLoad: boolean = false) => {
      try {
        setError(null)
        if (isInitialLoad) {
          setInitialLoading(true)
        } else {
          setRefreshing(true)
        }
        const data = await dashboardApi.getOffPriceSellerStats()
        setStats(data)
      } catch (err: any) {
        console.error('Failed to load off-price seller stats:', err)
        setError(err?.response?.data?.detail || err?.message || 'Failed to load off-price seller stats')
      } finally {
        if (isInitialLoad) {
          setInitialLoading(false)
        } else {
          setRefreshing(false)
        }
      }
    }

    loadStats(true)
    const interval = setInterval(loadStats, 60000)
    return () => clearInterval(interval)
  }, [])

  if (initialLoading && !stats) {
    return (
      <div className="card p-4">
        <div className="text-center text-gray-500 text-sm">Loading seller stats...</div>
      </div>
    )
  }

  const dnkCount = stats?.dnk?.distinct_seller_count ?? 0
  const clkCount = stats?.clk?.distinct_seller_count ?? 0
  const totalCount = stats?.total_distinct_sellers ?? (dnkCount + clkCount)

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Off-Price Seller Counts (Latest Daily)</h3>
        {refreshing && <span className="text-xs text-gray-400">Updating...</span>}
      </div>
      {error && (
        <div className="mb-3 text-xs text-red-600">
          Error refreshing seller stats: {error}
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Link
          to="/dnk-daily-run"
          className="group hover:bg-indigo-50 rounded-lg p-3 transition-colors border border-transparent hover:border-indigo-200"
        >
          <div className="text-xs text-gray-500 mb-1">DNK Sellers</div>
          <div className="text-2xl font-bold text-[#0B1020] group-hover:text-[#1a2235]">{dnkCount}</div>
        </Link>
        <Link
          to="/clk-daily-run"
          className="group hover:bg-blue-50 rounded-lg p-3 transition-colors border border-transparent hover:border-blue-200"
        >
          <div className="text-xs text-gray-500 mb-1">CLK Sellers</div>
          <div className="text-2xl font-bold text-[#0B1020] group-hover:text-[#1a2235]">{clkCount}</div>
        </Link>
        <div className="rounded-lg p-3 border border-gray-200 bg-gray-50">
          <div className="text-xs text-gray-500 mb-1">Total Distinct</div>
          <div className="text-2xl font-bold text-[#0B1020]">{totalCount}</div>
        </div>
      </div>
    </div>
  )
}

