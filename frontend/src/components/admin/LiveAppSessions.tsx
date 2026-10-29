import { useEffect, useState } from 'react'
import { authApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'
import { canAccessSessionAudit } from '../../lib/sessionAuditAccess'

type PresenceSession = {
  session_id: string
  user_id: string
  email: string | null
  display_name: string | null
  client_type: string
  ip_address: string | null
  path: string | null
  status: string
  last_heartbeat_at: string
  last_activity_at: string
  created_at: string
}

type PresenceSnapshot = {
  as_of: string
  online_total: number
  web_count: number
  electron_count: number
  active_count: number
  idle_count: number
  sessions: PresenceSession[]
}

function sessionName(displayName: string | null, email: string | null): string {
  const raw = displayName?.trim() || email?.split('@')[0] || ''
  if (!raw) return ''
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function formatAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 'just now'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  return `${hr}h ago`
}

export default function LiveAppSessions() {
  const { isSuperadmin, userInfoLoading, userInfo, authUser } = useUser()
  const canView = canAccessSessionAudit(userInfo?.email || authUser?.email, isSuperadmin)
  const [presence, setPresence] = useState<PresenceSnapshot | null>(null)
  const [presenceLoading, setPresenceLoading] = useState(false)
  const [presenceError, setPresenceError] = useState('')

  const loadPresence = async () => {
    try {
      setPresenceError('')
      setPresenceLoading(true)
      const data = await authApi.getPresenceSessions()
      setPresence(data)
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setPresenceError(typeof msg === 'string' ? msg : 'Failed to load live sessions')
    } finally {
      setPresenceLoading(false)
    }
  }

  useEffect(() => {
    if (userInfoLoading || !canView) return
    void loadPresence()
  }, [userInfoLoading, canView])

  useEffect(() => {
    if (!canView || userInfoLoading) return
    const timer = window.setInterval(() => void loadPresence(), 20_000)
    return () => window.clearInterval(timer)
  }, [canView, userInfoLoading])

  if (userInfoLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading…</div>
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-gray-600">This page is limited to superadmin, Stephanie, and Sunshine.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Live app sessions</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-content-muted">
            Combined web + Electron openings. Shared accounts (e.g. warehouse stations) count as
            separate sessions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPresence()}
          disabled={presenceLoading}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-border dark:text-content-secondary dark:hover:bg-surface-muted"
        >
          {presenceLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="card p-4 space-y-4">
        {presenceError && (
          <p className="text-sm text-red-700">{presenceError}</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Online total', value: presence?.online_total ?? '—' },
            { label: 'Web', value: presence?.web_count ?? '—' },
            { label: 'Electron', value: presence?.electron_count ?? '—' },
            { label: 'Active', value: presence?.active_count ?? '—' },
            { label: 'Idle (open)', value: presence?.idle_count ?? '—' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-border dark:bg-surface-muted"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{stat.label}</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-border">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-border">
            <thead className="bg-gray-50 dark:bg-surface-muted">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-content-secondary">Email</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-content-secondary">Status</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-content-secondary">Client</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-content-secondary">IP address</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-content-secondary">Path</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-content-secondary">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-border dark:bg-surface">
              {(presence?.sessions?.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                    {presenceLoading
                      ? 'Loading live sessions…'
                      : 'No open sessions right now (users appear after the app sends a heartbeat).'}
                  </td>
                </tr>
              ) : (
                presence!.sessions.map((s) => {
                  const nameLabel = sessionName(s.display_name, s.email)
                  return (
                  <tr key={s.session_id}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900 dark:text-slate-100">{s.email || '—'}</div>
                      {nameLabel && (
                        <div className="text-xs text-gray-500">{nameLabel}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          s.status === 'active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {s.status === 'active' ? 'Active' : 'Idle (open)'}
                      </span>
                    </td>
                    <td className="px-3 py-2 capitalize text-gray-700 dark:text-content-secondary">{s.client_type}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-800 dark:text-content-secondary">
                      {s.ip_address || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 max-w-[10rem] truncate" title={s.path || ''}>
                      {s.path || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      <div>Heartbeat {formatAgo(s.last_heartbeat_at)}</div>
                      <div>Activity {formatAgo(s.last_activity_at)}</div>
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {presence?.as_of && (
          <p className="text-xs text-gray-500">
            Updated {formatAgo(presence.as_of)} · auto-refreshes every 20s · Active = interaction in
            last ~2 min; Idle = app still open without recent interaction
          </p>
        )}
      </div>
    </div>
  )
}
