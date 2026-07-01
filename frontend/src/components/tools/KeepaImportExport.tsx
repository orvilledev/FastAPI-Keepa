import { useCallback, useEffect, useState } from 'react'
import { keepaImportExportApi } from '../../services/api'
import { useKeepaImportBuild } from '../../contexts/KeepaImportBuildContext'
import { BatteryProgress } from '../common/BatteryProgress'
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

export default function KeepaImportExport() {
  const { userInfo, isSuperadmin } = useUser()
  const isAdmin = userInfo?.role === 'admin' || isSuperadmin

  const [category, setCategory] = useState<string>('dnk')
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
  const busy = downloading || togglingFlag
  const actionsDisabled = busy || countLoading || noUpcs || !enabled
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
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Keepa Import File</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pull live Keepa data for a vendor&apos;s Manage UPCs. Download a Keepa-format Excel file
          for Daily Runs &rarr; Import Mode.
        </p>
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
                  onChange={(e) => setCategory(e.target.value)}
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
                          File
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
                              <button
                                type="button"
                                onClick={() => void downloadFromHistory(item)}
                                disabled={historyBusyId === item.id}
                                className="font-semibold text-[#404040] hover:text-[#3B3B3B] hover:underline disabled:opacity-50"
                              >
                                {historyBusyId === item.id ? 'Downloading…' : 'Download →'}
                              </button>
                            ) : item.status === 'building' ? (
                              <span className="text-xs text-gray-500">In progress</span>
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
    </div>
  )
}
