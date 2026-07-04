import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { reportsApi } from '../../services/api'
import type { ComprehensiveReportRow } from '../../types'

export default function ReportView() {
  const { jobId } = useParams<{ jobId: string }>()
  const [rows, setRows] = useState<ComprehensiveReportRow[]>([])
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
      setRows(data)
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
      <div className="app-page-header flex justify-between items-center">
        <div>
          <Link
            to="/jobs"
            className="text-[#404040] hover:text-[#3B3B3B] text-sm font-medium mb-2 inline-block"
          >
            ← Back to Express Jobs
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Price Alerts Report</h1>
          <p className="mt-2 text-sm text-gray-600">
            {rows.length} off-price row{rows.length !== 1 ? 's' : ''} found
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
            className="bg-[#404040] hover:bg-[#3B3B3B] text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
          >
            {downloading ? 'Downloading...' : 'Download CSV'}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500 text-lg">No off-price rows found for this job</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="app-table-scroll overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    UPC
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ASIN
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product Title
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Brand
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    MSRP
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Current Amazon Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Price Difference
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Seller Offer Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Seller
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Discount %
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amazon URL
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {rows.map((row, index) => (
                  <tr key={`${row.UPC}-${row.ASIN}-${index}`}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {row.UPC}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.ASIN || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 max-w-[360px] truncate" title={row['Product Title']}>
                      {row['Product Title'] || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.Brand || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.MSRP || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row['Current Amazon Price'] || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row['Price Difference'] || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row['Seller Offer Price'] || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {row.Seller || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className="text-red-600 font-semibold">{row['Discount %'] || '-'}</span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {row['Amazon URL'] && row['Amazon URL'] !== 'N/A' ? (
                        <a
                          href={row['Amazon URL']}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#404040] hover:text-[#3B3B3B] hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
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

