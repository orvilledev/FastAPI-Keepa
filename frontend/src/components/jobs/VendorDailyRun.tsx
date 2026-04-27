import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { jobsApi, authApi, schedulerApi } from '../../services/api'
import type { SchedulerSettings } from '../../types'
import { formatRunDuration } from '../../utils/timeUtils'
import EmailRecipientsPicker from './EmailRecipientsPicker'

type VendorCode = 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha'

interface VendorDailyRunProps {
  vendor: VendorCode
}

interface DailyRunJob {
  id: string
  job_name: string
  status: string
  total_batches: number
  completed_batches: number
  initiated_by?: string
  created_at: string
  completed_at?: string
  error_message?: string
}

interface UploadedReport {
  id: string
  filename: string
  uploaded_for_date: string
  upc_count: number
  row_count?: number
  parse_status?: 'pending' | 'processing' | 'completed' | 'failed'
  parse_error?: string | null
  parsed_at?: string | null
  created_at: string
}

const WEEKDAYS = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
]

const EXCEL_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.xlsb']

/**
 * Unified Daily Run page for a vendor. Hosts both modes (API and Uploaded) on
 * the same screen; the input-mode toggle in the header switches the active mode
 * and is mutually exclusive (changing it persists to the scheduler settings).
 *
 * In `uploaded` mode the page also exposes a Keepa-file uploader plus per-upload
 * status / queue / delete controls. In that mode the scheduler skips Keepa API
 * tokens and uses the most recently uploaded report's parsed UPC + MAP data.
 */
