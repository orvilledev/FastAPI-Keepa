import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import DancingCapybara from './DancingCapybara'
import {
  DAILY_RUN_REMINDER_LEAD_SECONDS,
  clearPendingCapybaraReminder,
  clearReminderFiredForVendor,
  hasReminderFiredForRun,
  loadPendingCapybaraReminder,
  markReminderFiredForRun,
  savePendingCapybaraReminder,
  type ReminderVendorCode,
} from '../../lib/dailyRunReminderPrefs'
import {
  isDocumentHidden,
  showCapybaraOsNotification,
  type CapybaraNotifyPayload,
} from '../../lib/dailyRunReminderNotify'

export type ReminderAlert = {
  vendor: ReminderVendorCode
  label: string
  nextRunIso: string
  scheduledTime: string
  secondsUntil: number
}

type Props = {
  alert: ReminderAlert | null
  onDismiss: () => void
  onSnooze: (minutes: number) => void
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60)
  const s = Math.max(0, seconds) % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function alertFromPayload(
  payload: CapybaraNotifyPayload | ReminderAlert,
  nowMs: number = Date.now(),
): ReminderAlert | null {
  const vendor = String(payload.vendor || '').toLowerCase() as ReminderVendorCode
  const nextRunIso = payload.nextRunIso
  if (!vendor || !nextRunIso) return null
  const nextRunMs = new Date(nextRunIso).getTime()
  if (!Number.isFinite(nextRunMs) || nextRunMs <= nowMs) return null
  return {
    vendor,
    label: payload.label || vendor.toUpperCase(),
    nextRunIso,
    scheduledTime: payload.scheduledTime || '',
    secondsUntil: Math.floor((nextRunMs - nowMs) / 1000),
  }
}

