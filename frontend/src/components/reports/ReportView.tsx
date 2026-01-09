import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { reportsApi } from '../../services/api'
import type { PriceAlert } from '../../types'

export default function ReportView() {
  const { jobId } = useParams<{ jobId: string }>()
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (jobId) {
      loadAlerts()
    }
  }, [jobId])

  const loadAlerts = async () => {
    if (!jobId) return
    try {
      const data = await reportsApi.getPriceAlerts(jobId)
      setAlerts(data)
    } catch (error) {
      console.error('Failed to load alerts:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadCSV = async () => {
    if (!jobId) return
    setDownloading(true)
    try {
      const blob = await reportsApi.downloadCSV(jobId)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `keepa_report_${jobId}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Failed to download CSV:', error)
      alert('Failed to download CSV')
    } finally {
      setDownloading(false)
    }
  }

  const handleResendEmail = async () => {
    if (!jobId) return
    setSending(true)
    try {
      await reportsApi.resendEmail(jobId)
      alert('Email sent successfully')
    } catch (error) {
      console.error('Failed to send email:', error)
      alert('Failed to send email')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return <div className="text-center py-8">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <Link
            to="/jobs"
            className="text-[#0B1020] hover:text-[#1a2235] text-sm font-medium mb-2 inline-block"
          >
            ← Back to Express Jobs
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Price Alerts Report</h1>
          <p className="mt-2 text-sm text-gray-600">
            {alerts.length} price alert{alerts.length !== 1 ? 's' : ''} found
          </p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={handleResendEmail}
            disabled={sending}
            className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Resend Email'}
          </button>
          <button
            onClick={handleDownloadCSV}
            disabled={downloading}
            className="bg-[#0B1020] hover:bg-[#1a2235] text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
          >
            {downloading ? 'Downloading...' : 'Download CSV'}
          </button>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500 text-lg">No price alerts found for this job</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    UPC
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Seller Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Current Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Historical Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Price Change %
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Detected At
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {alerts.map((alert) => (
                  <tr key={alert.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {alert.upc}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {alert.seller_name || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {alert.current_price
                        ? `$${alert.current_price.toFixed(2)}`
                        : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {alert.historical_price
                        ? `$${alert.historical_price.toFixed(2)}`
                        : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {alert.price_change_percent !== undefined ? (
                        <span
                          className={
                            alert.price_change_percent < 0
                              ? 'text-red-600 font-semibold'
                              : 'text-gray-900'
                          }
                        >
                          {alert.price_change_percent.toFixed(2)}%
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(alert.detected_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

