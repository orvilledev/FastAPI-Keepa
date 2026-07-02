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
      ? ` · ${status.progress_percent}% complete`
      : ''
  return `Cannot download at the moment — the app is busy building a Keepa file for ${vendor}${who}${pct}. Please wait until it finishes.`
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
    startDownload,
    cancelBuild,
    clearMessages: clearBuildMessages,
    loadHistory,
    downloadFromHistory,
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

  // Default vendor dropdown to the active build on page open; otherwise stay on DNK.
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

  const openSettingsModal = () => {
    if (schedulerSettings) {
      setSettingsForm({
        timezone: schedulerSettings.timezone,
        hour: schedulerSettings.hour,
        minute: schedulerSettings.minute,
        run_mode: schedulerSettings.run_mode,
        custom_days: schedulerSettings.custom_days || [],
        anchor_date: schedulerSettings.anchor_date || null,
        email_recipients: schedulerSettings.email_recipients || '',
        email_bcc_recipients: schedulerSettings.email_bcc_recipients || '',
        off_price_timezone: schedulerSettings.off_price_timezone || 'America/Chicago',
        off_price_hour: schedulerSettings.off_price_hour ?? 7,
        off_price_minute: schedulerSettings.off_price_minute ?? 0,
        off_price_run_mode: schedulerSettings.off_price_run_mode || 'daily',
        off_price_custom_days: schedulerSettings.off_price_custom_days || [],
        off_price_anchor_date: schedulerSettings.off_price_anchor_date || null,
        off_price_email_recipients: schedulerSettings.off_price_email_recipients || '',
        off_price_email_bcc_recipients: schedulerSettings.off_price_email_bcc_recipients || '',
        off_price_send_after_build: schedulerSettings.off_price_send_after_build ?? true,
      })
    }
    setShowSettingsModal(true)
  }

  const handleSaveSchedulerSettings = async () => {
    setSavingSettings(true)
    setError(null)
    try {
      await keepaImportExportApi.updateSchedulerSettings(category, {
        ...settingsForm,
        enabled: schedulerSettings?.enabled ?? false,
      })
      await loadSchedulerSettings(category)
      await loadNextRun(category)
      await loadOffPriceNextRun(category)
      setShowSettingsModal(false)
      setInfo('Keepa Import schedule saved.')
    } catch (e) {
      console.error(e)
      setError(extractDetail(e, 'Could not save scheduler settings.'))
    } finally {
      setSavingSettings(false)
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
      setInfo(next ? 'Scheduled Keepa Import builds enabled.' : 'Scheduled Keepa Import builds stopped.')
    } catch (e) {
      console.error(e)
      setError(extractDetail(e, 'Could not update the schedule.'))
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
      setInfo(
        next
          ? 'Scheduled off-price MAP reports enabled.'
          : 'Scheduled off-price MAP reports stopped.',
      )
    } catch (e) {
      console.error(e)
      setError(extractDetail(e, 'Could not update the off-price schedule.'))
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
  const busy = downloading || togglingFlag || togglingSchedule || togglingOffPriceSchedule
  const actionsDisabled = busy || countLoading || noUpcs || !enabled || blockedByOtherBuild
  const displayError = error ?? buildError
  const displayInfo = info ?? (!downloading ? buildInfo : null)
  const buildingLabel =
    downloading && buildingCategory
      ? VENDORS.find((v) => v.code === buildingCategory)?.label ?? buildingCategory.toUpperCase()
      : null

  const showProgress =
    downloading && progress && (!buildingCategory || buildingCategory === category)

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Keepa Import File</h1>
          <p className="mt-1 text-sm text-gray-500">
            Pull live Keepa data for a vendor&apos;s Manage UPCs. Download a Keepa-format Excel file
            for Daily Runs &rarr; Import Mode.
          </p>
        </div>
        {settingsLoaded && enabled && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleToggleSchedule}
              disabled={togglingSchedule || !schedulerSettings}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 ${
                schedulerSettings?.enabled
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {togglingSchedule
                ? 'Updating…'
                : schedulerSettings?.enabled
                  ? 'Stop scheduled builds'
                  : 'Start scheduled builds'}
            </button>
            <button
              type="button"
              onClick={handleToggleOffPriceSchedule}
              disabled={togglingOffPriceSchedule || !schedulerSettings}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 ${
                schedulerSettings?.off_price_enabled
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {togglingOffPriceSchedule
                ? 'Updating…'
                : schedulerSettings?.off_price_enabled
                  ? 'Stop off-price reports'
                  : 'Start off-price reports'}
            </button>
            <button
              type="button"
              onClick={openSettingsModal}
              disabled={!schedulerSettings}
              className="px-4 py-2 bg-[#404040] text-white rounded-lg hover:bg-[#3B3B3B] transition-colors text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                  clipRule="evenodd"
                />
              </svg>
              Scheduler Settings
            </button>
          </div>
        )}
      </header>

      {displayError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {displayError}
        </div>
      )}
      {displayInfo && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {displayInfo}
        </div>
      )}
      {blockedByOtherBuild && globalBusy && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {globalBusyMessage(globalBusy)}
        </div>
      )}

      {isAdmin && settingsLoaded && (
        <div className="card flex items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">Tool availability</p>
            <p className="text-xs text-gray-500">
              {enabled
                ? 'On — all users with Keepa access can use this tool.'
                : 'Off — hidden/blocked for all users.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            disabled={togglingFlag}
            role="switch"
            aria-checked={enabled}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              enabled ? 'bg-[#81B81D]' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      )}

      {settingsLoaded && enabled && schedulerSettings?.enabled && nextRun && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Next scheduled build ({vendorUpper})
          </h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Status:</span>
              <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">
                Active
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Schedule:</span>
              <span className="font-medium text-gray-900">{nextRun.scheduled_time}</span>
            </div>
            {nextRun.next_run_time_local && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Next run:</span>
                <span className="font-medium text-gray-900">{nextRun.next_run_time_local}</span>
              </div>
            )}
            <p className="text-xs text-gray-500 pt-2">
              Uses the Keepa Import API key pool only — separate from Daily Run jobs. Only one
              Keepa Import build can run at a time across all vendors; scheduled runs wait if
              another build is in progress.
            </p>
          </div>
        </div>
      )}

      {settingsLoaded && enabled && schedulerSettings?.off_price_enabled && offPriceNextRun && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Next off-price MAP report ({vendorUpper})
          </h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Status:</span>
              <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">
                Active
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Schedule:</span>
              <span className="font-medium text-gray-900">{offPriceNextRun.scheduled_time}</span>
            </div>
            {offPriceNextRun.next_run_time_local && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Next run:</span>
                <span className="font-medium text-gray-900">
                  {offPriceNextRun.next_run_time_local}
                </span>
              </div>
            )}
            <p className="text-xs text-gray-500 pt-2">
              Compares the latest completed Keepa Import file for this vendor against MAP and emails
              an off-price listing report. Uses its own recipient list — separate from Daily Run and
              from the Keepa file build email. Does not appear in Dashboard Active Runs.
              {schedulerSettings.off_price_send_after_build
                ? ' Also sent automatically after each successful build when recipients are set.'
                : ''}
            </p>
          </div>
        </div>
      )}

      {settingsLoaded && !enabled && !isAdmin ? (
        <div className="card border-amber-200/80 bg-amber-50/80 p-4 text-sm text-amber-800">
          The Keepa Import File tool is currently turned off. Please check back later.
        </div>
      ) : (
        settingsLoaded &&
        enabled && (
          <>
            <div className="card space-y-5 p-6">
              <div>
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
                  className="mt-1 block w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                >
                  {VENDORS.map(({ code, label }) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-4 py-3 text-sm text-gray-700">
                {countLoading ? (
                  <span>Checking Manage UPCs&hellip;</span>
                ) : upcCount === null ? (
                  <span>UPC count unavailable.</span>
                ) : (
                  <span>
                    <span className="font-semibold text-gray-900">{upcCount.toLocaleString()}</span>{' '}
                    UPC{upcCount === 1 ? '' : 's'} in Manage UPCs for this vendor will be used.
                  </span>
                )}
              </div>

              <p className="text-xs leading-relaxed text-gray-500">
                Only UPCs on the Manage UPCs list are fetched from Keepa. We pull the buy-box winner
                cheaply for every UPC, then automatically re-check just the ones still missing data
                so the file fills in like a manual Keepa export — without a full seller scan. Large
                lists may take a few minutes.
              </p>

              {downloading && buildInfo && (
                <div className="card border-[#81B81D]/55 bg-[#81B81D]/10 p-4">
                  <p className="text-sm text-[#111827]">{buildInfo}</p>
                </div>
              )}

              {downloading && buildingLabel && buildingCategory !== category && (
                <p className="text-xs text-gray-500">
                  A Keepa file is still building for {buildingLabel}
                  {progress ? ` (${progress.percent}%)` : ''}. Switch back to that vendor to follow
                  progress.
                </p>
              )}

              {showProgress && (
                <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50/50 p-4">
                  <BatteryProgress percent={progress.percent} />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-xs font-medium text-gray-700">
                      {progress.percent}% ({progress.completed.toLocaleString()}/
                      {progress.total.toLocaleString()} UPCs with data)
                    </p>
                    <p className="text-xs text-gray-500">{progress.message}</p>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={actionsDisabled}
                  className="btn-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:transform-none disabled:hover:shadow-sm"
                >
                  {downloading
                    ? buildingCategory === category
                      ? 'Building file…'
                      : 'Build in progress…'
                    : blockedByOtherBuild
                      ? 'Build in progress elsewhere'
                      : 'Download Keepa file'}
                </button>

                {downloading && (
                  <button
                    type="button"
                    onClick={handleStopBuild}
                    disabled={cancelling}
                    className="inline-flex items-center justify-center rounded-lg border border-red-300 bg-white px-6 py-2.5 text-sm font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cancelling ? 'Stopping…' : 'Stop build'}
                  </button>
                )}
              </div>

              {noUpcs && (
                <p className="text-xs text-amber-700">
                  Add UPCs in Manage UPCs for this vendor before running.
                </p>
              )}
            </div>

            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-700">Build history</h2>
                  <p className="text-xs text-gray-500">
                    Shared with everyone who has Keepa access. Each build logs who started it.
                    Finished files stay here for re-download.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadHistory()}
                  disabled={historyLoading}
                  className="text-xs font-medium text-[#404040] hover:underline disabled:opacity-50"
                >
                  {historyLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {historyLoading && history.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500">Loading build history…</p>
              ) : history.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500">No builds yet. Start one above.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                          Vendor
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                          Built by
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                          UPCs
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                          Started
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                          Finished
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {history.map((item) => (
                        <tr key={item.id} className="transition-colors hover:bg-gray-50/50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {vendorLabel(item.category)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {item.created_by_name?.trim() || 'Unknown user'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass(item.status)}`}
                            >
                              {item.status === 'building'
                                ? `Building · ${item.progress_percent}%`
                                : statusLabel(item.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {item.status === 'building'
                              ? `${item.completed_upcs.toLocaleString()} / ${item.upc_count.toLocaleString()}`
                              : item.upc_count.toLocaleString()}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                            {formatWhen(item.created_at)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                            {formatWhen(item.completed_at)}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {item.status === 'complete' ? (
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <button
                                  type="button"
                                  onClick={() => setContentsItem(item)}
                                  className="font-semibold text-[#404040] hover:text-[#3B3B3B] hover:underline"
                                >
                                  View contents
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void downloadFromHistory(item)}
                                  disabled={historyBusyId === item.id}
                                  className="font-semibold text-[#404040] hover:text-[#3B3B3B] hover:underline disabled:opacity-50"
                                >
                                  {historyBusyId === item.id ? 'Downloading…' : 'Download report'}
                                </button>
                              </div>
                            ) : item.status === 'building' ? (
                              <span className="text-xs text-gray-500">In progress</span>
                            ) : item.status === 'cancelled' ? (
                              <span className="text-xs text-gray-500">Cancelled</span>
                            ) : item.status === 'failed' ? (
                              <span
                                className="text-xs font-medium text-red-600"
                                title={item.error ?? undefined}
                              >
                                Failed
                              </span>
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
        title="Scheduler Settings"
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
