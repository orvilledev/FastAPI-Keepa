import { useCallback, useEffect, useRef, useState } from 'react'
import {
  keepaImportExportApi,
  type KeepaImportBuildHistoryItem,
  type KeepaImportGlobalBusyStatus,
  type KeepaImportSchedulerSettings,
  type KeepaImportSchedulerStatus,
} from '../../services/api'
import { useKeepaImportBuild } from '../../contexts/KeepaImportBuildContext'
import { BatteryProgress } from '../common/BatteryProgress'
import KeepaImportBuildContentsModal from './KeepaImportBuildContentsModal'
import SchedulerSettingsModal, {
  type SchedulerSettingsFormState,
} from '../common/SchedulerSettingsModal'
import EmailRecipientsPicker, { normalizeRecipientPair } from '../jobs/EmailRecipientsPicker'
import { useUser } from '../../contexts/UserContext'

const VENDORS = [
  { code: 'dnk', label: 'DNK (Dansko)' },
  { code: 'clk', label: 'CLK (Clarks)' },
  { code: 'obz', label: 'OBZ (Oboz)' },
  { code: 'ref', label: 'REF (Reef)' },
  { code: 'bor', label: 'BOR (Born)' },
  { code: 'sff', label: 'SFF (Sofft)' },
  { code: 'tev', label: 'TEV (Teva)' },
  { code: 'cha', label: 'CHA (Chaco)' },
  { code: 'jfs', label: 'JFS (Josef Siebel)' },
] as const

function vendorLabel(code: string) {
  return VENDORS.find((v) => v.code === code)?.label ?? code.toUpperCase()
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'complete':
      return 'bg-green-100 text-green-800'
    case 'building':
      return 'bg-[#81B81D]/20 text-[#111827]'
    case 'failed':
      return 'bg-red-100 text-red-800'
    case 'cancelled':
      return 'bg-gray-100 text-gray-600'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'building':
      return 'Building'
    case 'complete':
      return 'Complete'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return status
  }
}

function globalBusyMessage(
  status: { category?: string | null; created_by_name?: string | null; progress_percent?: number | null },
) {
  const vendor = status.category ? vendorLabel(status.category) : 'another vendor'
  const who = status.created_by_name?.trim() ? ` (started by ${status.created_by_name.trim()})` : ''
  const pct =
    status.progress_percent && status.progress_percent > 0
      ? ` · ${status.progress_percent}%`
      : ''
  return `A build is already running for ${vendor}${who}${pct}. Wait for it to finish.`
}

function normalizeRecipientString(raw?: string | null) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(', ')
}

