import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import EmailRecipientsPicker from './EmailRecipientsPicker'
import { schedulerApi } from '../../services/api'

const SUPPORTED_VENDORS = new Set(['dnk', 'clk', 'obz', 'ref', 'bor', 'sff', 'tev', 'cha'])
const EXCEL_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.xlsb']

export default function UploadedVendorDailyRun() {
  const { vendor } = useParams<{ vendor: string }>()
  const normalizedVendor = (vendor || '').toLowerCase()
  const [selectedFileName, setSelectedFileName] = useState('')
  const [parsedUpcs, setParsedUpcs] = useState<string[]>([])
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [latestUpload, setLatestUpload] = useState<{
    id: string
    filename: string
    uploaded_for_date: string
    upc_count: number
    row_count?: number
    parse_status?: 'pending' | 'processing' | 'completed' | 'failed'
    parse_error?: string | null
    parsed_at?: string | null
    created_at: string
  } | null>(null)
  const [emailRecipients, setEmailRecipients] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  if (!SUPPORTED_VENDORS.has(normalizedVendor)) {
    return (
      <div className="card p-8">
        <h1 className="text-2xl font-bold text-gray-900">Vendor not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          This uploaded-run vendor route is not configured.
        </p>
        <Link
          to="/daily-run/uploaded"
          className="inline-block mt-4 px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235]"
        >
          Back to Uploaded Runs
        </Link>
      </div>
    )
  }

  const previewUpcs = useMemo(() => parsedUpcs.slice(0, 10), [parsedUpcs])

  const scientificToIntegerString = (raw: string): string | null => {
    const m = raw.trim().toLowerCase().match(/^([+-]?\d+(?:\.\d+)?)[e]([+-]?\d+)$/)
    if (!m) return null
    const mantissaRaw = m[1]
    const exp = Number.parseInt(m[2], 10)
    if (!Number.isFinite(exp)) return null

    const sign = mantissaRaw.startsWith('-') ? '-' : ''
    const mantissa = mantissaRaw.replace(/^[+-]/, '')
    const [intPart, fracPart = ''] = mantissa.split('.')
    const digits = `${intPart}${fracPart}`.replace(/^0+/, '') || '0'
    const decimalPlaces = fracPart.length
    const shift = exp - decimalPlaces

    if (shift >= 0) {
      return `${sign}${digits}${'0'.repeat(shift)}`
    }

    const cut = digits.length + shift
    if (cut <= 0) return null
    const whole = digits.slice(0, cut)
    const fractional = digits.slice(cut)
    if (fractional.replace(/0/g, '') !== '') return null
    return `${sign}${whole}`
  }

  const normalizeUpcToken = (raw: string): string | null => {
    const cleaned = raw.trim().replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '')
    if (!cleaned) return null
    const withoutDecimal = cleaned.match(/^\d{8,14}\.0+$/) ? cleaned.split('.')[0] : cleaned
    const sciAsInt = scientificToIntegerString(withoutDecimal)
    const normalizedSource = sciAsInt ?? withoutDecimal
    const digitsOnly = normalizedSource.replace(/\D/g, '')
    if (!digitsOnly || digitsOnly.length < 8 || digitsOnly.length > 14) return null
    return digitsOnly
  }

  const extractUpcsFromText = (text: string): string[] => {
    const deduped: string[] = []
    const seen = new Set<string>()
    const lines = text.split(/\r?\n/)
    for (const line of lines) {
      const parts = line.split(/[,\t;|]/g)
      for (const part of parts) {
        const normalized = normalizeUpcToken(part)
        if (!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        deduped.push(normalized)
      }
      // Fallback: still capture raw digit spans in line.
      const matches = line.match(/\b\d{8,14}\b/g) || []
      for (const m of matches) {
        if (seen.has(m)) continue
        seen.add(m)
        deduped.push(m)
      }
    }
    return deduped
  }

  const loadLatestUpload = async (vendorCode: string) => {
    try {
      const latest = await schedulerApi.getLatestUploadedReport(vendorCode as 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha')
      if (latest.report) {
        setLatestUpload(latest.report)
      } else {
        setLatestUpload(null)
      }
    } catch {
      // non-blocking
    }
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    setError('')
    setSuccess('')
    const file = event.target.files?.[0]
    if (!file) {
      setSelectedFileName('')
      setParsedUpcs([])
      setUploadedFile(null)
      return
    }

    const lowerName = (file.name || '').toLowerCase()
    const isExcelFile = EXCEL_EXTENSIONS.some((ext) => lowerName.endsWith(ext))

    try {
      setSelectedFileName(file.name)
      setUploadedFile(file)
      if (isExcelFile) {
        // Browser preview for binary Excel files is unreliable; backend parser is authoritative.
        setParsedUpcs([])
        setSuccess(`Excel file "${file.name}" ready. UPCs will be parsed on upload.`)
      } else {
        const content = await file.text()
        const upcs = extractUpcsFromText(content)
        setParsedUpcs(upcs)
        if (upcs.length) {
          setSuccess(`Loaded ${upcs.length} UPCs from ${file.name}.`)
        } else {
          setError('Preview found no UPCs in this file. You can still upload and let the backend validate.')
        }
      }
    } catch (readErr) {
      console.error('Failed to parse uploaded file', readErr)
      setError('Could not read this file. Please try again.')
      setSelectedFileName('')
      setParsedUpcs([])
      setUploadedFile(null)
    }
  }

  const handleUploadReport = async () => {
    if (!uploadedFile) {
      setError('Select a file before uploading.')
      return
    }
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const category = normalizedVendor as 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha'
      await schedulerApi.uploadReport(uploadedFile, category)
      await schedulerApi.updateSettings({
        input_mode: 'uploaded',
        email_recipients: emailRecipients.trim() || null,
      }, category)
      await loadLatestUpload(normalizedVendor)
      setSuccess('File uploaded. Parsing started in background. Queue the run after status is Completed.')
    } catch (submitErr: any) {
      setError(submitErr?.response?.data?.detail || 'Failed to upload report.')
    } finally {
      setLoading(false)
    }
  }

  const handleQueueRun = async () => {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const category = normalizedVendor as 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha'
      await schedulerApi.updateSettings({
        input_mode: 'uploaded',
        email_recipients: emailRecipients.trim() || null,
      }, category)
      await schedulerApi.rerunUploadedReport(category)
      setSuccess('Uploaded-mode run has been queued.')
    } catch (queueErr: any) {
      setError(queueErr?.response?.data?.detail || 'Failed to queue uploaded run.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteLatestUpload = async () => {
    if (!latestUpload) return
    const confirmed = window.confirm(
      `Delete uploaded report "${latestUpload.filename}" for ${normalizedVendor.toUpperCase()}?`
    )
    if (!confirmed) return

    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const category = normalizedVendor as 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha'
      await schedulerApi.deleteUploadedReport(latestUpload.id, category)
      setLatestUpload(null)
      setSuccess('Uploaded report deleted.')
      await loadLatestUpload(normalizedVendor)
    } catch (deleteErr: any) {
      setError(deleteErr?.response?.data?.detail || 'Failed to delete uploaded report.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (SUPPORTED_VENDORS.has(normalizedVendor)) {
      void loadLatestUpload(normalizedVendor)
    }
  }, [normalizedVendor])

  useEffect(() => {
    const status = latestUpload?.parse_status
    if (status !== 'pending' && status !== 'processing') return
    const id = setInterval(() => {
      void loadLatestUpload(normalizedVendor)
    }, 2500)
    return () => clearInterval(id)
  }, [latestUpload?.id, latestUpload?.parse_status, normalizedVendor])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          {normalizedVendor.toUpperCase()} Uploaded Run
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          This page is reserved for uploaded-report daily runs for {normalizedVendor.toUpperCase()}.
        </p>
      </div>

      <div className="card p-6 border-yellow-300 bg-yellow-50">
        <h2 className="text-lg font-semibold text-yellow-900">Upload-based mode</h2>
        <p className="mt-2 text-sm text-yellow-800">
          Upload a Keepa CSV/TXT report, switch this vendor to uploaded input mode, then queue a run.
        </p>
      </div>

      <div className="card p-6 space-y-5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        )}
        {success && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</div>
        )}

        <div>
          <label htmlFor="uploaded-run-file" className="block text-sm font-medium text-gray-700 mb-2">
            Keepa report file (Excel, CSV, TXT)
          </label>
          <input
            id="uploaded-run-file"
            type="file"
            accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.CSV,.txt,.TXT,.tsv,text/plain,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-700"
          />
          {selectedFileName && (
            <p className="mt-2 text-xs text-gray-500">Loaded file: {selectedFileName}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Email recipients (optional)</label>
          <EmailRecipientsPicker value={emailRecipients} onChange={setEmailRecipients} persistDismissed />
        </div>

        {latestUpload && (
          <div className="rounded-lg border border-blue-200 p-4 bg-blue-50">
            <p className="text-sm font-semibold text-blue-900">Latest uploaded report</p>
            <p className="text-xs text-blue-800 mt-1">
              {latestUpload.filename} | {latestUpload.upc_count} UPCs | date {latestUpload.uploaded_for_date}
            </p>
            <p className="text-xs text-blue-800 mt-1">
              Parse status: <span className="font-semibold">{(latestUpload.parse_status || 'pending').toUpperCase()}</span>
              {latestUpload.row_count ? ` | Parsed rows: ${latestUpload.row_count}` : ''}
            </p>
            {latestUpload.parse_error && (
              <p className="text-xs text-red-700 mt-1">{latestUpload.parse_error}</p>
            )}
            <div className="mt-3">
              <button
                type="button"
                onClick={handleDeleteLatestUpload}
                disabled={loading}
                className="px-3 py-1.5 rounded-md border border-red-300 text-red-700 bg-white hover:bg-red-50 disabled:opacity-50 text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-gray-200 p-4 bg-gray-50">
          <p className="text-sm font-medium text-gray-900">Parsed UPCs: {parsedUpcs.length}</p>
          {previewUpcs.length > 0 && (
            <p className="mt-1 text-xs text-gray-600 font-mono">
              {previewUpcs.join(', ')}
              {parsedUpcs.length > previewUpcs.length ? ' ...' : ''}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <Link
          to="/daily-run/uploaded"
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back to Uploaded Runs
        </Link>
        <Link
          to={`/daily-run/${normalizedVendor}`}
          className="px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235]"
        >
          Open API Daily Run
        </Link>
        <button
          type="button"
          disabled={loading || !uploadedFile}
          onClick={handleUploadReport}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Submitting...' : 'Upload Report'}
        </button>
        <button
          type="button"
          disabled={loading || !latestUpload || latestUpload.parse_status !== 'completed'}
          onClick={handleQueueRun}
          className="px-4 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50"
        >
          {loading ? 'Submitting...' : 'Queue Uploaded Run'}
        </button>
      </div>
    </div>
  )
}