export default function DancingCapybaraReminderModal({ alert, onDismiss, onSnooze }: Props) {
  const [tick, setTick] = useState(alert?.secondsUntil ?? 0)

  useEffect(() => {
    if (!alert) return
    setTick(alert.secondsUntil)
    const id = setInterval(() => setTick((t) => Math.max(0, t - 1)), 1000)
    return () => clearInterval(id)
  }, [alert])

  if (!alert) return null

  const node = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="capy-reminder-title"
      aria-describedby="capy-reminder-desc"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-b from-amber-50 to-orange-50 p-6 shadow-2xl dark:border-amber-900/40 dark:from-slate-900 dark:to-slate-950">
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#81B81D]/20 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-36 w-36 rounded-full bg-[#F97316]/15 blur-2xl" />

        <DancingCapybara />

        <h2
          id="capy-reminder-title"
          className="mt-2 text-center text-xl font-bold tracking-tight text-gray-900 dark:text-content-primary"
        >
          {alert.label} Daily Run in {formatCountdown(tick)}!
        </h2>
        <p
          id="capy-reminder-desc"
          className="mt-2 text-center text-sm text-gray-600 dark:text-content-muted"
        >
          Your cute capybara says it&apos;s almost time.
          {alert.scheduledTime ? (
            <>
              <br />
              Scheduled: {alert.scheduledTime}
            </>
          ) : null}
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center justify-center rounded-lg bg-[#404040] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2e2e2e]"
          >
            Got it
          </button>
          <button
            type="button"
            onClick={() => onSnooze(5)}
            className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-50 dark:border-amber-800 dark:bg-surface-muted dark:text-amber-100 dark:hover:bg-slate-800"
          >
            Snooze 5 min
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(node, document.body)
}

type VendorSnapshot = {
  category: string
  enabled: boolean
  next_run_time: string | null
  scheduled_time?: string
  /** One-off Same Day Run (ISO). Watched separately from recurring next_run_time. */
  same_day_run_at?: string | null
  same_day_run_at_local?: string | null
}

/**
 * Watches calendar countdown data and opens the capybara modal at T-30.
 * When the PWA is minimized/hidden, also sends an OS notification; clicking it
 * (or restoring the window) shows the dancing capybara.
 * Also watches Same Day Run one-offs (same_day_run_at).
 * Read-only on vendor schedules — never mutates scheduler state.
 */
export function useDailyRunCapybaraReminder(options: {
  userId: string
  enabledVendors: Set<ReminderVendorCode>
  vendorData: Record<string, VendorSnapshot | undefined>
  nowMs: number
}) {
  const { userId, enabledVendors, vendorData, nowMs } = options
  const [alert, setAlert] = useState<ReminderAlert | null>(null)
  const [snoozeUntilByVendor, setSnoozeUntilByVendor] = useState<
    Partial<Record<ReminderVendorCode, number>>
  >({})
  const alertRef = useRef<ReminderAlert | null>(null)
  alertRef.current = alert

  const openAlert = useCallback(
    (next: ReminderAlert) => {
      savePendingCapybaraReminder(userId, {
        vendor: next.vendor,
        label: next.label,
        nextRunIso: next.nextRunIso,
        scheduledTime: next.scheduledTime,
        secondsUntilAtFire: next.secondsUntil,
        firedAtMs: Date.now(),
      })
      setAlert(next)
    },
    [userId],
  )

  const tryOpenPending = useCallback(() => {
    if (alertRef.current) return
    const pending = loadPendingCapybaraReminder(userId)
    if (!pending) return
    const next = alertFromPayload(
      {
        vendor: pending.vendor,
        label: pending.label,
        nextRunIso: pending.nextRunIso,
        scheduledTime: pending.scheduledTime,
        secondsUntil: pending.secondsUntilAtFire,
      },
      Date.now(),
    )
    if (!next) {
      clearPendingCapybaraReminder(userId)
      return
    }
    setAlert(next)
  }, [userId])

  // Restore pending modal when returning to the PWA (minimized → focused).
  useEffect(() => {
    const onVisible = () => {
      if (!isDocumentHidden()) tryOpenPending()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    onVisible()
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [tryOpenPending])

  // Notification click (page Notification API or SW postMessage).
  useEffect(() => {
    const openFromPayload = (payload: CapybaraNotifyPayload) => {
      const next = alertFromPayload(payload, Date.now())
      if (next) openAlert(next)
    }

    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<CapybaraNotifyPayload>).detail
      if (detail) openFromPayload(detail)
    }

    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'DAILY_RUN_REMINDER_CLICK') return
      const payload = event.data.payload as CapybaraNotifyPayload | undefined
      if (payload) openFromPayload(payload)
      else tryOpenPending()
    }

    window.addEventListener('daily-run-reminder-click', onCustom)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onSwMessage)
    }
    return () => {
      window.removeEventListener('daily-run-reminder-click', onCustom)
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage)
      }
    }
  }, [openAlert, tryOpenPending])

  const fireAlert = useCallback(
    (next: ReminderAlert) => {
      markReminderFiredForRun(userId, next.vendor, next.nextRunIso)
      savePendingCapybaraReminder(userId, {
        vendor: next.vendor,
        label: next.label,
        nextRunIso: next.nextRunIso,
        scheduledTime: next.scheduledTime,
        secondsUntilAtFire: next.secondsUntil,
        firedAtMs: Date.now(),
      })

      if (isDocumentHidden()) {
        void showCapybaraOsNotification(next, (payload) => {
          const opened = alertFromPayload(payload, Date.now())
          if (opened) setAlert(opened)
        })
      } else {
        setAlert(next)
      }
    },
    [userId],
  )

  // T-30 detector — recurring + Same Day Run (Dashboard or Daily Run page mounted).
  useEffect(() => {
    if (!userId || alert) return

    type Candidate = {
      vendor: ReminderVendorCode
      runIso: string
      label: string
      scheduledTime: string
      secondsUntil: number
    }
    const candidates: Candidate[] = []

    for (const vendor of enabledVendors) {
      const data = vendorData[vendor]
      if (!data) continue

      const snoozeUntil = snoozeUntilByVendor[vendor] ?? 0
      if (nowMs < snoozeUntil) continue

      const pushIfDue = (
        runIso: string | null | undefined,
        label: string,
        scheduledTime: string,
        requireEnabled: boolean,
      ) => {
        if (!runIso) return
        if (requireEnabled && !data.enabled) return
        const nextRunMs = new Date(runIso).getTime()
        if (!Number.isFinite(nextRunMs) || nextRunMs <= nowMs) return
        const secondsUntil = Math.floor((nextRunMs - nowMs) / 1000)
        if (secondsUntil <= 0 || secondsUntil > DAILY_RUN_REMINDER_LEAD_SECONDS) return
        if (hasReminderFiredForRun(userId, vendor, runIso)) {
          if (!isDocumentHidden()) tryOpenPending()
          return
        }
        candidates.push({ vendor, runIso, label, scheduledTime, secondsUntil })
      }

      // Recurring Daily Run
      pushIfDue(
        data.next_run_time,
        vendor.toUpperCase(),
        data.scheduled_time || 'Recurring Daily Run',
        true,
      )
      // Same Day one-off — still remind even if recurring schedule is stopped
      pushIfDue(
        data.same_day_run_at,
        `${vendor.toUpperCase()} Same Day`,
        data.same_day_run_at_local || 'Same Day Run',
        false,
      )
    }

    if (!candidates.length) return
    candidates.sort((a, b) => a.secondsUntil - b.secondsUntil)
    const soonest = candidates[0]
    fireAlert({
      vendor: soonest.vendor,
      label: soonest.label,
      nextRunIso: soonest.runIso,
      scheduledTime: soonest.scheduledTime,
      secondsUntil: soonest.secondsUntil,
    })
  }, [userId, enabledVendors, vendorData, nowMs, alert, snoozeUntilByVendor, tryOpenPending, fireAlert])

  const dismiss = useCallback(() => {
    clearPendingCapybaraReminder(userId)
    setAlert(null)
  }, [userId])

  const snooze = useCallback(
    (minutes: number) => {
      if (!alert) return
      const vendor = alert.vendor
      setSnoozeUntilByVendor((prev) => ({
        ...prev,
        [vendor]: Date.now() + minutes * 60_000,
      }))
      clearReminderFiredForVendor(userId, vendor)
      clearPendingCapybaraReminder(userId)
      setAlert(null)
    },
    [alert, userId],
  )

  /** Instant demo — does not mark a real run as fired. */
  const preview = useCallback((vendor: ReminderVendorCode = 'clk') => {
    setAlert(buildCapybaraPreviewAlert(vendor))
  }, [])

  return { alert, dismiss, snooze, preview }
}

/** Demo alert so users can see the dancing capybara without waiting for T-30. */
export function buildCapybaraPreviewAlert(
  vendor: ReminderVendorCode = 'clk',
): ReminderAlert {
  const secondsUntil = DAILY_RUN_REMINDER_LEAD_SECONDS
  const nextRunIso = new Date(Date.now() + secondsUntil * 1000).toISOString()
  return {
    vendor,
    label: vendor.toUpperCase(),
    nextRunIso,
    scheduledTime: 'Preview · not a real Daily Run',
    secondsUntil,
  }
}
