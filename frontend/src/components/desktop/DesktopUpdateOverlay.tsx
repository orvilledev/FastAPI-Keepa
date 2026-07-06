import { useCallback, useEffect, useState } from 'react'
import { APP_NAME } from '../../constants/app'
import { recordMfaActivity } from '../../lib/mfa'

const UPDATE_TARGET_VERSION_KEY = 'msw_desktop_update_target_version'

export type DesktopUpdatePhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'installed'
  | 'uptodate'
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
      status.phase === 'uptodate' ||
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
    // RememberLastPrivatePath already saves the correct React-Router path to localStorage.
    // Do NOT overwrite it with window.location (file:// path in Electron) — that would
    // cause a blank screen on restart because HashRouter can't match a filesystem path.
    recordMfaActivity()
    if (version) {
      localStorage.setItem(UPDATE_TARGET_VERSION_KEY, version)
    }
    setStatus((prev) => ({ ...prev, phase: 'installing', percent: 100 }))
    await window.desktop.installUpdate()
  }, [status.version])

  const handleInstallLater = useCallback(() => {
    setDismissed(true)
  }, [])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    setStatus({ phase: 'idle' })
  }, [])

  if (!visible) return null

  const percent = clampPercent(
    status.percent ??
      (status.phase === 'ready' ||
      status.phase === 'installing' ||
      status.phase === 'installed' ||
      status.phase === 'uptodate'
        ? 100
        : 0)
  )
  const indeterminate = status.phase === 'checking'

  let title = 'Checking for updates'
  let body = 'Please wait while we look for a newer version.'
  let showInstall = false
  let showInstallLater = false
  let showContinue = false

  switch (status.phase) {
    case 'checking':
      title = 'Checking for updates'
      body = 'Looking for a newer version…'
      break
    case 'downloading':
      title = 'Downloading update'
      body = status.version
        ? `Version ${status.version} is downloading. You can keep working while it finishes.`
        : 'Downloading the latest version. You can keep working while it finishes.'
      break
    case 'ready':
      title = 'Update ready to install'
      body = status.version
        ? `Version ${status.version} is ready. Install now or continue working and install later.`
        : 'The update is ready. Install now or continue working and install later.'
      showInstall = true
      showInstallLater = true
      break
    case 'installing':
      title = 'Installing update'
      body = 'MSW Overwatch will restart briefly to finish installing. Your session will be kept.'
      break
    case 'installed':
      if (status.version === '3.0.0') {
        title = 'Congratulations!'
        body =
          "You've successfully updated to Version 3.0.0 — our biggest release yet. Enjoy Keepa Import File, dark mode, and everything new."
      } else {
        title = 'Update complete'
        body = status.version
          ? `You are on the latest version (${status.version}).`
          : 'You are on the latest version.'
      }
      showContinue = true
      break
    case 'uptodate':
      title = 'You are up to date'
      body = status.version
        ? `You are already on the latest version (${status.version}).`
        : status.message || 'You are on the latest version.'
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
          <p className="mt-6 text-center text-sm text-gray-700">
            Choose <strong>Install now</strong> to restart and apply the update, or{' '}
            <strong>Install later</strong> to keep using the app.
          </p>
        )}

        {status.phase === 'installed' && (
          <p className="mt-6 text-center text-sm text-gray-700">
            {status.version === '3.0.0'
              ? 'Thank you for updating. You are still signed in and can pick up right where you left off.'
              : 'You are still signed in and can continue where you left off.'}
          </p>
        )}

        {status.phase === 'installing' && (
          <p className="mt-6 text-center text-sm text-amber-700">
            Please wait — the app will reopen automatically in a few seconds.
          </p>
        )}

        <div className="mt-8 flex flex-col gap-3">
          {showInstall && (
            <button
              type="button"
              onClick={() => void handleInstall()}
              className="w-full rounded-lg bg-purple-600 px-4 py-3 text-sm font-semibold text-white hover:bg-purple-700"
            >
              Install now
            </button>
          )}
          {showInstallLater && (
            <button
              type="button"
              onClick={handleInstallLater}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Install later
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
