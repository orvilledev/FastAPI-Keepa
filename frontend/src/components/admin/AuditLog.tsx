import { useCallback, useEffect, useMemo, useState } from 'react'
import { authApi, type AuditLogEntry } from '../../services/api'
import { useUser } from '../../contexts/UserContext'

const CATEGORY_LABELS: Record<string, string> = {
  auth: 'Sign in / out',
  upload: 'Uploads',
  download: 'Downloads',
  playground: 'Playground',
  tool: 'Tools',
  email: 'Email lists',
  settings: 'Settings',
  admin: 'User admin',
  job: 'Jobs & runs',
  analytics: 'Analytics',
  data: 'Data changes',
  other: 'Other',
}

const CATEGORY_ORDER = [
  'auth',
  'upload',
  'download',
  'playground',
  'tool',
  'email',
  'settings',
  'admin',
  'job',
  'analytics',
  'data',
  'other',
]

function categoryBadgeClass(category: string): string {
  switch (category) {
    case 'auth':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200'
    case 'upload':
      return 'bg-amber-50 text-amber-900 border-amber-200'
    case 'download':
      return 'bg-sky-50 text-sky-900 border-sky-200'
    case 'playground':
      return 'bg-violet-50 text-violet-900 border-violet-200'
    case 'tool':
      return 'bg-indigo-50 text-indigo-900 border-indigo-200'
    case 'email':
      return 'bg-teal-50 text-teal-900 border-teal-200'
    case 'settings':
      return 'bg-blue-50 text-blue-900 border-blue-200'
    case 'admin':
      return 'bg-rose-50 text-rose-900 border-rose-200'
    case 'job':
      return 'bg-cyan-50 text-cyan-900 border-cyan-200'
    case 'analytics':
      return 'bg-fuchsia-50 text-fuchsia-900 border-fuchsia-200'
    case 'data':
      return 'bg-orange-50 text-orange-900 border-orange-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleString()
}

/** stephanie → Stephanie; existing Title Case names stay as-is. */
function formatPersonName(name: string | null | undefined): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return '—'
  return trimmed
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ')
}

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string {
  const value = meta?.[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function metaCategory(meta: Record<string, unknown> | null | undefined): string {
  return metaString(meta, 'category').toUpperCase()
}

/** Rebuild a precise What happened line from action + metadata when possible. */
function rebuildDetail(row: AuditLogEntry): string | null {
  const meta = row.metadata || {}
  const cat = metaCategory(meta)
  const filename = metaString(meta, 'filename')
  const vendor = metaString(meta, 'vendor_code').toUpperCase()
  const periodLabel = metaString(meta, 'period_label')
  const enabledRaw = metaString(meta, 'enabled').toLowerCase()

  switch (row.action) {
    case 'scheduler.settings_update': {
      if (!cat) return null
      const fields = Array.isArray(meta.changed_fields)
        ? meta.changed_fields.filter((f): f is string => typeof f === 'string')
        : []
      if (fields.length > 0) {
        return `Updated ${cat} Daily Run scheduler settings (${fields.join(', ')})`
      }
      return `Updated ${cat} Daily Run scheduler settings`
    }
    case 'scheduler.upload_delete': {
      if (cat && filename) return `Deleted uploaded Keepa report for ${cat}: ${filename}`
      if (cat) return `Deleted an uploaded Keepa report for ${cat}`
      return null
    }
    case 'scheduler.upload_rerun': {
      if (cat && filename) {
        return `Re-ran ${cat} Import Mode Daily Run from uploaded Keepa report: ${filename}`
      }
      if (cat) return `Re-ran ${cat} Import Mode Daily Run from the uploaded Keepa report`
      return null
    }
    case 'scheduler.same_day_create':
      return cat ? `Scheduled an extra same-day Daily Run for ${cat}` : null
    case 'scheduler.same_day_cancel':
      return cat ? `Cancelled a pending same-day Daily Run for ${cat}` : null
    case 'keepa.upload': {
      if (cat && filename) return `Uploaded Keepa report for ${cat}: ${filename}`
      if (cat) return `Uploaded Keepa report for ${cat}`
      return null
    }
    case 'analytics.tracking_update': {
      const code = vendor || metaString(meta, 'vendor').toUpperCase()
      if (!code) return null
      if (enabledRaw === 'true' || enabledRaw === '1') return `Started Analytics tracking for ${code}`
      if (enabledRaw === 'false' || enabledRaw === '0') return `Stopped Analytics tracking for ${code}`
      return `Changed Analytics tracking for ${code}`
    }
    case 'analytics.mismatch_test': {
      if (!periodLabel) return null
      const hasMismatch = meta.has_mismatch === true
      const count = typeof meta.mismatch_count === 'number' ? meta.mismatch_count : null
      if (hasMismatch && count != null) {
        return `Ran Analytics mismatch test for ${periodLabel}: found ${count} vendor mismatch${count === 1 ? '' : 'es'}`
      }
      if (hasMismatch) return `Ran Analytics mismatch test for ${periodLabel}: mismatch found`
      return `Ran Analytics mismatch test for ${periodLabel}: no mismatch found`
    }
    case 'analytics.mismatch_fix': {
      if (!periodLabel) return null
      return meta.fixed === false
        ? `Attempted Analytics mismatch fix for ${periodLabel}`
        : `Recomputed Analytics to fix a mismatch for ${periodLabel}`
    }
    case 'analytics.demo_delete': {
      if (typeof meta.deleted === 'number') {
        const n = meta.deleted
        return `Removed ${n} Analytics demo snapshot${n === 1 ? '' : 's'}`
      }
      return null
    }
    case 'admin.upc_dnk_print_id_allowlist': {
      if (typeof meta.email_count === 'number') {
        const n = meta.email_count
        return `Updated the Label Station UPC (DNK) Print ID allowlist (${n} email${n === 1 ? '' : 's'})`
      }
      return null
    }
    case 'notification.clear':
      return 'Cleared all completed-run notifications'
    default:
      return null
  }
}

function describeRow(row: AuditLogEntry): string {
  return rebuildDetail(row) || row.detail || row.label || row.action
}

export default function AuditLog() {
  const { isSuperadmin, userInfoLoading } = useUser()
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [available, setAvailable] = useState(true)

  const loadLogs = useCallback(async () => {
    try {
      setError('')
      setLoading(true)
      const data = await authApi.listAuditEvents({
        limit: 300,
        ...(category ? { category } : {}),
        ...(appliedSearch ? { search: appliedSearch } : {}),
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
  }, [category, appliedSearch])

  useEffect(() => {
    if (userInfoLoading || !isSuperadmin) return
    void loadLogs()
  }, [userInfoLoading, isSuperadmin, loadLogs])

  const counts = useMemo(() => {
    const byCategory: Record<string, number> = {}
    logs.forEach((row) => {
      byCategory[row.category] = (byCategory[row.category] || 0) + 1
    })
    return byCategory
  }, [logs])

  const uniqueUsers = useMemo(
    () => new Set(logs.map((row) => row.user_email).filter(Boolean)).size,
    [logs],
  )

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
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Audit Log</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-content-muted">
          Every action taken in the web app, from sign in to sign out: uploads, downloads, tool
          runs, testing, email list changes, settings, and deletions. Opening and viewing pages is
          not recorded.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Events shown', value: logs.length },
          { label: 'People', value: uniqueUsers },
          { label: 'Downloads', value: counts.download || 0 },
          { label: 'Uploads', value: counts.upload || 0 },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-border dark:bg-surface"
          >
            <p className="text-xs font-medium text-gray-500 dark:text-content-muted">
              {stat.label}
            </p>
            <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-slate-100">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-600 dark:text-content-secondary">
          Category
          <select
            className="ml-2 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-border dark:bg-surface"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All activity</option>
            {CATEGORY_ORDER.map((key) => (
              <option key={key} value={key}>
                {CATEGORY_LABELS[key]}
              </option>
            ))}
          </select>
        </label>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setAppliedSearch(search.trim())
          }}
        >
          <label className="text-sm text-gray-600 dark:text-content-secondary">
            Search
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, or action"
              className="ml-2 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-border dark:bg-surface"
            />
          </label>
          <button
            type="submit"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-border dark:text-content-secondary dark:hover:bg-surface-hover"
          >
            Apply
          </button>
          {appliedSearch && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setAppliedSearch('')
              }}
              className="rounded-md px-2 py-1.5 text-sm text-gray-500 hover:underline"
            >
              Clear
            </button>
          )}
        </form>

        <button
          type="button"
          onClick={() => void loadLogs()}
          disabled={loading}
          className="ml-auto rounded-md bg-[#F97316] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#EA580C] disabled:opacity-60"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
          {!available && (
            <span className="mt-1 block text-red-700">
              If this is a new install, apply <code>create_audit_logs.sql</code> and{' '}
              <code>expand_audit_logs_all_actions.sql</code> in Supabase.
            </span>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-border dark:bg-surface">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-border">
            <thead className="bg-gray-50 dark:bg-surface-muted">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-content-secondary">
                  When
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-content-secondary">
                  Category
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-content-secondary">
                  User
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-content-secondary">
                  What happened
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-content-secondary">
                  IP
                </th>
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
                    No audit events match these filters.
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
                        className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${categoryBadgeClass(row.category)}`}
                      >
                        {CATEGORY_LABELS[row.category] || row.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-slate-100">
                        {formatPersonName(row.user_display_name)}
                      </div>
                      <div className="text-xs text-gray-500">{row.user_email || '—'}</div>
                    </td>
                    <td className="max-w-lg px-4 py-3 text-gray-700 dark:text-content-secondary">
                      <div>{describeRow(row)}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-gray-400">
                        {row.action}
                        {row.status_code && row.status_code >= 400 ? ` · failed (${row.status_code})` : ''}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600 dark:text-content-muted">
                      {row.ip_address || '—'}
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
