import { useCallback, useEffect, useState } from 'react'
import { APP_NAME } from '../../constants/app'

const UPDATE_TARGET_VERSION_KEY = 'msw_desktop_update_target_version'

export type DesktopUpdatePhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'installed'
  | 'error'

export type DesktopUpdateStatus = {
  phase: DesktopUpdatePhase
  percent?: number
  version?: string
  message?: string
}

function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function BatteryProgress({ percent, indeterminate = false }: { percent: number; indeterminate?: boolean }) {
  const fill = clampPercent(percent)
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative flex h-16 w-56 items-center rounded-xl border-2 border-gray-300 bg-gray-100 p-1.5 shadow-inner">
        <div
          className={`h-full rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 transition-[width] duration-300 ease-out ${
            indeterminate ? 'animate-pulse w-1/3' : ''
          }`}
          style={indeterminate ? undefined : { width: `${fill}%` }}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-lg font-bold text-gray-800">
          {indeterminate ? '…' : `${fill}%`}
        </span>
        <div
          className="absolute -right-2 top-1/2 h-8 w-2 -translate-y-1/2 rounded-r-sm border-2 border-l-0 border-gray-300 bg-gray-200"
          aria-hidden
        />
      </div>
    </div>
  )
}

export default function DesktopUpdateOverlay() {
  const isElectron = Boolean(window.desktop?.isElectron)
  const [status, setStatus] = useState<DesktopUpdateStatus>({ phase: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  const applyStatus = useCallback((payload: DesktopUpdateStatus) => {
    if (payload.phase === 'idle') return
    setDismissed(false)
    setStatus(payload)
  }, [])

  const visible =
    isElectron &&
    !dismissed &&
    status.phase !== 'idle' &&
    (status.phase === 'checking' ||
      status.phase === 'downloading' ||
      status.phase === 'ready' ||
      status.phase === 'installing' ||
      status.phase === 'installed' ||
      status.phase === 'error')

  useEffect(() => {
    if (!window.desktop?.onUpdateStatus) return undefined
    return window.desktop.onUpdateStatus(applyStatus)
  }, [applyStatus])

  useEffect(() => {
    if (!window.desktop?.getUpdateStatus) return
    void window.desktop.getUpdateStatus().then((payload) => {
      if (payload?.phase && payload.phase !== 'idle') {
        applyStatus(payload)
      }
    })
  }, [applyStatus])

  useEffect(() => {
    if (!window.desktop?.getVersion) return
    const target = localStorage.getItem(UPDATE_TARGET_VERSION_KEY)
    if (!target) return
    void window.desktop.getVersion().then((current) => {
      if (current === target) {
        setDismissed(false)
        setStatus({ phase: 'installed', percent: 100, version: current })
        localStorage.removeItem(UPDATE_TARGET_VERSION_KEY)
      }
    })
  }, [])

  const handleInstall = useCallback(async () => {
    if (!window.desktop?.installUpdate) return
    const version = status.version
    if (version) {
      localStorage.setItem(UPDATE_TARGET_VERSION_KEY, version)
    }
    setStatus((prev) => ({ ...prev, phase: 'installing', percent: 100 }))
    await window.desktop.installUpdate()
  }, [status.version])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    setStatus({ phase: 'idle' })
  }, [])

  if (!visible) return null

  const percent = clampPercent(status.percent ?? (status.phase === 'ready' || status.phase === 'installing' ? 100 : 0))
  const indeterminate = status.phase === 'checking'

  let title = 'Checking for updates'
  let body = 'Please wait while we look for a newer version.'
  let showInstall = false
  let showContinue = false

  switch (status.phase) {
    case 'checking':
      title = 'Checking for updates'
      body = 'Looking for a newer version of MSW Overwatch…'
      break
    case 'downloading':
      title = 'Downloading update'
      body = status.version
        ? `Version ${status.version} is downloading. Keep this window open.`
        : 'Downloading the latest version. Keep this window open.'
      break
    case 'ready':
      title = 'Update ready to install'
      body = status.version
        ? `Version ${status.version} has finished downloading.`
        : 'The update has finished downloading.'
      showInstall = true
      break
    case 'installing':
      title = 'Installing update'
      body = 'MSW Overwatch will restart in a moment to complete the installation.'
      break
    case 'installed':
      title = 'Update installed'
      body = status.version
        ? `You are now on version ${status.version}.`
        : 'The update was installed successfully.'
      showContinue = true
      break
    case 'error':
      title = 'Update failed'
      body = status.message || 'Something went wrong while updating.'
      showContinue = true
      break
    default:
      break
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-update-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-purple-600">
          {APP_NAME} Desktop
        </p>
        <h2 id="desktop-update-title" className="mt-2 text-center text-xl font-bold text-gray-900">
          {title}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">{body}</p>

        <div className="mt-8">
          <BatteryProgress percent={percent} indeterminate={indeterminate} />
        </div>

        {status.phase === 'ready' && (
          <ul className="mt-6 space-y-2 text-sm text-gray-700">
            <li>1. Click <strong>Install and restart</strong> below.</li>
            <li>2. Wait for the app to close and reopen automatically.</li>
            <li>3. Sign in again if prompted after the restart.</li>
          </ul>
        )}

        {status.phase === 'installed' && (
          <ul className="mt-6 space-y-2 text-sm text-gray-700">
            <li>• You can continue using the app normally.</li>
            <li>• Warehouse stations: open <strong>Label Station</strong> from the sidebar.</li>
            <li>• If anything looks wrong, use <strong>Check for Updates</strong> in the sidebar.</li>
          </ul>
        )}

        {status.phase === 'installing' && (
          <p className="mt-6 text-center text-sm text-amber-700">
            Do not close the app manually — it will restart on its own.
          </p>
        )}

        <div className="mt-8 flex flex-col gap-3">
          {showInstall && (
            <button
              type="button"
              onClick={() => void handleInstall()}
              className="w-full rounded-lg bg-purple-600 px-4 py-3 text-sm font-semibold text-white hover:bg-purple-700"
            >
              Install and restart
            </button>
          )}
          {showContinue && (
            <button
              type="button"
              onClick={handleDismiss}
              className="w-full rounded-lg bg-[#404040] px-4 py-3 text-sm font-semibold text-white hover:bg-gray-800"
            >
              Continue
            </button>
          )}
          {status.phase === 'error' && (
            <button
              type="button"
              onClick={handleDismiss}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
