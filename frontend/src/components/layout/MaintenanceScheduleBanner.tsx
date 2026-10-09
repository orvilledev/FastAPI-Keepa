import { useCallback, useEffect, useState } from 'react'
import { systemApi } from '../../services/api'

const DEFAULT_TIMEZONE = 'America/Chicago'
const DISMISS_STORAGE_KEY = 'msw-maintenance-banner-dismissed'
export const MAINTENANCE_SCHEDULE_EVENT = 'msw-maintenance-schedule-changed'

export function notifyMaintenanceScheduleChanged() {
  window.dispatchEvent(new Event(MAINTENANCE_SCHEDULE_EVENT))
}

type ZonedStamp = {
  dayKey: string
  dateLabel: string
  timeLabel: string
  fullLabel: string
  timeZoneName: string
}

function ordinal(day: number): string {
  const mod100 = day % 100
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`
  switch (day % 10) {
    case 1:
      return `${day}st`
    case 2:
      return `${day}nd`
    case 3:
      return `${day}rd`
    default:
      return `${day}th`
  }
}

function zonedStamp(iso: string, timeZone: string): ZonedStamp | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h12',
      timeZoneName: 'short',
    }).formatToParts(date)
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      formatted.find((item) => item.type === type)?.value || ''
    const day = Number(part('day'))
    if (!day) return null
    const dateLabel = `${part('month')} ${ordinal(day)}`
    const timeLabel = `${part('hour')}:${part('minute')} ${part('dayPeriod')}`.replace(/\s+/g, ' ').trim()
    const timeZoneName = part('timeZoneName') || timeZone
    const dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
    return {
      dayKey,
      dateLabel,
      timeLabel,
      fullLabel: `${dateLabel}, ${timeLabel} ${timeZoneName}`,
      timeZoneName,
    }
  } catch {
    return null
  }
}

export function upcomingMaintenanceMessage(
  startIso: string,
  endIso: string | null | undefined,
  timeZone: string
): string | null {
  const start = zonedStamp(startIso, timeZone)
  if (!start) return null
  const end = endIso ? zonedStamp(endIso, timeZone) : null
  const endIsAfterStart =
    Boolean(end) && new Date(endIso as string).getTime() > new Date(startIso).getTime()

  if (!end || !endIsAfterStart) {
    return `MSW Overwatch will be down for scheduled maintenance on ${start.fullLabel}.`
  }
  if (end!.dayKey === start.dayKey) {
    return `MSW Overwatch will be down for scheduled maintenance on ${start.dateLabel}, ${start.timeLabel}–${end!.timeLabel} ${start.timeZoneName}.`
  }
  return `MSW Overwatch will be down for scheduled maintenance from ${start.fullLabel} to ${end!.fullLabel}.`
}

type ScheduleNotice = {
  startAt: string
  message: string
}

export default function MaintenanceScheduleBanner() {
  const [notice, setNotice] = useState<ScheduleNotice | null>(null)
  const [dismissedStartAt, setDismissedStartAt] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(DISMISS_STORAGE_KEY)
    } catch {
      return null
    }
  })

  const load = useCallback(async () => {
    try {
      const status = await systemApi.getMaintenanceStatus()
      const startAt = (status.scheduled_start_at || '').trim()
      if (!startAt || status.maintenance_mode) {
        setNotice(null)
        return
      }
      const timeZone = (status.schedule_timezone || '').trim() || DEFAULT_TIMEZONE
      const message = upcomingMaintenanceMessage(startAt, status.expected_end_at, timeZone)
      setNotice(message ? { startAt, message } : null)
    } catch {
      setNotice(null)
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(), 60_000)
    const onFocus = () => void load()
    const onScheduleChange = () => void load()
    window.addEventListener('focus', onFocus)
    window.addEventListener(MAINTENANCE_SCHEDULE_EVENT, onScheduleChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(MAINTENANCE_SCHEDULE_EVENT, onScheduleChange)
    }
  }, [load])

  if (!notice || dismissedStartAt === notice.startAt) return null

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_STORAGE_KEY, notice.startAt)
    } catch {
      /* ignore private-mode storage failures */
    }
    setDismissedStartAt(notice.startAt)
  }

  return (
    <div className="maintenance-schedule-banner relative shrink-0" role="status">
      <p className="mx-auto max-w-6xl px-10 py-2 text-center text-sm leading-snug">
        <span className="mr-1.5 inline-flex translate-y-0.5 align-middle" aria-hidden="true">
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="10" cy="10" r="7.25" />
            <path d="M10 9.1v4.2" strokeLinecap="round" />
            <circle cx="10" cy="6.35" r="0.7" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <span className="font-semibold">Upcoming maintenance</span> {notice.message}
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss maintenance notice"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 hover:bg-black/10"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