function scheduleSummary(
  settings: KeepaImportSchedulerSettings,
  prefix: '' | 'off_price_' = '',
) {
  const mode = settings[`${prefix}run_mode` as keyof KeepaImportSchedulerSettings] as string || 'daily'
  const days = (settings[`${prefix}custom_days` as keyof KeepaImportSchedulerSettings] as string[]) || []
  const frequency =
    mode === 'every_other_day'
      ? 'Every other day'
      : mode === 'custom_days' && days.length
        ? days.join(', ')
        : 'Daily'
  const hour = (settings[`${prefix}hour` as keyof KeepaImportSchedulerSettings] as number) ?? (prefix ? 7 : 6)
  const minute = (settings[`${prefix}minute` as keyof KeepaImportSchedulerSettings] as number) ?? 0
  const tz = (settings[`${prefix}timezone` as keyof KeepaImportSchedulerSettings] as string) || 'America/Chicago'
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ${tz} · ${frequency}`
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-[#81B81D]' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export default function KeepaImportExport() {
  const { userInfo, isSuperadmin } = useUser()
  const isAdmin = userInfo?.role === 'admin' || isSuperadmin

  const [category, setCategory] = useState<string>('dnk')
  const userPickedVendorRef = useRef(false)
  const [upcCount, setUpcCount] = useState<number | null>(null)
  const [countLoading, setCountLoading] = useState(false)
  const {
    building: downloading,
    buildingCategory,
    progress,
    error: buildError,
    info: buildInfo,
    history,
    historyLoading,
    historyBusyId,
    historyClearing,
    startDownload,
    cancelBuild,
    clearMessages: clearBuildMessages,
    loadHistory,
    downloadFromHistory,
    deleteHistory,
    clearAllHistory,
  } = useKeepaImportBuild()
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const [enabled, setEnabled] = useState<boolean>(true)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [togglingFlag, setTogglingFlag] = useState(false)

  const [schedulerSettings, setSchedulerSettings] = useState<KeepaImportSchedulerSettings | null>(
    null,
  )
  const [nextRun, setNextRun] = useState<KeepaImportSchedulerStatus | null>(null)
  const [offPriceNextRun, setOffPriceNextRun] = useState<KeepaImportSchedulerStatus | null>(null)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [settingsModalSections, setSettingsModalSections] = useState<'both' | 'build' | 'off-price'>(
    'both',
  )
  const [offPriceRecipients, setOffPriceRecipients] = useState('')
  const [offPriceBccRecipients, setOffPriceBccRecipients] = useState('')
  const [savingOffPriceRecipients, setSavingOffPriceRecipients] = useState(false)
  const [togglingSendAfterBuild, setTogglingSendAfterBuild] = useState(false)
  const [settingsForm, setSettingsForm] = useState<SchedulerSettingsFormState>({
    timezone: 'America/Chicago',
    hour: 6,
    minute: 0,
    run_mode: 'daily',
    custom_days: [],
    anchor_date: null,
    email_recipients: '',
    email_bcc_recipients: '',
    off_price_timezone: 'America/Chicago',
    off_price_hour: 7,
    off_price_minute: 0,
    off_price_run_mode: 'daily',
    off_price_custom_days: [],
    off_price_anchor_date: null,
    off_price_email_recipients: '',
    off_price_email_bcc_recipients: '',
    off_price_send_after_build: true,
  })
  const [savingSettings, setSavingSettings] = useState(false)
  const [contentsItem, setContentsItem] = useState<KeepaImportBuildHistoryItem | null>(null)
  const [globalBusy, setGlobalBusy] = useState<KeepaImportGlobalBusyStatus | null>(null)
  const [togglingSchedule, setTogglingSchedule] = useState(false)
  const [togglingOffPriceSchedule, setTogglingOffPriceSchedule] = useState(false)

  const vendorUpper = category.toUpperCase()

  const loadSettings = useCallback(async () => {
    try {
      const data = await keepaImportExportApi.getSettings()
      setEnabled(data.enabled)
    } catch (e) {
      console.error(e)
    } finally {
      setSettingsLoaded(true)
    }
  }, [])

  const loadCount = useCallback(async (cat: string) => {
    setCountLoading(true)
    setError(null)
    try {
      const data = await keepaImportExportApi.getCount(cat)
      setUpcCount(data.upc_count)
    } catch (e) {
      console.error(e)
      setUpcCount(null)
      setError('Could not load the UPC count for this vendor.')
    } finally {
      setCountLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    void loadCount(category)
  }, [category, loadCount])

  useEffect(() => {
    if (userPickedVendorRef.current) return

    if (buildingCategory) {
      setCategory(buildingCategory)
      return
    }

    if (globalBusy?.busy && globalBusy.category) {
      setCategory(globalBusy.category.toLowerCase())
      return
    }

    const buildingRow = history.find((item) => item.status === 'building')
    if (buildingRow?.category) {
      setCategory(buildingRow.category.toLowerCase())
    }
  }, [buildingCategory, globalBusy, history])

  const loadSchedulerSettings = useCallback(async (cat: string) => {
    try {
      const data = await keepaImportExportApi.getSchedulerSettings(cat)
      setSchedulerSettings(data)
    } catch (e) {
      console.error(e)
    }
  }, [])

  const loadNextRun = useCallback(async (cat: string) => {
    try {
      const data = await keepaImportExportApi.getSchedulerNextRun(cat)
      setNextRun(data)
    } catch (e) {
      console.error(e)
    }
  }, [])

  const loadOffPriceNextRun = useCallback(async (cat: string) => {
    try {
      const data = await keepaImportExportApi.getOffPriceSchedulerNextRun(cat)
      setOffPriceNextRun(data)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    void loadSchedulerSettings(category)
    void loadNextRun(category)
    void loadOffPriceNextRun(category)
  }, [category, loadSchedulerSettings, loadNextRun, loadOffPriceNextRun])

  useEffect(() => {
    const offPrice = normalizeRecipientPair(
      schedulerSettings?.off_price_email_recipients || '',
      schedulerSettings?.off_price_email_bcc_recipients || '',
    )
    setOffPriceRecipients(offPrice.to)
    setOffPriceBccRecipients(offPrice.bcc)
  }, [schedulerSettings, category])

  const loadGlobalBusy = useCallback(async () => {
    if (!enabled) {
      setGlobalBusy(null)
      return
    }
    try {
      const status = await keepaImportExportApi.getGlobalBuildBusy()
      setGlobalBusy(status)
    } catch (e) {
      console.error(e)
    }
  }, [enabled])

  useEffect(() => {
    if (!settingsLoaded || !enabled) return
    void loadGlobalBusy()
    const id = window.setInterval(() => void loadGlobalBusy(), 3000)
    return () => window.clearInterval(id)
  }, [settingsLoaded, enabled, loadGlobalBusy, downloading])

  const extractDetail = (e: unknown, fallback: string) =>
    (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback

  const handleToggle = async () => {
    setTogglingFlag(true)
    setError(null)
    setInfo(null)
    try {
      const next = !enabled
      const data = await keepaImportExportApi.updateSettings(next)
      setEnabled(data.enabled)
      setInfo(`Tool ${data.enabled ? 'enabled' : 'disabled'} for all users.`)
    } catch (e) {
      console.error(e)
      setError(extractDetail(e, 'Could not update the tool setting.'))
    } finally {
      setTogglingFlag(false)
    }
  }

  const populateSettingsForm = () => {
    if (!schedulerSettings) return
    const buildRecipients = normalizeRecipientPair(
      schedulerSettings.email_recipients || '',
      schedulerSettings.email_bcc_recipients || '',
    )
    const offPricePair = normalizeRecipientPair(
      schedulerSettings.off_price_email_recipients || '',
      schedulerSettings.off_price_email_bcc_recipients || '',
    )
    setSettingsForm({
      timezone: schedulerSettings.timezone,
      hour: schedulerSettings.hour,
      minute: schedulerSettings.minute,
      run_mode: schedulerSettings.run_mode,
      custom_days: schedulerSettings.custom_days || [],
      anchor_date: schedulerSettings.anchor_date || null,
      email_recipients: buildRecipients.to,
      email_bcc_recipients: buildRecipients.bcc,
      off_price_timezone: schedulerSettings.off_price_timezone || 'America/Chicago',
      off_price_hour: schedulerSettings.off_price_hour ?? 7,
      off_price_minute: schedulerSettings.off_price_minute ?? 0,
      off_price_run_mode: schedulerSettings.off_price_run_mode || 'daily',
      off_price_custom_days: schedulerSettings.off_price_custom_days || [],
      off_price_anchor_date: schedulerSettings.off_price_anchor_date || null,
      off_price_email_recipients: offPricePair.to,
      off_price_email_bcc_recipients: offPricePair.bcc,
      off_price_send_after_build: schedulerSettings.off_price_send_after_build ?? true,
    })
  }

  const openBuildSettingsModal = () => {
    populateSettingsForm()
    setSettingsModalSections('build')
    setShowSettingsModal(true)
  }

  const openOffPriceSettingsModal = () => {
    populateSettingsForm()
    setSettingsModalSections('off-price')
    setShowSettingsModal(true)
  }

  const handleSaveSchedulerSettings = async () => {
    setSavingSettings(true)
    setError(null)
    try {
      const buildRecipients = normalizeRecipientPair(
        settingsForm.email_recipients || '',
        settingsForm.email_bcc_recipients || '',
      )
      const offPricePair = normalizeRecipientPair(
        settingsForm.off_price_email_recipients || '',
        settingsForm.off_price_email_bcc_recipients || '',
      )
      await keepaImportExportApi.updateSchedulerSettings(category, {
        ...settingsForm,
        email_recipients: buildRecipients.to,
        email_bcc_recipients: buildRecipients.bcc,
        off_price_email_recipients: offPricePair.to,
        off_price_email_bcc_recipients: offPricePair.bcc,
        enabled: schedulerSettings?.enabled ?? false,
      })
      await loadSchedulerSettings(category)
      await loadNextRun(category)
      await loadOffPriceNextRun(category)
      setShowSettingsModal(false)
      setInfo('Settings saved.')
    } catch (e) {
      console.error(e)
      setError(extractDetail(e, 'Could not save settings.'))
    } finally {
      setSavingSettings(false)
    }
  }

  const handleSaveOffPriceRecipients = async () => {
    setSavingOffPriceRecipients(true)
    setError(null)
    try {
      const recipients = normalizeRecipientPair(offPriceRecipients, offPriceBccRecipients)
      await keepaImportExportApi.updateSchedulerSettings(category, {
        off_price_email_recipients: recipients.to,
        off_price_email_bcc_recipients: recipients.bcc,
      })
      await loadSchedulerSettings(category)
      setInfo(`Recipients saved for ${vendorUpper}.`)
    } catch (e) {
      console.error(e)
      setError(extractDetail(e, 'Could not save recipients.'))
    } finally {
      setSavingOffPriceRecipients(false)
    }
  }

  const handleToggleSendAfterBuild = async () => {
    if (!schedulerSettings) return
    setTogglingSendAfterBuild(true)
    setError(null)
    try {
      const next = !(schedulerSettings.off_price_send_after_build ?? true)
      await keepaImportExportApi.updateSchedulerSettings(category, {
        off_price_send_after_build: next,
      })
      await loadSchedulerSettings(category)
    } catch (e) {
      console.error(e)
      setError(extractDetail(e, 'Could not update setting.'))
    } finally {
      setTogglingSendAfterBuild(false)
    }
  }

  const handleToggleSchedule = async () => {
    if (!schedulerSettings) return
    setTogglingSchedule(true)
    setError(null)
    try {
      const next = !schedulerSettings.enabled
      await keepaImportExportApi.updateSchedulerSettings(category, { enabled: next })
      await loadSchedulerSettings(category)
      await loadNextRun(category)
    } catch (e) {
      console.error(e)
      setError(extractDetail(e, 'Could not update schedule.'))
    } finally {
      setTogglingSchedule(false)
    }
  }

  const handleToggleOffPriceSchedule = async () => {
    if (!schedulerSettings) return
    setTogglingOffPriceSchedule(true)
    setError(null)
    try {
      const next = !schedulerSettings.off_price_enabled
      await keepaImportExportApi.updateSchedulerSettings(category, { off_price_enabled: next })
      await loadSchedulerSettings(category)
      await loadOffPriceNextRun(category)
    } catch (e) {
      console.error(e)
      setError(extractDetail(e, 'Could not update schedule.'))
    } finally {
      setTogglingOffPriceSchedule(false)
    }
  }

  const handleDownload = async () => {
    setError(null)
    setInfo(null)
    clearBuildMessages()
    await startDownload(category, upcCount)
  }

  const handleStopBuild = async () => {
    setCancelling(true)
    try {
      await cancelBuild()
    } finally {
      setCancelling(false)
    }
  }

  const noUpcs = upcCount !== null && upcCount === 0
  const isOwnActiveBuild =
    downloading && buildingCategory != null && buildingCategory === category
  const blockedByOtherBuild = globalBusy?.busy === true && !isOwnActiveBuild
  const busy =
    downloading ||
    togglingFlag ||
    togglingSchedule ||
    togglingOffPriceSchedule ||
    savingOffPriceRecipients ||
    togglingSendAfterBuild
  const actionsDisabled = busy || countLoading || noUpcs || !enabled || blockedByOtherBuild
  const displayError = error ?? buildError
  const displayInfo = info ?? (!downloading ? buildInfo : null)
  const offPriceRecipientsDirty =
    normalizeRecipientString(offPriceRecipients) !==
      normalizeRecipientString(schedulerSettings?.off_price_email_recipients) ||
    normalizeRecipientString(offPriceBccRecipients) !==
      normalizeRecipientString(schedulerSettings?.off_price_email_bcc_recipients)
  const buildingLabel =
    downloading && buildingCategory
      ? VENDORS.find((v) => v.code === buildingCategory)?.label ?? buildingCategory.toUpperCase()
      : null
  const showProgress =
    downloading && progress && (!buildingCategory || buildingCategory === category)

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Keepa Import File</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Build Keepa Excel files from Manage UPCs for Daily Run import mode.
          </p>
        </div>
        {isAdmin && settingsLoaded && (
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <span>Tool {enabled ? 'on' : 'off'}</span>
            <ToggleSwitch
              checked={enabled}
              disabled={togglingFlag}
              onChange={() => void handleToggle()}
              label="Tool availability"
            />
          </label>
        )}
      </header>

      {displayError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {displayError}
        </div>
      )}
      {displayInfo && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {displayInfo}
        </div>
      )}
      {blockedByOtherBuild && globalBusy && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {globalBusyMessage(globalBusy)}
        </div>
      )}

      {settingsLoaded && !enabled && !isAdmin ? (
        <div className="card border-amber-200/80 bg-amber-50/80 p-4 text-sm text-amber-800">
          This tool is currently turned off.
        </div>
      ) : (
        settingsLoaded &&
        enabled && (
          <>
            <section className="card p-5 space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="min-w-[12rem] flex-1">
                  <label htmlFor="vendor" className="block text-sm font-medium text-gray-700">
                    Vendor
                  </label>
                  <select
                    id="vendor"
                    value={category}
                    onChange={(e) => {
                      userPickedVendorRef.current = true
                      setCategory(e.target.value)
                    }}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  >
                    {VENDORS.map(({ code, label }) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="pb-2 text-sm text-gray-600">
                  {countLoading ? (
                    'Loading UPCs…'
                  ) : upcCount === null ? (
                    'UPC count unavailable'
                  ) : (
                    <>
                      <span className="font-semibold text-gray-900">{upcCount.toLocaleString()}</span>{' '}
                      UPCs
                    </>
                  )}
                </p>
              </div>

              {showProgress && (
                <div className="space-y-2 rounded-lg bg-gray-50 px-4 py-3">
                  <BatteryProgress percent={progress.percent} />
                  <p className="text-xs text-gray-600">
                    {progress.percent}% · {progress.completed.toLocaleString()}/
                    {progress.total.toLocaleString()} UPCs · {progress.message}
                  </p>
                </div>
              )}

              {downloading && buildingLabel && buildingCategory !== category && (
                <p className="text-xs text-gray-500">
                  Build in progress for {buildingLabel}
                  {progress ? ` (${progress.percent}%)` : ''}.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={actionsDisabled}
                  className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {downloading
                    ? buildingCategory === category
                      ? 'Building…'
                      : 'Build in progress…'
                    : blockedByOtherBuild
                      ? 'Busy'
                      : 'Download Keepa file'}
                </button>
                {downloading && (
                  <button
                    type="button"
                    onClick={handleStopBuild}
                    disabled={cancelling}
                    className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {cancelling ? 'Stopping…' : 'Stop'}
                  </button>
                )}
              </div>

              {noUpcs && (
                <p className="text-xs text-amber-700">Add UPCs in Manage UPCs first.</p>
              )}
            </section>

            {schedulerSettings && (
              <section className="card divide-y divide-gray-100">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Scheduled file builds</p>
                    <p className="text-xs text-gray-500">
                      {scheduleSummary(schedulerSettings)}
                      {schedulerSettings.enabled && nextRun?.next_run_time_local
                        ? ` · Next ${nextRun.next_run_time_local}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <ToggleSwitch
                      checked={schedulerSettings.enabled}
                      disabled={togglingSchedule}
                      onChange={() => void handleToggleSchedule()}
                      label="Scheduled file builds"
                    />
                    <button
                      type="button"
                      onClick={openBuildSettingsModal}
                      className="text-sm font-medium text-[#404040] hover:underline"
                    >
                      Configure
                    </button>
                  </div>
                </div>

                <div className="px-5 py-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Off-price MAP report</p>
                      <p className="text-xs text-gray-500">
                        {scheduleSummary(schedulerSettings, 'off_price_')}
                        {schedulerSettings.off_price_enabled && offPriceNextRun?.next_run_time_local
                          ? ` · Next ${offPriceNextRun.next_run_time_local}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <ToggleSwitch
                        checked={!!schedulerSettings.off_price_enabled}
                        disabled={togglingOffPriceSchedule}
                        onChange={() => void handleToggleOffPriceSchedule()}
                        label="Scheduled off-price reports"
                      />
                      <button
                        type="button"
                        onClick={openOffPriceSettingsModal}
                        className="text-sm font-medium text-[#404040] hover:underline"
                      >
                        Schedule
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={schedulerSettings.off_price_send_after_build ?? true}
                      onChange={() => void handleToggleSendAfterBuild()}
                      disabled={togglingSendAfterBuild}
                      className="rounded border-gray-300"
                    />
                    Email off-price report after each successful build
                  </label>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      Report recipients ({vendorUpper})
                    </label>
                    <EmailRecipientsPicker
                      value={offPriceRecipients}
                      bccValue={offPriceBccRecipients}
                      onChange={setOffPriceRecipients}
                      onBccChange={setOffPriceBccRecipients}
                      onRecipientsChange={({ to, bcc }) => {
                        setOffPriceRecipients(to)
                        setOffPriceBccRecipients(bcc)
                      }}
                      disabled={savingOffPriceRecipients}
                      emptyMeansNoRecipients
                      allowVendorBcc
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveOffPriceRecipients()}
                      disabled={!offPriceRecipientsDirty || savingOffPriceRecipients}
                      className="mt-3 rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#3B3B3B] disabled:opacity-50"
                    >
                      {savingOffPriceRecipients ? 'Saving…' : 'Save recipients'}
                    </button>
                  </div>
                </div>
              </section>
            )}

            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
                <h2 className="text-sm font-semibold text-gray-900">Build history</h2>
                <div className="flex items-center gap-3 shrink-0">
                  {history.some((item) => item.status !== 'building') && (
                    <button
                      type="button"
                      onClick={() => void clearAllHistory()}
                      disabled={historyLoading || historyClearing || historyBusyId !== null}
                      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {historyClearing ? 'Clearing…' : 'Clear history'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void loadHistory()}
                    disabled={historyLoading || historyClearing}
                    className="text-xs font-medium text-[#404040] hover:underline disabled:opacity-50"
                  >
                    {historyLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              </div>

              {historyLoading && history.length === 0 ? (
                <p className="px-5 py-6 text-sm text-gray-500">Loading…</p>
              ) : history.length === 0 ? (
                <p className="px-5 py-6 text-sm text-gray-500">No builds yet.</p>
              ) : (
                <div className="app-table-scroll overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-100">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Vendor', 'Built by', 'Status', 'UPCs', 'Started', 'Finished', ''].map(
                          (col) => (
                            <th
                              key={col || 'actions'}
                              className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                            >
                              {col}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 bg-white">
                      {history.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50/50">
                          <td className="px-4 py-2.5 text-sm font-medium text-gray-900">
                            {vendorLabel(item.category)}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-gray-600">
                            {item.created_by_name?.trim() || '—'}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(item.status)}`}
                            >
                              {item.status === 'building'
                                ? `${item.progress_percent}%`
                                : statusLabel(item.status)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-sm text-gray-600">
                            {item.status === 'building'
                              ? `${item.completed_upcs}/${item.upc_count}`
                              : item.upc_count.toLocaleString()}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-600">
                            {formatWhen(item.created_at)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-600">
                            {formatWhen(item.completed_at)}
                          </td>
                          <td className="px-4 py-2.5 text-sm">
                            {item.status === 'complete' ? (
                              <div className="flex gap-3">
                                <button
                                  type="button"
                                  onClick={() => setContentsItem(item)}
                                  className="font-medium text-[#404040] hover:underline"
                                >
                                  View
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void downloadFromHistory(item)}
                                  disabled={historyBusyId === item.id || historyClearing}
                                  className="font-medium text-[#404040] hover:underline disabled:opacity-50"
                                >
                                  {historyBusyId === item.id ? '…' : 'Download'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteHistory(item.id)}
                                  disabled={historyBusyId === item.id || historyClearing}
                                  className="font-medium text-red-600 hover:underline disabled:opacity-50"
                                >
                                  Delete
                                </button>
                              </div>
                            ) : item.status === 'failed' ? (
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-red-600" title={item.error ?? undefined}>
                                  Failed
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void deleteHistory(item.id)}
                                  disabled={historyBusyId === item.id || historyClearing}
                                  className="font-medium text-red-600 hover:underline disabled:opacity-50"
                                >
                                  Delete
                                </button>
                              </div>
                            ) : item.status === 'cancelled' ? (
                              <button
                                type="button"
                                onClick={() => void deleteHistory(item.id)}
                                disabled={historyBusyId === item.id || historyClearing}
                                className="font-medium text-red-600 hover:underline disabled:opacity-50"
                              >
                                Delete
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )
      )}

      <KeepaImportBuildContentsModal
        open={contentsItem !== null}
        item={contentsItem}
        vendorLabel={contentsItem ? vendorLabel(contentsItem.category) : ''}
        onClose={() => setContentsItem(null)}
        onDownloadReport={(item) => void downloadFromHistory(item)}
        downloading={contentsItem !== null && historyBusyId === contentsItem.id}
      />

      <SchedulerSettingsModal
        open={showSettingsModal}
        title={
          settingsModalSections === 'build'
            ? `Build schedule — ${vendorUpper}`
            : settingsModalSections === 'off-price'
              ? `Off-price schedule — ${vendorUpper}`
              : `Settings — ${vendorUpper}`
        }
        sections={settingsModalSections}
        vendorUpper={vendorUpper}
        form={settingsForm}
        onChange={setSettingsForm}
        onClose={() => setShowSettingsModal(false)}
        onSave={() => void handleSaveSchedulerSettings()}
        saving={savingSettings}
      />
    </div>
  )
}
