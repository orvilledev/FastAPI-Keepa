import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '../../contexts/UserContext'
import {
  NIGHTLY_LOGOUT_NOTICE,
  NIGHTLY_LOGOUT_REMINDER_MINUTES,
  clearStationLoginAt,
  isNightlyLogoutEmail,
  nextNightlyLogoutAt,
  reminderLabel,
  resolveStationLoginAt,
} from '../../lib/nightlyStationLogout'

const AUTH_NOTICE_KEY = 'auth_notice'

/**
 * Signs out two shared station accounts at 1:00 AM Central, with reminders
 * 30, 15, 5, and 1 minute before. Does not enroll them in two-factor auth.
 */
export default function NightlyStationLogout() {
  const { authUser, signOut } = useUser()
  const navigate = useNavigate()
  const email = (authUser?.email || '').trim().toLowerCase()
  const applies = isNightlyLogoutEmail(email)
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(null)
  const signingOut = useRef(false)
  const shownReminders = useRef<Set<number>>(new Set())
  const deadlineMs = useRef<number | null>(null)
  const signOutRef = useRef(signOut)
  signOutRef.current = signOut
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  useEffect(() => {
    if (!applies) return
    const loginAt = resolveStationLoginAt(email)
    deadlineMs.current = nextNightlyLogoutAt(new Date(loginAt)).getTime()
    shownReminders.current = new Set()
    const deadline = deadlineMs.current
    const now = Date.now()
    for (const minutes of NIGHTLY_LOGOUT_REMINDER_MINUTES) {
      if (now >= deadline - minutes * 60_000) shownReminders.current.add(minutes)
    }

    let cancelled = false

    const signOutNow = () => {
      if (cancelled || signingOut.current) return
      signingOut.current = true
      clearStationLoginAt(email)
      try {
        sessionStorage.setItem(AUTH_NOTICE_KEY, NIGHTLY_LOGOUT_NOTICE)
      } catch {
        // Login still works without the notice.
      }
      navigateRef.current('/login', { replace: true })
      void signOutRef.current()
    }

    const tick = () => {
      const due = deadlineMs.current
      if (due == null) return
      const current = Date.now()
      if (current >= due) {
        signOutNow()
        return
      }
      let latestDue: number | null = null
      for (const minutes of NIGHTLY_LOGOUT_REMINDER_MINUTES) {
        if (current < due - minutes * 60_000) continue
        if (!shownReminders.current.has(minutes)) latestDue = minutes
        shownReminders.current.add(minutes)
      }
      if (latestDue != null) setReminderMinutes(latestDue)
    }

    tick()
    const interval = window.setInterval(tick, 1000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [applies, email])

  if (!applies || reminderMinutes == null) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nightly-logout-title"
        className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-6 shadow-xl dark:border-amber-900 dark:bg-surface"
      >
        <h2 id="nightly-logout-title" className="text-lg font-bold text-gray-900 dark:text-slate-100">
          Sign-out at 1:00 AM Central
        </h2>
        <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">
          {reminderLabel(reminderMinutes)} remaining. This station signs out at 1:00 AM Central Time.
          Sign in again after that to keep working.
        </p>
        <button
          type="button"
          onClick={() => setReminderMinutes(null)}
          className="mt-5 rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2f2f2f]"
        >
          OK
        </button>
      </div>
    </div>
  )
}
