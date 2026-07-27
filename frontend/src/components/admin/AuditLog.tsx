import { useCallback, useEffect, useState } from 'react'
import { authApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'

type AuditLogRow = {
  id: string | null
  action: string
  user_id: string | null
  user_display_name: string | null
  user_email: string | null
  client_type: string
  ip_address: string | null
  detail: string | null
  metadata: Record<string, unknown>
  created_at: string | null
}

const ACTION_LABELS: Record<string, string> = {
  login: 'Login',
  logout: 'Logout',
  keepa_upload: 'Keepa upload',
  keepa_download: 'Keepa download',
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

function actionBadgeClass(action: string): string {
  switch (action) {
    case 'login':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200'
    case 'logout':
      return 'bg-slate-100 text-slate-700 border-slate-200'
    case 'keepa_upload':
      return 'bg-amber-50 text-amber-900 border-amber-200'
    case 'keepa_download':
      return 'bg-sky-50 text-sky-900 border-sky-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

export default function AuditLog() {
  const { isSuperadmin, userInfoLoading } = useUser()
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [available, setAvailable] = useState(true)

  const loadLogs = useCallback(async () => {
    try {
      setError('')
      setLoading(true)
      const data = await authApi.listAuditEvents({
        limit: 200,
        ...(actionFilter ? { action: actionFilter } : {}),
      })
      setLogs(data.logs || [])
      setAvailable(data.available !== false)
      if (data.available === false && data.detail) {
        setError(data.detail)
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setError(typeof msg === 'string' ? msg : 'Failed to load audit log')
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [actionFilter])

  useEffect(() => {
    if (userInfoLoading || !isSuperadmin) return
    void loadLogs()
  }, [userInfoLoading, isSuperadmin, loadLogs])

  if (userInfoLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading…</div>
      </div>
    )
  }

  if (!isSuperadmin) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-gray-600">Only superadmin can access this page.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Audit Log</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-content-muted">
            Web app actions only: login, logout, Keepa uploads, and Keepa downloads. Page views are not recorded.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-content-secondary">
            Action
            <select
              className="ml-2 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-border dark:bg-surface"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="login">Login</option>
              <option value="logout">Logout</option>
              <option value="keepa_upload">Keepa upload</option>
              <option value="keepa_download">Keepa download</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadLogs()}
            disabled={loading}
            className="rounded-md bg-[#F97316] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#EA580C] disabled:opacity-60"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
          {!available && (
            <span className="mt-1 block text-red-700">
              If this is a new install, apply the <code>create_audit_logs.sql</code> migration in Supabase.
            </span>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-border dark:bg-surface">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-border">
            <thead className="bg-gray-50 dark:bg-surface-muted">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-content-secondary">When</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-content-secondary">Action</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-content-secondary">User</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-content-secondary">IP</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-content-secondary">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-border">
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    Loading audit events…
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No audit events yet.
                  </td>
                </tr>
              ) : (
                logs.map((row) => (
                  <tr key={row.id || `${row.created_at}-${row.action}-${row.user_email}`}>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-content-secondary">
                      {formatWhen(row.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${actionBadgeClass(row.action)}`}
                      >
                        {ACTION_LABELS[row.action] || row.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-slate-100">
                        {row.user_display_name || '—'}
                      </div>
                      <div className="text-xs text-gray-500">{row.user_email || '—'}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600 dark:text-content-muted">
                      {row.ip_address || '—'}
                    </td>
                    <td className="max-w-md px-4 py-3 text-gray-700 dark:text-content-secondary">
                      {row.detail || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
