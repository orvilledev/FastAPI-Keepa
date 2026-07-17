import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import DancingCapybara from './DancingCapybara'
import {
  DAILY_RUN_REMINDER_LEAD_SECONDS,
  clearReminderFiredForVendor,
  hasReminderFiredForRun,
  markReminderFiredForRun,
  type ReminderVendorCode,
} from '../../lib/dailyRunReminderPrefs'

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
}

/**
 * Watches calendar countdown data and opens the capybara modal at T-30.
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
  const [snoozeUntilByVendor, setSnoozeUntilByVendor] = useState<Partial<Record<ReminderVendorCode, number>>>(
    {},
  )

  useEffect(() => {
    if (!userId || alert) return

    for (const vendor of enabledVendors) {
      const data = vendorData[vendor]
      if (!data?.enabled || !data.next_run_time) continue

      const nextRunMs = new Date(data.next_run_time).getTime()
      if (!Number.isFinite(nextRunMs) || nextRunMs <= nowMs) continue

      const secondsUntil = Math.floor((nextRunMs - nowMs) / 1000)
      if (secondsUntil <= 0 || secondsUntil > DAILY_RUN_REMINDER_LEAD_SECONDS) continue

      const snoozeUntil = snoozeUntilByVendor[vendor] ?? 0
      if (nowMs < snoozeUntil) continue

      if (hasReminderFiredForRun(userId, vendor, data.next_run_time)) continue

      markReminderFiredForRun(userId, vendor, data.next_run_time)
      setAlert({
        vendor,
        label: vendor.toUpperCase(),
        nextRunIso: data.next_run_time,
        scheduledTime: data.scheduled_time || '',
        secondsUntil,
      })
      break
    }
  }, [userId, enabledVendors, vendorData, nowMs, alert, snoozeUntilByVendor])

  const dismiss = useCallback(() => setAlert(null), [])

  const snooze = useCallback(
    (minutes: number) => {
      if (!alert) return
      const vendor = alert.vendor
      setSnoozeUntilByVendor((prev) => ({
        ...prev,
        [vendor]: Date.now() + minutes * 60_000,
      }))
      // Allow re-show after snooze for the same scheduled run
      clearReminderFiredForVendor(userId, vendor)
      setAlert(null)
    },
    [alert, userId],
  )

  return { alert, dismiss, snooze }
}
