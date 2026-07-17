import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { authApi, schedulerApi } from '../../services/api'
import type { SchedulerSettings } from '../../types'
import EmailRecipientsPicker from './EmailRecipientsPicker'
import DancingCapybaraReminderModal, {
  useDailyRunCapybaraReminder,
} from '../dashboard/DancingCapybaraReminderModal'
import { useUser } from '../../contexts/UserContext'
import {
  loadReminderVendors,
  setReminderVendorEnabled,
  type ReminderVendorCode,
} from '../../lib/dailyRunReminderPrefs'
import { ensureReminderNotificationPermission } from '../../lib/dailyRunReminderNotify'

type VendorCode = 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha'

interface VendorDailyRunProps {
  vendor: VendorCode
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
 * Unified Daily Run page for a vendor. Hosts both modes (API and Import) on
 * the same screen; the input-mode toggle in the header switches the active mode
 * and is mutually exclusive (changing it persists to the scheduler settings).
 *
 * In `uploaded` mode the page also exposes a Keepa-file uploader plus per-upload
 * status / queue / delete controls. In that mode the scheduler skips Keepa API
 * tokens, keeps UPC scope from Manage UPCs, and uses uploaded report rows for
 * comparison input.
 */
export default function VendorDailyRun({ vendor }: VendorDailyRunProps) {
  const VENDOR_UPPER = vendor.toUpperCase()
  const { userInfo, authUser } = useUser()
  const userId = userInfo?.id || authUser?.id || 'anonymous'
  const [nowMs, setNowMs] = useState(Date.now())
  const [reminderVendors, setReminderVendors] = useState(() => loadReminderVendors(userId))

  const [loading, setLoading] = useState(true)
  const [hasKeepaAccess, setHasKeepaAccess] = useState(false)
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
    email_bcc_recipients: '',
    uploaded_wait_timeout_seconds: 90,
  })
  const [savingSettings, setSavingSettings] = useState(false)
  const [togglingEnabled, setTogglingEnabled] = useState(false)
  const [switchingInputMode, setSwitchingInputMode] = useState(false)

  // Upload-mode state
  const [selectedFileName, setSelectedFileName] = useState('')
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [latestUpload, setLatestUpload] = useState<UploadedReport | null>(null)
  const [uploadEmailRecipients, setUploadEmailRecipients] = useState('')
  const [uploadEmailBccRecipients, setUploadEmailBccRecipients] = useState('')
  const [savingUploadRecipients, setSavingUploadRecipients] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [queueing, setQueueing] = useState(false)
  const [deletingUpload, setDeletingUpload] = useState(false)

  // Same Day Run — one-off delay; does not change recurring schedule
  const [sameDayHours, setSameDayHours] = useState(0)
  const [sameDayMinutes, setSameDayMinutes] = useState(30)
  const [sameDayPending, setSameDayPending] = useState<{
    run_at: string
    run_at_local: string
    timezone: string
    seconds_until: number
  } | null>(null)
  const [sameDayBusy, setSameDayBusy] = useState(false)
  const [sameDayError, setSameDayError] = useState('')
  const [sameDaySuccess, setSameDaySuccess] = useState('')

  const inputMode = schedulerSettings?.input_mode === 'uploaded' ? 'uploaded' : 'api'
  const isUploadMode = inputMode === 'uploaded'
  const normalizeRecipientString = (raw?: string | null) =>
    (raw || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join(', ')
  const uploadRecipientsDirty =
    normalizeRecipientString(uploadEmailRecipients) !==
      normalizeRecipientString(schedulerSettings?.email_recipients) ||
    normalizeRecipientString(uploadEmailBccRecipients) !==
      normalizeRecipientString(schedulerSettings?.email_bcc_recipients)

  useEffect(() => {
    setReminderVendors(loadReminderVendors(userId))
  }, [userId])

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    checkKeepaAccess()
    loadNextRun()
    loadSchedulerSettings()
    void loadSameDayRun()
  }, [vendor])

  useEffect(() => {
    if (!sameDayPending) return
    const id = setInterval(() => {
      void loadSameDayRun()
    }, 15_000)
    return () => clearInterval(id)
  }, [sameDayPending?.run_at, vendor])

  useEffect(() => {
    if (hasKeepaAccess) {
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

  const loadSameDayRun = async () => {
    try {
      const data = await schedulerApi.getSameDayRun(vendor)
      setSameDayPending(data.pending)
    } catch {
      /* optional feature — ignore if backend not redeployed yet */
    }
  }

  const applySameDayPreset = (hours: number, minutes: number) => {
    setSameDayHours(hours)
    setSameDayMinutes(minutes)
    setSameDayError('')
  }

  const handleScheduleSameDayRun = async () => {
    setSameDayError('')
    setSameDaySuccess('')
    const hours = Math.max(0, Math.min(23, Number(sameDayHours) || 0))
    const minutes = Math.max(0, Math.min(59, Number(sameDayMinutes) || 0))
    if (hours === 0 && minutes === 0) {
      setSameDayError('Set at least 1 minute.')
      return
    }
    setSameDayBusy(true)
    try {
      const result = await schedulerApi.scheduleSameDayRun(vendor, {
        delay_hours: hours,
        delay_minutes: minutes,
      })
      setSameDayPending({
        run_at: result.run_at,
        run_at_local: result.run_at_local,
        timezone: result.timezone,
        seconds_until: result.seconds_until,
      })
      setSameDaySuccess(
        `${result.message} A dancing capybara will remind you within 30 minutes of that time.`,
      )
      // Opt this user into T-30 capybara for this vendor (local only).
      const nextReminders = setReminderVendorEnabled(userId, vendor as ReminderVendorCode, true)
      setReminderVendors(new Set(nextReminders))
      void ensureReminderNotificationPermission()
      setSuccess('')
    } catch (err: any) {
      setSameDayError(
        err?.response?.data?.detail || err?.message || 'Failed to schedule Same Day Run',
      )
    } finally {
      setSameDayBusy(false)
    }
  }

  const handleCancelSameDayRun = async () => {
    setSameDayError('')
    setSameDaySuccess('')
    setSameDayBusy(true)
    try {
      const result = await schedulerApi.cancelSameDayRun(vendor)
      setSameDayPending(null)
      setSameDaySuccess(result.message)
    } catch (err: any) {
      setSameDayError(
        err?.response?.data?.detail || err?.message || 'Failed to cancel Same Day Run',
      )
    } finally {
      setSameDayBusy(false)
    }
  }

  const reminderOn = reminderVendors.has(vendor as ReminderVendorCode)

  const handleToggleRemindMe = () => {
    const turningOn = !reminderOn
    const next = setReminderVendorEnabled(userId, vendor as ReminderVendorCode, turningOn)
    setReminderVendors(new Set(next))
    if (turningOn) {
      void ensureReminderNotificationPermission()
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
        email_bcc_recipients: settings.email_bcc_recipients || '',
        uploaded_wait_timeout_seconds:
          typeof settings.uploaded_wait_timeout_seconds === 'number'
            ? settings.uploaded_wait_timeout_seconds
            : 90,
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
        email_bcc_recipients: normalizedSettings.email_bcc_recipients ?? '',
        uploaded_wait_timeout_seconds:
          typeof normalizedSettings.uploaded_wait_timeout_seconds === 'number'
            ? normalizedSettings.uploaded_wait_timeout_seconds
            : 90,
      })
      setUploadEmailRecipients(normalizedSettings.email_recipients || '')
      setUploadEmailBccRecipients(normalizedSettings.email_bcc_recipients || '')
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
        email_bcc_recipients: '',
        uploaded_wait_timeout_seconds: 90,
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
        email_bcc_recipients: defaults.email_bcc_recipients ?? '',
        uploaded_wait_timeout_seconds: defaults.uploaded_wait_timeout_seconds ?? 90,
      })
    }
  }

  const handleSaveSettings = async () => {
    try {
      setSavingSettings(true)
      setError('')
      if (
        settingsForm.uploaded_wait_timeout_seconds < 0 ||
        settingsForm.uploaded_wait_timeout_seconds > 900
      ) {
        setError('Import Mode wait timeout must be between 0 and 900 seconds.')
        return
      }
      const payload = { ...settingsForm }
      await schedulerApi.updateSettings(payload, vendor)
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
        email_bcc_recipients: schedulerSettings.email_bcc_recipients || '',
        uploaded_wait_timeout_seconds:
          typeof schedulerSettings.uploaded_wait_timeout_seconds === 'number'
            ? schedulerSettings.uploaded_wait_timeout_seconds
            : 90,
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

  // ---------------- Upload helpers ----------------

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
      setUploadedFile(null)
      return
    }

    try {
      setSelectedFileName(file.name)
      setUploadedFile(file)
      const lowerName = (file.name || '').toLowerCase()
      const isExcelFile = EXCEL_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
      setSuccess(
        isExcelFile
          ? `Excel file "${file.name}" ready. Upload to parse it on the server.`
          : `File "${file.name}" ready. Upload to parse it on the server.`,
      )
    } catch (readErr) {
      console.error('Failed to parse uploaded file', readErr)
      setError('Could not read this file. Please try again.')
      setSelectedFileName('')
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
      // Force input_mode to 'uploaded' so the scheduler picks up the file.
      // Do NOT send email_recipients here — the backend filters by the current
      // user's allowed pool, which would clear recipients set by another user.
      // Recipients are only changed via the explicit "Save Recipients" button.
      await schedulerApi.updateSettings(
        { input_mode: 'uploaded' },
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
      if (uploadRecipientsDirty) {
        await schedulerApi.updateSettings(
          {
            email_recipients: uploadEmailRecipients.trim() || null,
            email_bcc_recipients: uploadEmailBccRecipients.trim() || null,
          },
          vendor,
        )
        await loadSchedulerSettings()
      }
      await schedulerApi.rerunUploadedReport(vendor)
      await pollLatestUploadStatus()
      setSuccess('Import-mode run has been queued.')
    } catch (queueErr: any) {
      setError(queueErr?.response?.data?.detail || 'Failed to queue import run.')
    } finally {
      setQueueing(false)
    }
  }

  const handleSaveUploadRecipients = async () => {
    setSavingUploadRecipients(true)
    setError('')
    setSuccess('')
    try {
      await schedulerApi.updateSettings(
        {
          email_recipients: uploadEmailRecipients.trim() || null,
          email_bcc_recipients: uploadEmailBccRecipients.trim() || null,
        },
        vendor,
      )
      await loadSchedulerSettings()
      setSuccess('Import Mode recipients saved.')
    } catch (saveErr: any) {
      setError(saveErr?.response?.data?.detail || 'Failed to save upload recipients.')
    } finally {
      setSavingUploadRecipients(false)
    }
  }

  const handleDeleteLatestUpload = async () => {
    if (!latestUpload) return
    const confirmed = window.confirm(
      `Delete imported report "${latestUpload.filename}" for ${VENDOR_UPPER}?`,
    )
    if (!confirmed) return

    setDeletingUpload(true)
    setError('')
    setSuccess('')
    try {
      await schedulerApi.deleteUploadedReport(latestUpload.id, vendor)
      setLatestUpload(null)
      setSuccess('Imported report deleted.')
      await loadLatestUpload()
    } catch (deleteErr: any) {
      setError(deleteErr?.response?.data?.detail || 'Failed to delete uploaded report.')
    } finally {
      setDeletingUpload(false)
    }
  }

  const reminderEnabledVendors = useMemo(() => {
    const next = new Set(reminderVendors)
    // Always watch this vendor for Same Day Run capybara while a one-off is pending
    if (sameDayPending) next.add(vendor as ReminderVendorCode)
    return next
  }, [reminderVendors, sameDayPending, vendor])

  const capybaraVendorData = useMemo(
    () => ({
      [vendor]: {
        category: vendor,
        enabled: schedulerSettings?.enabled !== false,
        next_run_time: nextRun?.next_run_time ?? null,
        scheduled_time: nextRun?.scheduled_time || '',
        same_day_run_at: sameDayPending?.run_at ?? null,
        same_day_run_at_local: sameDayPending?.run_at_local ?? null,
      },
    }),
    [vendor, schedulerSettings?.enabled, nextRun, sameDayPending],
  )

  const { alert: capyAlert, dismiss: dismissCapy, snooze: snoozeCapy } = useDailyRunCapybaraReminder({
    userId,
    enabledVendors: reminderEnabledVendors,
    vendorData: capybaraVendorData,
    nowMs,
  })

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
      <DancingCapybaraReminderModal alert={capyAlert} onDismiss={dismissCapy} onSnooze={snoozeCapy} />

      <div className="app-page-header flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{VENDOR_UPPER} Daily Run</h1>
          <p className="mt-1 text-sm text-gray-500">Manage and view {VENDOR_UPPER} Daily Email Runs</p>
          <p className="mt-2 text-xs text-gray-600">
            Input Mode:{' '}
            <span
              className={`px-2 py-0.5 rounded font-semibold ${
                isUploadMode ? 'bg-[#81B81D]/20 text-[#111827]' : 'bg-green-100 text-green-800'
              }`}
            >
              {isUploadMode ? 'Import' : 'API'}
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
              API Mode
            </button>
            <button
              type="button"
              onClick={() => handleInputModeChange('uploaded')}
              disabled={switchingInputMode || !schedulerSettings}
              aria-pressed={isUploadMode}
              className={`px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                isUploadMode
                  ? 'bg-[#81B81D] text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Import Mode
            </button>
          </div>
          <button
            type="button"
            onClick={handleToggleRemindMe}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
              reminderOn
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-white text-amber-900 border border-amber-300 hover:bg-amber-50'
            }`}
            title={
              reminderOn
                ? `Capybara reminder is on for ${VENDOR_UPPER} (30 min before run)`
                : `Remind me 30 minutes before ${VENDOR_UPPER} Daily Run / Same Day Run`
            }
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6z" />
              <path d="M10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
            </svg>
            {reminderOn ? 'Remind me on' : 'Remind me'}
          </button>
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
            className="px-4 py-2 bg-[#404040] text-white rounded-lg hover:bg-[#3B3B3B] transition-colors text-sm font-medium flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
            Scheduler Settings
          </button>
        </div>
      </div>

      {schedulerSettings?.enabled === false && (
        <div className="card p-4 bg-[#81B81D]/10 border-[#81B81D]/55">
          <div className="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[#111827] flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-[#111827]">Daily Run is Stopped</p>
              <p className="text-sm text-[#111827]">
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
                <span className="font-medium text-[#404040]">
                  {Math.floor(nextRun.seconds_until / 3600)}h {Math.floor((nextRun.seconds_until % 3600) / 60)}m
                </span>
              </div>
            )}
            {nextRun.message && (
              <div className="mt-2 p-3 bg-[#81B81D]/10 border border-[#81B81D]/40 rounded-lg">
                <p className="text-sm text-[#111827]">{nextRun.message}</p>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
              <p className="text-sm text-gray-600">
                {reminderOn
                  ? 'Capybara will appear ~30 minutes before this run (and Same Day Runs).'
                  : 'Turn on Remind me for a dancing capybara ~30 minutes before the run.'}
              </p>
              <button
                type="button"
                onClick={handleToggleRemindMe}
                className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  reminderOn
                    ? 'bg-amber-600 text-white hover:bg-amber-700'
                    : 'bg-amber-50 text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100'
                }`}
              >
                {reminderOn ? 'Remind me on' : 'Remind me'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Same Day Run — isolated one-off; does not change recurring schedule */}
      <div className="card p-6 border border-sky-200/80 bg-sky-50/40">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Same Day Run</h2>
            <p className="mt-1 text-sm text-gray-600">
              Schedule a one-off {VENDOR_UPPER} run after a delay you choose. Does not change your
              recurring Daily Run time, days, or enable/disable setting.
            </p>
          </div>
        </div>

        {sameDayError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {sameDayError}
          </div>
        )}
        {sameDaySuccess && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            {sameDaySuccess}
          </div>
        )}

        {sameDayPending ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-gray-600">Queued for:</span>
              <span className="font-medium text-gray-900">{sameDayPending.run_at_local}</span>
            </div>
            {sameDayPending.seconds_until > 0 && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-600">Starts in:</span>
                <span className="font-medium text-sky-800">
                  {Math.floor(sameDayPending.seconds_until / 3600)}h{' '}
                  {Math.floor((sameDayPending.seconds_until % 3600) / 60)}m
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleCancelSameDayRun()}
              disabled={sameDayBusy}
              className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              {sameDayBusy ? 'Cancelling…' : 'Cancel Same Day Run'}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              {[
                { label: '15 min', h: 0, m: 15 },
                { label: '30 min', h: 0, m: 30 },
                { label: '1 hour', h: 1, m: 0 },
                { label: '2 hours', h: 2, m: 0 },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applySameDayPreset(p.h, p.m)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    sameDayHours === p.h && sameDayMinutes === p.m
                      ? 'bg-sky-700 text-white'
                      : 'bg-white text-sky-900 ring-1 ring-sky-200 hover:bg-sky-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">Hours</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={sameDayHours}
                  onChange={(e) => setSameDayHours(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                  className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">Minutes</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={sameDayMinutes}
                  onChange={(e) =>
                    setSameDayMinutes(Math.max(0, Math.min(59, Number(e.target.value) || 0)))
                  }
                  className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleScheduleSameDayRun()}
                disabled={sameDayBusy}
                className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-800 disabled:opacity-50"
              >
                {sameDayBusy
                  ? 'Scheduling…'
                  : `Schedule in ${sameDayHours}h ${sameDayMinutes}m`}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Must fire before midnight in the vendor timezone. Uses current API or Import mode when
              it runs. A dancing capybara reminds you within 30 minutes of the Same Day start (OS
              alert if the PWA is minimized).
            </p>
          </div>
        )}
      </div>

      {/* Upload Configuration card -- only when input mode is set to "uploaded".
          Switching to API mode automatically hides this and the scheduler reverts
          to Keepa API-driven runs. */}
      {isUploadMode && (
        <div className="card p-6 border-[#81B81D]/55 bg-[#81B81D]/10 space-y-5">
          <div className="flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[#111827] flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            <div>
              <h2 className="text-lg font-semibold text-[#111827]">Imported Keepa Report</h2>
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
            <EmailRecipientsPicker
              value={uploadEmailRecipients}
              bccValue={uploadEmailBccRecipients}
              onChange={setUploadEmailRecipients}
              onBccChange={setUploadEmailBccRecipients}
              persistDismissed
              emptyMeansNoRecipients
              allowVendorBcc
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSaveUploadRecipients}
                disabled={
                  savingUploadRecipients ||
                  uploading ||
                  queueing ||
                  deletingUpload ||
                  !uploadRecipientsDirty
                }
                className="px-3 py-1.5 rounded-md border border-indigo-300 text-[#81B81D] bg-white hover:bg-indigo-50 disabled:opacity-50 text-sm font-medium"
              >
                {savingUploadRecipients ? 'Saving...' : 'Save Recipients'}
              </button>
            </div>
          </div>

          {latestUpload && (
            <div className="rounded-lg border border-blue-200 p-4 bg-blue-50">
              <p className="text-sm font-semibold text-[#81B81D]">Latest imported report</p>
              <p className="text-xs text-[#81B81D] mt-1">
                {latestUpload.filename} | {latestUpload.upc_count} UPCs | date {latestUpload.uploaded_for_date}
              </p>
              <p className="text-xs text-[#81B81D] mt-1">
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
              {queueing ? 'Queueing...' : 'Trigger Import Run Now (Express)'}
            </button>
          </div>
        </div>
      )}

      {error && !isUploadMode && (
        <div className="card p-4 bg-red-50 border-red-200">
          <div className="text-red-800">{error}</div>
        </div>
      )}

      {showSettingsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
            <div className="flex justify-between items-start mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Scheduler Settings</h2>
              <button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
                <select
                  value={settingsForm.timezone}
                  onChange={(e) => setSettingsForm({ ...settingsForm, timezone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
                  />
                </div>
              )}

              {settingsForm.run_mode === 'custom_days' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Run Days</label>
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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
                  bccValue={settingsForm.email_bcc_recipients || ''}
                  onChange={(value) => setSettingsForm({ ...settingsForm, email_recipients: value })}
                  onBccChange={(value) => setSettingsForm({ ...settingsForm, email_bcc_recipients: value })}
                  disabled={savingSettings}
                  emptyMeansNoRecipients
                  allowVendorBcc
                />
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
                className="px-4 py-2 bg-[#404040] text-white rounded-lg hover:bg-[#3B3B3B] transition-colors disabled:bg-gray-400"
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