export default function VendorDailyRun({ vendor }: VendorDailyRunProps) {
  const VENDOR_UPPER = vendor.toUpperCase()

  const [loading, setLoading] = useState(true)
  const [hasKeepaAccess, setHasKeepaAccess] = useState(false)
  const [dailyRuns, setDailyRuns] = useState<DailyRunJob[]>([])
  const [nextRun, setNextRun] = useState<any>(null)
  const [schedulerSettings, setSchedulerSettings] = useState<SchedulerSettings | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    timezone: 'America/Chicago',
    hour: 6,
    minute: 0,
    enabled: true,
    run_mode: 'daily' as 'daily' | 'every_other_day' | 'custom_days',
    custom_days: [] as string[],
    anchor_date: null as string | null,
    email_recipients: '',
  })
  const [savingSettings, setSavingSettings] = useState(false)
  const [togglingEnabled, setTogglingEnabled] = useState(false)
  const [switchingInputMode, setSwitchingInputMode] = useState(false)

  // Upload-mode state
  const [selectedFileName, setSelectedFileName] = useState('')
  const [parsedUpcs, setParsedUpcs] = useState<string[]>([])
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [latestUpload, setLatestUpload] = useState<UploadedReport | null>(null)
  const [uploadEmailRecipients, setUploadEmailRecipients] = useState('')
  const [uploading, setUploading] = useState(false)
  const [queueing, setQueueing] = useState(false)
  const [deletingUpload, setDeletingUpload] = useState(false)

  const inputMode = schedulerSettings?.input_mode === 'uploaded' ? 'uploaded' : 'api'
  const isUploadMode = inputMode === 'uploaded'

  useEffect(() => {
    checkKeepaAccess()
    loadNextRun()
    loadSchedulerSettings()
  }, [vendor])

  useEffect(() => {
    if (hasKeepaAccess) {
      loadDailyRuns()
      void loadLatestUpload()
    }
  }, [hasKeepaAccess, vendor])

  // Poll latest-upload parse status while it's still working.
  useEffect(() => {
    const status = latestUpload?.parse_status
    if (status !== 'pending' && status !== 'processing') return
    const id = setInterval(() => {
      void pollLatestUploadStatus()
    }, 1000)
    return () => clearInterval(id)
  }, [latestUpload?.id, latestUpload?.parse_status, vendor])

  const checkKeepaAccess = async () => {
    try {
      const userInfo = await authApi.getCurrentUser()
      setHasKeepaAccess(userInfo.has_keepa_access || false)
      setLoading(false)
    } catch (err) {
      console.error('Failed to check Keepa access:', err)
      setHasKeepaAccess(false)
      setLoading(false)
    }
  }

  const loadNextRun = async () => {
    try {
      const data = await schedulerApi.getNextRun(vendor)
      setNextRun(data)
    } catch (err: any) {
      console.error('Failed to load next run:', err)
    }
  }

  const loadSchedulerSettings = async () => {
    try {
      const settings = await schedulerApi.getSettings(vendor)
      const normalizedSettings: SchedulerSettings = {
        ...settings,
        run_mode: settings.run_mode || 'daily',
        input_mode: settings.input_mode || 'api',
        custom_days: settings.custom_days || [],
        anchor_date: settings.anchor_date ?? null,
        email_recipients: settings.email_recipients || '',
      }
      setSchedulerSettings(normalizedSettings)
      setSettingsForm({
        timezone: normalizedSettings.timezone,
        hour: normalizedSettings.hour,
        minute: normalizedSettings.minute,
        enabled: normalizedSettings.enabled,
        run_mode: normalizedSettings.run_mode,
        custom_days: normalizedSettings.custom_days,
        anchor_date: normalizedSettings.anchor_date ?? null,
        email_recipients: normalizedSettings.email_recipients ?? '',
      })
      setUploadEmailRecipients(normalizedSettings.email_recipients || '')
    } catch (err: any) {
      console.error('Failed to load scheduler settings:', err)
      const defaults: SchedulerSettings = {
        timezone: 'America/Chicago',
        hour: 6,
        minute: 0,
        enabled: true,
        run_mode: 'daily',
        input_mode: 'api',
        custom_days: [],
        anchor_date: null,
        email_recipients: '',
        category: vendor,
      }
      setSchedulerSettings(defaults)
      setSettingsForm({
        timezone: defaults.timezone,
        hour: defaults.hour,
        minute: defaults.minute,
        enabled: defaults.enabled,
        run_mode: defaults.run_mode,
        custom_days: defaults.custom_days,
        anchor_date: defaults.anchor_date ?? null,
        email_recipients: defaults.email_recipients ?? '',
      })
    }
  }

  const handleSaveSettings = async () => {
    try {
      setSavingSettings(true)
      setError('')
      await schedulerApi.updateSettings(settingsForm, vendor)
      await loadSchedulerSettings()
      await loadNextRun()
      setShowSettingsModal(false)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update scheduler settings')
    } finally {
      setSavingSettings(false)
    }
  }

  const openSettingsModal = () => {
    if (schedulerSettings) {
      setSettingsForm({
        timezone: schedulerSettings.timezone,
        hour: schedulerSettings.hour,
        minute: schedulerSettings.minute,
        enabled: schedulerSettings.enabled,
        run_mode: schedulerSettings.run_mode,
        custom_days: schedulerSettings.custom_days || [],
        anchor_date: schedulerSettings.anchor_date || null,
        email_recipients: schedulerSettings.email_recipients || '',
      })
    }
    setShowSettingsModal(true)
  }

  const handleToggleEnabled = async () => {
    if (!schedulerSettings) return
    const newEnabled = !schedulerSettings.enabled
    try {
      setTogglingEnabled(true)
      setError('')
      await schedulerApi.updateSettings({ enabled: newEnabled }, vendor)
      await loadSchedulerSettings()
      await loadNextRun()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to toggle scheduler')
    } finally {
      setTogglingEnabled(false)
    }
  }

  const handleInputModeChange = async (mode: 'api' | 'uploaded') => {
    if (!schedulerSettings || schedulerSettings.input_mode === mode) return
    try {
      setSwitchingInputMode(true)
      setError('')
      setSuccess('')
      await schedulerApi.updateSettings({ input_mode: mode }, vendor)
      await loadSchedulerSettings()
      await loadNextRun()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update input mode')
    } finally {
      setSwitchingInputMode(false)
    }
  }

  const toggleCustomDay = (day: string) => {
    const current = settingsForm.custom_days
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day]
    setSettingsForm({ ...settingsForm, custom_days: next })
  }

  const formatScheduledTime = () => {
    if (!schedulerSettings) {
      return '8:00 PM Taipei time'
    }
    const hour12 = schedulerSettings.hour % 12 || 12
    const ampm = schedulerSettings.hour >= 12 ? 'PM' : 'AM'
    const minuteStr = schedulerSettings.minute.toString().padStart(2, '0')
    const timezoneName = schedulerSettings.timezone.split('/').pop() || schedulerSettings.timezone
    const frequencyLabel =
      schedulerSettings.run_mode === 'every_other_day'
        ? 'every other day'
        : schedulerSettings.run_mode === 'custom_days'
          ? `on ${schedulerSettings.custom_days.join(', ') || 'selected days'}`
          : 'daily'
    return `${hour12}:${minuteStr} ${ampm} ${timezoneName} time (${frequencyLabel})`
  }

  const loadDailyRuns = async () => {
    try {
      setError('')
      const allJobs = await jobsApi.listJobs(100, 0)
      const offPricePrefix = `Daily ${VENDOR_UPPER} Off Price Report -`
      const metroPrefix = `Daily ${VENDOR_UPPER} Metro Report -`
      const uploadedPrefix = `Daily ${VENDOR_UPPER} Uploaded Report -`
      const dailyJobs = allJobs.filter((job: any) =>
        job.job_name &&
        (job.job_name.startsWith(offPricePrefix) ||
          job.job_name.startsWith(metroPrefix) ||
          job.job_name.startsWith(uploadedPrefix)),
      )
      dailyJobs.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setDailyRuns(dailyJobs)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load daily runs')
    }
  }

  // ---------------- Upload helpers ----------------

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

  const loadLatestUpload = async () => {
    try {
      const latest = await schedulerApi.getLatestUploadedReport(vendor)
      setLatestUpload(latest.report ?? null)
    } catch {
      // non-blocking
    }
  }

  const pollLatestUploadStatus = async () => {
    try {
      const latest = await schedulerApi.getLatestUploadedReportStatus(vendor)
      if (!latest.report) return
      setLatestUpload((prev) => {
        if (!prev || prev.id !== latest.report?.id) return prev
        return {
          ...prev,
          parse_status: latest.report.parse_status,
          parse_error: latest.report.parse_error,
          upc_count: latest.report.upc_count ?? prev.upc_count,
          row_count: latest.report.row_count ?? prev.row_count,
          parsed_at: latest.report.parsed_at,
        }
      })
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
      setError('Select a Keepa file before uploading.')
      return
    }
    setUploading(true)
    setError('')
    setSuccess('')
    try {
      const uploadResult = await schedulerApi.uploadReport(uploadedFile, vendor)
      // Persist the upload-mode email recipients alongside the upload action;
      // also force input_mode to 'uploaded' so the scheduler picks up the file.
      await schedulerApi.updateSettings(
        {
          input_mode: 'uploaded',
          email_recipients: uploadEmailRecipients.trim() || null,
        },
        vendor,
      )
      // Optimistic status update for snappier UX while first poll is pending.
      setLatestUpload((prev) => ({
        id: uploadResult.report_id,
        filename: uploadedFile.name,
        uploaded_for_date: new Date().toISOString().slice(0, 10),
        upc_count: 0,
        row_count: 0,
        parse_status: 'pending',
        parse_error: null,
        parsed_at: null,
        created_at: prev?.created_at || new Date().toISOString(),
      }))
      await loadLatestUpload()
      await loadSchedulerSettings()
      setSuccess('File uploaded. Parsing started in background. Queue the run after status is Completed.')
    } catch (submitErr: any) {
      setError(submitErr?.response?.data?.detail || 'Failed to upload report.')
    } finally {
      setUploading(false)
    }
  }

  const handleQueueUploadedRun = async () => {
    setQueueing(true)
    setError('')
    setSuccess('')
    try {
      await schedulerApi.rerunUploadedReport(vendor)
      await pollLatestUploadStatus()
      await loadDailyRuns()
      setSuccess('Uploaded-mode run has been queued.')
    } catch (queueErr: any) {
      setError(queueErr?.response?.data?.detail || 'Failed to queue uploaded run.')
    } finally {
      setQueueing(false)
    }
  }

  const handleDeleteLatestUpload = async () => {
    if (!latestUpload) return
    const confirmed = window.confirm(
      `Delete uploaded report "${latestUpload.filename}" for ${VENDOR_UPPER}?`,
    )
    if (!confirmed) return

    setDeletingUpload(true)
    setError('')
    setSuccess('')
    try {
      await schedulerApi.deleteUploadedReport(latestUpload.id, vendor)
      setLatestUpload(null)
      setSuccess('Uploaded report deleted.')
      await loadLatestUpload()
    } catch (deleteErr: any) {
      setError(deleteErr?.response?.data?.detail || 'Failed to delete uploaded report.')
    } finally {
      setDeletingUpload(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'processing':
        return 'bg-blue-100 text-blue-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (!hasKeepaAccess) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-gray-600">You don't have access to MSW Overwatch features.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{VENDOR_UPPER} Daily Run</h1>
          <p className="mt-1 text-sm text-gray-500">Manage and view {VENDOR_UPPER} Daily Email Runs</p>
          <p className="mt-2 text-xs text-gray-600">
            Input Mode:{' '}
            <span
              className={`px-2 py-0.5 rounded font-semibold ${
                isUploadMode ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
              }`}
            >
              {isUploadMode ? 'Uploaded' : 'API'}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="inline-flex rounded-lg border border-gray-300 overflow-hidden"
            role="group"
            aria-label="Run input mode"
          >
            <button
              type="button"
              onClick={() => handleInputModeChange('api')}
              disabled={switchingInputMode || !schedulerSettings}
              aria-pressed={!isUploadMode}
              className={`px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                !isUploadMode
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              API Run
            </button>
            <button
              type="button"
              onClick={() => handleInputModeChange('uploaded')}
              disabled={switchingInputMode || !schedulerSettings}
              aria-pressed={isUploadMode}
              className={`px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                isUploadMode
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Upload Run
            </button>
          </div>
          <button
            onClick={handleToggleEnabled}
            disabled={togglingEnabled || !schedulerSettings}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 ${
              schedulerSettings?.enabled !== false
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {togglingEnabled ? (
              'Updating...'
            ) : schedulerSettings?.enabled !== false ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                </svg>
                Stop Daily Run
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                Start Daily Run
              </>
            )}
          </button>
          <button
            onClick={openSettingsModal}
            className="px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors text-sm font-medium flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
            Scheduler Settings
          </button>
        </div>
      </div>

      {schedulerSettings?.enabled === false && (
        <div className="card p-4 bg-yellow-50 border-yellow-300">
          <div className="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-yellow-600 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-yellow-800">Daily Run is Stopped</p>
              <p className="text-sm text-yellow-700">
                The {VENDOR_UPPER} daily scheduler is currently disabled. Click "Start Daily Run" to resume.
              </p>
            </div>
          </div>
        </div>
      )}

      {nextRun && schedulerSettings?.enabled !== false && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Next Scheduled Run</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Status:</span>
              <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">Active</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Scheduled Time:</span>
              <span className="font-medium text-gray-900">{nextRun.scheduled_time}</span>
            </div>
            {nextRun.next_run_time_taipei && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Next Run:</span>
                <span className="font-medium text-gray-900">{nextRun.next_run_time_taipei}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Timezone:</span>
              <span className="font-medium text-gray-900">{nextRun.timezone}</span>
            </div>
            {nextRun.seconds_until && nextRun.seconds_until > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Time Until Next Run:</span>
                <span className="font-medium text-[#0B1020]">
                  {Math.floor(nextRun.seconds_until / 3600)}h {Math.floor((nextRun.seconds_until % 3600) / 60)}m
                </span>
              </div>
            )}
            {nextRun.message && (
              <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">{nextRun.message}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upload Configuration card -- only when input mode is set to "uploaded".
          Switching to API mode automatically hides this and the scheduler reverts
          to Keepa API-driven runs. */}
      {isUploadMode && (
        <div className="card p-6 border-amber-300 bg-amber-50/50 space-y-5">
          <div className="flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-amber-700 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            <div>
              <h2 className="text-lg font-semibold text-amber-900">Uploaded Keepa Report</h2>
              <p className="mt-1 text-sm text-amber-800">
                Upload a Keepa export file (Excel, CSV, or TXT). The system will parse it and use those UPCs and
                MAP comparisons for the next run instead of consuming Keepa API tokens. A current Keepa upload is
                <strong> required</strong> for the upload-mode run to work.
              </p>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
          )}
          {success && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</div>
          )}

          <div>
            <label htmlFor={`${vendor}-upload-file`} className="block text-sm font-medium text-gray-700 mb-2">
              Keepa report file (Excel, CSV, TXT)
            </label>
            <input
              id={`${vendor}-upload-file`}
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
            <EmailRecipientsPicker value={uploadEmailRecipients} onChange={setUploadEmailRecipients} persistDismissed />
          </div>

          {latestUpload && (
            <div className="rounded-lg border border-blue-200 p-4 bg-blue-50">
              <p className="text-sm font-semibold text-blue-900">Latest uploaded report</p>
              <p className="text-xs text-blue-800 mt-1">
                {latestUpload.filename} | {latestUpload.upc_count} UPCs | date {latestUpload.uploaded_for_date}
              </p>
              <p className="text-xs text-blue-800 mt-1">
                Parse status:{' '}
                <span className="font-semibold">{(latestUpload.parse_status || 'pending').toUpperCase()}</span>
                {latestUpload.row_count ? ` | Parsed rows: ${latestUpload.row_count}` : ''}
              </p>
              {latestUpload.parse_error && (
                <p className="text-xs text-red-700 mt-1">{latestUpload.parse_error}</p>
              )}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleDeleteLatestUpload}
                  disabled={uploading || queueing || deletingUpload}
                  className="px-3 py-1.5 rounded-md border border-red-300 text-red-700 bg-white hover:bg-red-50 disabled:opacity-50 text-sm"
                >
                  {deletingUpload ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-gray-200 p-4 bg-gray-50">
            <p className="text-sm font-medium text-gray-900">Parsed UPCs (preview): {parsedUpcs.length}</p>
            {previewUpcs.length > 0 && (
              <p className="mt-1 text-xs text-gray-600 font-mono break-all">
                {previewUpcs.join(', ')}
                {parsedUpcs.length > previewUpcs.length ? ' ...' : ''}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={uploading || queueing || deletingUpload || !uploadedFile}
              onClick={handleUploadReport}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {uploading ? 'Uploading...' : 'Upload Report'}
            </button>
            <button
              type="button"
              disabled={
                uploading ||
                queueing ||
                deletingUpload ||
                !latestUpload ||
                latestUpload.parse_status !== 'completed'
              }
              onClick={handleQueueUploadedRun}
              className="px-4 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50"
            >
              {queueing ? 'Queueing...' : 'Queue Uploaded Run Now'}
            </button>
          </div>
        </div>
      )}

      {error && !isUploadMode && (
        <div className="card p-4 bg-red-50 border-red-200">
          <div className="text-red-800">{error}</div>
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">{VENDOR_UPPER} Daily Run History</h2>
        {dailyRuns.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-gray-500 mb-4">No {VENDOR_UPPER} daily runs found yet.</div>
            <p className="text-sm text-gray-400">
              {VENDOR_UPPER} daily runs are automatically executed at {formatScheduledTime()}.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {dailyRuns.map((run) => (
              <div key={run.id} className="card p-6 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{run.job_name}</h3>
                      <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(run.status)}`}>
                        {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Created:</span>
                        <p className="font-medium text-gray-900">{formatDate(run.created_at)}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Initiated By:</span>
                        <p className="font-medium text-gray-900">{run.initiated_by || 'Daily Run'}</p>
                      </div>
                      {run.completed_at && (
                        <div>
                          <span className="text-gray-500">Completed:</span>
                          <p className="font-medium text-gray-900">{formatDate(run.completed_at)}</p>
                        </div>
                      )}
                      <div>
                        <span className="text-gray-500">Run Duration:</span>
                        <p className="font-medium text-gray-900">{formatRunDuration(run.created_at, run.completed_at)}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Progress:</span>
                        <p className="font-medium text-gray-900">
                          {run.completed_batches} / {run.total_batches} batches
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Completion:</span>
                        <p className="font-medium text-gray-900">
                          {run.total_batches > 0 ? Math.round((run.completed_batches / run.total_batches) * 100) : 0}%
                        </p>
                      </div>
                    </div>
                    {run.error_message && (
                      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-sm text-red-800">
                          <span className="font-medium">Error:</span> {run.error_message}
                        </p>
                      </div>
                    )}
                  </div>
                  <Link
                    to={`/jobs/${run.id}`}
                    className="ml-4 px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors text-sm font-medium"
                  >
                    View Details →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showSettingsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-start mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Scheduler Settings</h2>
              <button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-xs text-gray-700">
                  Input mode is managed from the API/Upload toggle on the page header.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
                <select
                  value={settingsForm.timezone}
                  onChange={(e) => setSettingsForm({ ...settingsForm, timezone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0B1020] focus:border-transparent"
                >
                  <option value="America/Chicago">America/Chicago (CST/CDT)</option>
                  <option value="America/New_York">America/New_York (EST/EDT)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                  <option value="America/Denver">America/Denver (MST/MDT)</option>
                  <option value="Asia/Taipei">Asia/Taipei</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Hour (0-23)</label>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={settingsForm.hour}
                    onChange={(e) => setSettingsForm({ ...settingsForm, hour: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0B1020] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Minute (0-59)</label>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={settingsForm.minute}
                    onChange={(e) => setSettingsForm({ ...settingsForm, minute: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0B1020] focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Frequency</label>
                <select
                  value={settingsForm.run_mode}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      run_mode: e.target.value as 'daily' | 'every_other_day' | 'custom_days',
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0B1020] focus:border-transparent"
                >
                  <option value="daily">Daily</option>
                  <option value="every_other_day">Every other day</option>
                  <option value="custom_days">Custom days</option>
                </select>
              </div>

              {settingsForm.run_mode === 'every_other_day' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                  <input
                    type="date"
                    value={settingsForm.anchor_date || ''}
                    onChange={(e) => setSettingsForm({ ...settingsForm, anchor_date: e.target.value || null })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0B1020] focus:border-transparent"
                  />
                </div>
              )}

              {settingsForm.run_mode === 'custom_days' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Run Days</label>
                  <div className="grid grid-cols-4 gap-2">
                    {WEEKDAYS.map((day) => (
                      <label key={day.value} className="inline-flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={settingsForm.custom_days.includes(day.value)}
                          onChange={() => toggleCustomDay(day.value)}
                          className="rounded border-gray-300"
                        />
                        {day.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email recipients ({VENDOR_UPPER} only)
                </label>
                <EmailRecipientsPicker
                  value={settingsForm.email_recipients || ''}
                  onChange={(value) => setSettingsForm({ ...settingsForm, email_recipients: value })}
                  disabled={savingSettings}
                />
              </div>

              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> Schedule timing and email recipients here apply to {VENDOR_UPPER} only.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowSettingsModal(false)}
                disabled={savingSettings}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors disabled:bg-gray-400"
              >
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
