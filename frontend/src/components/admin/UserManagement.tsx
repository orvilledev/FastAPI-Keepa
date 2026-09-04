import { useEffect, useState } from 'react'
import { authApi } from '../../services/api'
import { useUser } from '../../contexts/UserContext'

interface User {
  id: string
  email: string
  role: string
  display_name?: string
  has_keepa_access: boolean
  can_manage_tools: boolean
  is_active?: boolean
  created_at: string
}

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

/** Same resolution as UserContext.displayName + Dashboard greeting capitalization. */
function userDisplayLabel(user: Pick<User, 'display_name' | 'email'>): string {
  const raw = user.display_name?.trim() || user.email?.split('@')[0] || ''
  if (!raw) return 'No name'
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function userInitial(user: Pick<User, 'display_name' | 'email'>): string {
  const raw = user.display_name?.trim() || user.email?.split('@')[0] || user.email || ''
  const c = raw.charAt(0).toUpperCase()
  return c || '?'
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

function emailTransportLabel(transport: 'graph' | 'smtp'): string {
  return transport === 'graph' ? 'Graph API' : 'SMTP'
}

const DEFAULT_MAINTENANCE_TIMEZONE = 'America/Chicago'

const MAINTENANCE_TIMEZONE_VALUES = new Set([
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Seoul',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Moscow',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Pacific/Auckland',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Buenos_Aires',
  'UTC',
  'Africa/Johannesburg',
  'Asia/Jerusalem',
])

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_MAINTENANCE_TIMEZONE
  } catch {
    return DEFAULT_MAINTENANCE_TIMEZONE
  }
}

function formatInTimeZone(iso: string | null | undefined, timeZone: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(d)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value])
    ) as Record<string, string>
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
    }
  } catch {
    return { date: '', time: '' }
  }
}

function zonedDateTimeToIso(date: string, time: string, timeZone: string): string | null {
  if (!date.trim() || !time.trim()) return null
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  if (![y, mo, d, h, mi].every((n) => Number.isFinite(n))) return null

  // Interpret wall-clock date/time in the selected IANA timezone, convert to UTC ISO.
  let utcMs = Date.UTC(y, mo - 1, d, h, mi, 0)
  for (let i = 0; i < 3; i++) {
    const shown = formatInTimeZone(new Date(utcMs).toISOString(), timeZone)
    if (!shown.date || !shown.time) return null
    const [sy, smo, sd] = shown.date.split('-').map(Number)
    const [sh, smi] = shown.time.split(':').map(Number)
    const shownAsUtc = Date.UTC(sy, smo - 1, sd, sh, smi, 0)
    const desiredAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0)
    const diff = desiredAsUtc - shownAsUtc
    if (diff === 0) break
    utcMs += diff
  }
  return new Date(utcMs).toISOString()
}

function formatZonedDisplay(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

export default function UserManagement() {
  const { isSuperadmin, userInfoLoading, userInfo } = useUser()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [showPendingOnly, setShowPendingOnly] = useState(false)
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const [maintenanceDurationHours, setMaintenanceDurationHours] = useState<number>(0)
  const [maintenanceExpectedEndAt, setMaintenanceExpectedEndAt] = useState<string | null>(null)
  const [maintenanceScheduledStartAt, setMaintenanceScheduledStartAt] = useState<string | null>(null)
  const [maintenanceScheduleTimezone, setMaintenanceScheduleTimezone] = useState(browserTimezone)
  const [maintenanceScheduleDate, setMaintenanceScheduleDate] = useState('')
  const [maintenanceScheduleTime, setMaintenanceScheduleTime] = useState('')
  const [maintenanceScheduleEndDate, setMaintenanceScheduleEndDate] = useState('')
  const [maintenanceScheduleEndTime, setMaintenanceScheduleEndTime] = useState('')
  const [maintenanceSaving, setMaintenanceSaving] = useState(false)
  const [emailTransport, setEmailTransport] = useState<'auto' | 'graph' | 'smtp'>('auto')
  const [emailEffectiveTransport, setEmailEffectiveTransport] = useState<'graph' | 'smtp'>('smtp')
  const [emailSmtpConfigured, setEmailSmtpConfigured] = useState(false)
  const [emailGraphConfigured, setEmailGraphConfigured] = useState(false)
  const [emailFrom, setEmailFrom] = useState('')
  const [emailTransportSaving, setEmailTransportSaving] = useState(false)
  const [emailTransportMessage, setEmailTransportMessage] = useState<string | null>(null)
  const [upcDnkEmails, setUpcDnkEmails] = useState<string[]>([])
  const [upcDnkDraftEmail, setUpcDnkDraftEmail] = useState('')
  const [upcDnkLoading, setUpcDnkLoading] = useState(false)
  const [upcDnkSaving, setUpcDnkSaving] = useState(false)
  const [upcDnkMessage, setUpcDnkMessage] = useState<string | null>(null)
  const [upcDnkError, setUpcDnkError] = useState<string | null>(null)
  const [presence, setPresence] = useState<PresenceSnapshot | null>(null)
  const [presenceLoading, setPresenceLoading] = useState(false)
  const [presenceError, setPresenceError] = useState('')

  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newKeepaAccess, setNewKeepaAccess] = useState(true)
  const [newActive, setNewActive] = useState(true)
  const [creatingUser, setCreatingUser] = useState(false)
  const [createUserMessage, setCreateUserMessage] = useState<string | null>(null)

  const loadUsers = async () => {
    try {
      setError('')
      setLoading(true)
      const data = await authApi.getAllUsers()
      setUsers(data.users || [])
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setError(typeof msg === 'string' ? msg : 'Failed to load users')
      console.error('Failed to load users:', err)
    } finally {
      setLoading(false)
    }
  }

  const applyMaintenanceState = (state: {
    maintenance_mode: boolean
    message: string
    duration_hours?: number | null
    expected_end_at?: string | null
    scheduled_start_at?: string | null
    schedule_timezone?: string | null
  }) => {
    setMaintenanceMode(Boolean(state.maintenance_mode))
    setMaintenanceMessage(state.message || '')
    setMaintenanceDurationHours(
      typeof state.duration_hours === 'number' && state.duration_hours > 0 ? state.duration_hours : 0
    )
    setMaintenanceExpectedEndAt(state.expected_end_at || null)
    const tz = (state.schedule_timezone || '').trim() || browserTimezone()
    setMaintenanceScheduleTimezone(tz)
    const scheduled = state.scheduled_start_at || null
    setMaintenanceScheduledStartAt(scheduled)
    const startParts = formatInTimeZone(scheduled, tz)
    setMaintenanceScheduleDate(startParts.date)
    setMaintenanceScheduleTime(startParts.time)
    // End pickers only apply to a pending schedule window.
    if (scheduled && state.expected_end_at) {
      const endParts = formatInTimeZone(state.expected_end_at, tz)
      setMaintenanceScheduleEndDate(endParts.date)
      setMaintenanceScheduleEndTime(endParts.time)
    } else {
      setMaintenanceScheduleEndDate('')
      setMaintenanceScheduleEndTime('')
    }
  }

  const loadMaintenanceMode = async () => {
    try {
      const state = await authApi.getMaintenanceMode()
      applyMaintenanceState(state)
    } catch (err) {
      console.error('Failed to load maintenance mode:', err)
    }
  }

  const loadEmailTransport = async () => {
    try {
      const state = await authApi.getEmailTransport()
      setEmailTransport(state.transport)
      setEmailEffectiveTransport(state.effective_transport)
      setEmailSmtpConfigured(Boolean(state.smtp_configured))
      setEmailGraphConfigured(Boolean(state.graph_configured))
      setEmailFrom(state.email_from || '')
    } catch (err) {
      console.error('Failed to load email transport:', err)
    }
  }

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

  const loadUpcDnkAllowlist = async () => {
    try {
      setUpcDnkError(null)
      setUpcDnkLoading(true)
      const data = await authApi.getUpcDnkPrintIdAllowlist()
      setUpcDnkEmails(data.emails || [])
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setUpcDnkError(
        typeof msg === 'string'
          ? msg
          : 'Failed to load UPC (DNK) allowlist. Run the create_upc_dnk_print_id_allowlist migration if needed.',
      )
    } finally {
      setUpcDnkLoading(false)
    }
  }

  const saveUpcDnkAllowlist = async (emails: string[]) => {
    try {
      setUpcDnkSaving(true)
      setUpcDnkError(null)
      setUpcDnkMessage(null)
      const data = await authApi.updateUpcDnkPrintIdAllowlist(emails)
      setUpcDnkEmails(data.emails || [])
      setUpcDnkMessage('UPC (DNK) allowlist saved.')
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setUpcDnkError(typeof msg === 'string' ? msg : 'Failed to save UPC (DNK) allowlist')
    } finally {
      setUpcDnkSaving(false)
    }
  }

  const handleAddUpcDnkEmail = async () => {
    const email = upcDnkDraftEmail.trim().toLowerCase()
    if (!email) return
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setUpcDnkError('Enter a valid email address.')
      return
    }
    if (upcDnkEmails.some((e) => e.toLowerCase() === email)) {
      setUpcDnkError('That email is already on the allowlist.')
      return
    }
    setUpcDnkDraftEmail('')
    await saveUpcDnkAllowlist([...upcDnkEmails, email])
  }

  const handleRemoveUpcDnkEmail = async (email: string) => {
    const confirmed = window.confirm(
      `Remove ${email} from UPC (DNK) Print ID access? They will only be able to use Short SKU (Amazon).`,
    )
    if (!confirmed) return
    await saveUpcDnkAllowlist(upcDnkEmails.filter((e) => e.toLowerCase() !== email.toLowerCase()))
  }

  useEffect(() => {
    if (userInfoLoading) return
    if (!isSuperadmin) return
    void loadUsers()
    void loadMaintenanceMode()
    void loadEmailTransport()
    void loadPresence()
    void loadUpcDnkAllowlist()
  }, [userInfoLoading, isSuperadmin])

  useEffect(() => {
    if (!isSuperadmin || userInfoLoading) return
    const timer = window.setInterval(() => void loadPresence(), 20_000)
    return () => window.clearInterval(timer)
  }, [isSuperadmin, userInfoLoading])

  const handleToggleMaintenanceMode = async () => {
    const nextMode = !maintenanceMode
    const confirmed = window.confirm(
      nextMode
        ? 'Enable maintenance mode now? Non-superadmin users will see the maintenance page.'
        : 'Disable maintenance mode and clear any scheduled start? Normal access will be restored.'
    )
    if (!confirmed) return
    try {
      setMaintenanceSaving(true)
      const updated = await authApi.updateMaintenanceMode(
        nextMode,
        maintenanceMessage,
        maintenanceDurationHours > 0 ? maintenanceDurationHours : 0
      )
      applyMaintenanceState(updated)
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      alert(typeof msg === 'string' ? msg : 'Failed to update maintenance mode')
    } finally {
      setMaintenanceSaving(false)
    }
  }

  const handleSaveMaintenanceDetails = async () => {
    const hasStartDate = Boolean(maintenanceScheduleDate)
    const hasStartTime = Boolean(maintenanceScheduleTime)
    const hasEndDate = Boolean(maintenanceScheduleEndDate)
    const hasEndTime = Boolean(maintenanceScheduleEndTime)
    const anyScheduleField = hasStartDate || hasStartTime || hasEndDate || hasEndTime
    const allScheduleFields = hasStartDate && hasStartTime && hasEndDate && hasEndTime
    const tz = maintenanceScheduleTimezone.trim() || DEFAULT_MAINTENANCE_TIMEZONE

    if (anyScheduleField && !allScheduleFields) {
      alert('Select both schedule start and end (date and hour), or clear all four fields to remove the schedule.')
      return
    }

    const scheduledStartIso = allScheduleFields
      ? zonedDateTimeToIso(maintenanceScheduleDate, maintenanceScheduleTime, tz)
      : null
    const scheduledEndIso = allScheduleFields
      ? zonedDateTimeToIso(maintenanceScheduleEndDate, maintenanceScheduleEndTime, tz)
      : null

    if (allScheduleFields && (!scheduledStartIso || !scheduledEndIso)) {
      alert('Invalid schedule date, time, or timezone. Check the start and end values.')
      return
    }

    if (scheduledStartIso && scheduledEndIso && !maintenanceMode) {
      const startMs = new Date(scheduledStartIso).getTime()
      const endMs = new Date(scheduledEndIso).getTime()
      if (Number.isNaN(startMs) || startMs <= Date.now()) {
        alert('Schedule start must be a future date and time. Use Enable Maintenance for an immediate start.')
        return
      }
      if (Number.isNaN(endMs) || endMs <= startMs) {
        alert('Schedule end must be after the schedule start.')
        return
      }
    }

    const derivedHours =
      scheduledStartIso && scheduledEndIso
        ? Math.max(
            0,
            Math.min(
              168,
              Math.round(
                ((new Date(scheduledEndIso).getTime() - new Date(scheduledStartIso).getTime()) / 3_600_000) * 2
              ) / 2
            )
          )
        : maintenanceDurationHours > 0
          ? maintenanceDurationHours
          : 0

    try {
      setMaintenanceSaving(true)
      const updated = await authApi.updateMaintenanceMode(
        maintenanceMode,
        maintenanceMessage,
        derivedHours,
        {
          scheduled_start_at: scheduledStartIso,
          scheduled_end_at: scheduledEndIso,
          schedule_timezone: tz,
          update_schedule: true,
        }
      )
      applyMaintenanceState(updated)
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      alert(typeof msg === 'string' ? msg : 'Failed to save maintenance details')
    } finally {
      setMaintenanceSaving(false)
    }
  }

  const handleSaveEmailTransport = async () => {
    try {
      setEmailTransportSaving(true)
      setEmailTransportMessage(null)
      const updated = await authApi.updateEmailTransport(emailTransport)
      setEmailTransport(updated.transport)
      setEmailEffectiveTransport(updated.effective_transport)
      setEmailSmtpConfigured(Boolean(updated.smtp_configured))
      setEmailGraphConfigured(Boolean(updated.graph_configured))
      setEmailFrom(updated.email_from || '')
      setEmailTransportMessage(`Saved. Active sender: ${emailTransportLabel(updated.effective_transport)}.`)
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setEmailTransportMessage(typeof msg === 'string' ? msg : 'Failed to update email transport')
    } finally {
      setEmailTransportSaving(false)
    }
  }

  const emailTransportReady =
    emailTransport === 'auto'
      ? emailSmtpConfigured || emailGraphConfigured
      : emailTransport === 'graph'
        ? emailGraphConfigured
        : emailSmtpConfigured

  const handleToggleKeepaAccess = async (userId: string, currentAccess: boolean) => {
    if (
      !window.confirm(
        `Are you sure you want to ${currentAccess ? 'revoke' : 'grant'} MSW Overwatch access for this user?`
      )
    ) {
      return
    }

    try {
      setUpdating(userId)
      await authApi.updateUserKeepaAccess(userId, !currentAccess)
      await loadUsers()
    } catch (err: unknown) {
      const errorMessage =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      alert(`Error: ${typeof errorMessage === 'string' ? errorMessage : 'Failed to update user access'}`)
      console.error('Failed to update user access:', err)
    } finally {
      setUpdating(null)
    }
  }

  const handleToggleToolsAccess = async (userId: string, currentAccess: boolean) => {
    if (
      !window.confirm(
        `Are you sure you want to ${currentAccess ? 'revoke' : 'grant'} Tools Management access for this user?`
      )
    ) {
      return
    }

    try {
      setUpdating(userId)
      await authApi.updateUserToolsAccess(userId, !currentAccess)
      await loadUsers()
    } catch (err: unknown) {
      const errorMessage =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      alert(`Error: ${typeof errorMessage === 'string' ? errorMessage : 'Failed to update user access'}`)
      console.error('Failed to update user access:', err)
    } finally {
      setUpdating(null)
    }
  }

  const handleDeactivateUser = async (userId: string, email: string) => {
    if (
      !window.confirm(
        `Are you sure you want to remove ${email}? Their account will be deactivated and they will no longer be able to sign in.`
      )
    ) {
      return
    }

    try {
      setRemoving(userId)
      await authApi.deactivateUser(userId)
      await loadUsers()
    } catch (err: unknown) {
      const errorMessage =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      alert(`Error: ${typeof errorMessage === 'string' ? errorMessage : 'Failed to deactivate user'}`)
      console.error('Failed to deactivate user:', err)
    } finally {
      setRemoving(null)
    }
  }

  const handleApproveUser = async (userId: string, email: string) => {
    if (!window.confirm(`Approve ${email} so they can access the app?`)) {
      return
    }
    try {
      setUpdating(userId)
      await authApi.approveUser(userId)
      await loadUsers()
    } catch (err: unknown) {
      const errorMessage =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      alert(`Error: ${typeof errorMessage === 'string' ? errorMessage : 'Failed to approve user'}`)
    } finally {
      setUpdating(null)
    }
  }

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault()
    const email = newEmail.trim()
    if (!email || !newPassword) {
      setCreateUserMessage('Email and password are required.')
      return
    }
    setCreatingUser(true)
    setCreateUserMessage(null)
    try {
      const result = await authApi.createUser({
        email,
        password: newPassword,
        has_keepa_access: newKeepaAccess,
        is_active: newActive,
      })
      setCreateUserMessage(result.message || `Created ${result.email}`)
      setNewEmail('')
      setNewPassword('')
      await loadUsers()
    } catch (err: unknown) {
      const detail =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined
      setCreateUserMessage(typeof detail === 'string' ? detail : 'Failed to create user')
    } finally {
      setCreatingUser(false)
    }
  }

  if (userInfoLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading...</div>
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading users...</div>
      </div>
    )
  }

  const pendingUsers = users.filter((user) => user.is_active === false)
  const visibleUsers = showPendingOnly ? pendingUsers : users

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
        <p className="mt-1 text-sm text-gray-500">Manage user permissions and access</p>
      </div>

      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Live app sessions</h2>
            <p className="text-sm text-gray-600 mt-1">
              Combined web + Electron openings. Shared accounts (e.g. warehouse stations) count as
              separate sessions. Superadmin only.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadPresence()}
            disabled={presenceLoading}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {presenceLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

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
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{stat.label}</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Email</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Client</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">IP address</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Path</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
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
                  const nameLabel = userDisplayLabel({
                    display_name: s.display_name || undefined,
                    email: s.email || '',
                  })
                  return (
                  <tr key={s.session_id}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{s.email || '—'}</div>
                      {nameLabel !== 'No name' && (
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
                    <td className="px-3 py-2 capitalize text-gray-700">{s.client_type}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-800">
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

      <div className="card p-4 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Create user</h2>
          <p className="text-sm text-gray-600 mt-1">
            Add a login for warehouse stations or other accounts. Users created here appear in the list
            immediately.
          </p>
        </div>
        <form className="grid grid-cols-1 md:grid-cols-2 gap-4" onSubmit={(e) => void handleCreateUser(e)}>
          <label className="block text-sm font-medium text-gray-700">
            Email
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="warehouse1@metroshoewarehouse.com"
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
              autoComplete="off"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Password
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
              autoComplete="new-password"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={newActive}
              onChange={(e) => setNewActive(e.target.checked)}
            />
            Approved (can sign in)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={newKeepaAccess}
              onChange={(e) => setNewKeepaAccess(e.target.checked)}
            />
            MSW Overwatch access (Label Station)
          </label>
          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={creatingUser}
              className="px-4 py-2 rounded-lg bg-[#404040] text-white text-sm font-medium disabled:opacity-50"
            >
              {creatingUser ? 'Creating…' : 'Create user'}
            </button>
            {createUserMessage && (
              <p className={`text-sm ${createUserMessage.includes('success') || createUserMessage.includes('Created') ? 'text-emerald-700' : 'text-red-700'}`}>
                {createUserMessage}
              </p>
            )}
          </div>
        </form>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Maintenance Mode</h2>
            <p className="text-sm text-gray-600">
              When enabled, only superadmin and allowlisted emails can access the app.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleToggleMaintenanceMode()}
            disabled={maintenanceSaving}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 ${
              maintenanceMode ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {maintenanceSaving
              ? 'Updating...'
              : maintenanceMode
                ? 'Disable Maintenance'
                : 'Enable Maintenance'}
          </button>
        </div>
        <div className="text-sm flex flex-wrap items-center gap-2">
          <span
            className={`px-2 py-1 rounded font-medium ${
              maintenanceMode ? 'bg-[#81B81D]/20 text-[#111827]' : 'bg-green-100 text-green-800'
            }`}
          >
            {maintenanceMode ? 'Maintenance ON' : 'Maintenance OFF'}
          </span>
          {!maintenanceMode && maintenanceScheduledStartAt && (
            <span className="px-2 py-1 rounded font-medium bg-amber-100 text-amber-900">
              Scheduled{' '}
              {formatZonedDisplay(maintenanceScheduledStartAt, maintenanceScheduleTimezone)}
              {maintenanceExpectedEndAt
                ? ` → ${formatZonedDisplay(maintenanceExpectedEndAt, maintenanceScheduleTimezone)}`
                : ''}{' '}
              ({maintenanceScheduleTimezone})
            </span>
          )}
        </div>
        <label className="block text-sm font-medium text-gray-700">
          Maintenance message
          <input
            value={maintenanceMessage}
            onChange={(e) => setMaintenanceMessage(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
            placeholder="App is currently under maintenance. Please try again later."
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Maintenance length (hours)
          <input
            type="number"
            min={0}
            max={168}
            step={0.5}
            value={maintenanceDurationHours}
            onChange={(e) =>
              setMaintenanceDurationHours(Math.max(0, Math.min(168, Number(e.target.value) || 0)))
            }
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
            placeholder="e.g. 2"
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Schedule timezone
          <select
            value={maintenanceScheduleTimezone}
            onChange={(e) => setMaintenanceScheduleTimezone(e.target.value)}
            disabled={maintenanceMode}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
          >
            {!MAINTENANCE_TIMEZONE_VALUES.has(maintenanceScheduleTimezone) && (
              <option value={maintenanceScheduleTimezone}>{maintenanceScheduleTimezone}</option>
            )}
            <optgroup label="US Timezones">
              <option value="America/New_York">Eastern Time (UTC-5/-4)</option>
              <option value="America/Chicago">Central Time (UTC-6/-5)</option>
              <option value="America/Denver">Mountain Time (UTC-7/-6)</option>
              <option value="America/Los_Angeles">Pacific Time (UTC-8/-7)</option>
              <option value="America/Anchorage">Alaska Time (UTC-9/-8)</option>
              <option value="Pacific/Honolulu">Hawaii Time (UTC-10)</option>
            </optgroup>
            <optgroup label="Asia">
              <option value="Asia/Taipei">Asia/Taipei (UTC+8)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
              <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
              <option value="Asia/Hong_Kong">Asia/Hong_Kong (UTC+8)</option>
              <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
              <option value="Asia/Seoul">Asia/Seoul (UTC+9)</option>
              <option value="Asia/Dubai">Asia/Dubai (UTC+4)</option>
              <option value="Asia/Kolkata">Asia/Kolkata (UTC+5:30)</option>
            </optgroup>
            <optgroup label="Europe">
              <option value="Europe/London">Europe/London (UTC+0/+1)</option>
              <option value="Europe/Paris">Europe/Paris (UTC+1/+2)</option>
              <option value="Europe/Berlin">Europe/Berlin (UTC+1/+2)</option>
              <option value="Europe/Rome">Europe/Rome (UTC+1/+2)</option>
              <option value="Europe/Madrid">Europe/Madrid (UTC+1/+2)</option>
              <option value="Europe/Moscow">Europe/Moscow (UTC+3)</option>
            </optgroup>
            <optgroup label="Australia & Pacific">
              <option value="Australia/Sydney">Australia/Sydney (UTC+10/+11)</option>
              <option value="Australia/Melbourne">Australia/Melbourne (UTC+10/+11)</option>
              <option value="Australia/Brisbane">Australia/Brisbane (UTC+10)</option>
              <option value="Pacific/Auckland">Pacific/Auckland (UTC+12/+13)</option>
            </optgroup>
            <optgroup label="Americas (Other)">
              <option value="America/Toronto">Canada Eastern (UTC-5/-4)</option>
              <option value="America/Vancouver">Canada Pacific (UTC-8/-7)</option>
              <option value="America/Mexico_City">Mexico City (UTC-6/-5)</option>
              <option value="America/Sao_Paulo">Sao Paulo (UTC-3)</option>
              <option value="America/Buenos_Aires">Buenos Aires (UTC-3)</option>
            </optgroup>
            <optgroup label="Other">
              <option value="UTC">UTC (UTC+0)</option>
              <option value="Africa/Johannesburg">Africa/Johannesburg (UTC+2)</option>
              <option value="Asia/Jerusalem">Asia/Jerusalem (UTC+2/+3)</option>
            </optgroup>
          </select>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-gray-700">
            Schedule start date
            <input
              type="date"
              value={maintenanceScheduleDate}
              onChange={(e) => setMaintenanceScheduleDate(e.target.value)}
              disabled={maintenanceMode}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Schedule start hour
            <input
              type="time"
              step={3600}
              value={maintenanceScheduleTime}
              onChange={(e) => setMaintenanceScheduleTime(e.target.value)}
              disabled={maintenanceMode}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Schedule end date
            <input
              type="date"
              value={maintenanceScheduleEndDate}
              onChange={(e) => setMaintenanceScheduleEndDate(e.target.value)}
              disabled={maintenanceMode}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Schedule end hour
            <input
              type="time"
              step={3600}
              value={maintenanceScheduleEndTime}
              onChange={(e) => setMaintenanceScheduleEndTime(e.target.value)}
              disabled={maintenanceMode}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
            />
          </label>
        </div>
        <p className="text-xs text-gray-500">
          Optional. While maintenance is off, save a future start and end in the selected timezone to
          auto-enable for that window. Length hours is filled from the start/end gap when you save.
          Clear all schedule fields and save to remove a schedule. Use Enable Maintenance for an
          immediate start.
        </p>
        {maintenanceMode && maintenanceExpectedEndAt && (
          <p className="text-xs text-gray-600">
            Expected completion:{' '}
            {formatZonedDisplay(maintenanceExpectedEndAt, maintenanceScheduleTimezone)} (
            {maintenanceScheduleTimezone})
          </p>
        )}
        <div>
          <button
            type="button"
            onClick={() => void handleSaveMaintenanceDetails()}
            disabled={maintenanceSaving}
            className="px-3 py-1.5 rounded-md bg-[#404040] text-white text-sm font-medium disabled:opacity-50"
          >
            {maintenanceSaving ? 'Saving...' : 'Save Maintenance Details'}
          </button>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Outbound Email Transport</h2>
          <p className="text-sm text-gray-600 mt-1">
            Choose how MAP report emails are sent from{' '}
            <span className="font-medium">{emailFrom || 'overwatch@'}</span>. SMTP and Graph API
            credentials stay in server environment variables — this only switches which path is active.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['auto', 'graph', 'smtp'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setEmailTransport(mode)
                setEmailTransportMessage(null)
              }}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                emailTransport === mode
                  ? 'border-[#404040] bg-[#404040] text-white'
                  : 'border-gray-300 bg-white text-gray-800 hover:border-gray-500'
              }`}
            >
              {mode === 'auto' ? 'Auto' : mode === 'graph' ? 'Graph API' : 'SMTP'}
            </button>
          ))}
        </div>
        <div className="text-sm space-y-1">
          <p>
            <span className="font-medium">Currently sending via:</span>{' '}
            <span
              className={`px-2 py-0.5 rounded font-medium ${
                emailEffectiveTransport === 'graph'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-amber-100 text-amber-900'
              }`}
            >
              {emailTransportLabel(emailEffectiveTransport)}
            </span>
          </p>
          <p className="text-gray-600">
            SMTP {emailSmtpConfigured ? 'configured' : 'not configured'} · Graph API{' '}
            {emailGraphConfigured ? 'configured' : 'not configured'}
          </p>
          {emailTransport === 'auto' && (
            <p className="text-xs text-gray-500">
              Auto uses Graph API when Azure credentials are present; otherwise SMTP.
            </p>
          )}
          {!emailTransportReady && (
            <p className="text-xs text-red-700">
              The selected mode is not fully configured on the server. Emails will fail until the
              required credentials are set on Render.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSaveEmailTransport()}
            disabled={emailTransportSaving}
            className="px-4 py-2 rounded-lg bg-[#404040] text-white text-sm font-medium disabled:opacity-50"
          >
            {emailTransportSaving ? 'Saving…' : 'Save Email Transport'}
          </button>
          {emailTransportMessage && (
            <p
              className={`text-sm ${
                emailTransportMessage.startsWith('Saved') ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {emailTransportMessage}
            </p>
          )}
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Label Station — UPC (DNK) Print ID</h2>
          <p className="text-sm text-gray-600 mt-1">
            Short SKU (Amazon) is available to everyone with Label Station access. Only emails on this
            list can switch Print ID to <span className="font-medium">UPC (DNK)</span>.
          </p>
        </div>
        {upcDnkLoading ? (
          <p className="text-sm text-gray-500">Loading allowlist…</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {upcDnkEmails.length === 0 ? (
                <p className="text-sm text-gray-500">No emails allowlisted — UPC (DNK) is off for everyone.</p>
              ) : (
                upcDnkEmails.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-2 rounded-full border border-teal-300 bg-teal-50 px-3 py-1 text-sm text-teal-950"
                  >
                    {email}
                    <button
                      type="button"
                      disabled={upcDnkSaving}
                      onClick={() => void handleRemoveUpcDnkEmail(email)}
                      className="rounded-full px-1.5 text-teal-800 hover:bg-teal-200 disabled:opacity-50"
                      aria-label={`Remove ${email}`}
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void handleAddUpcDnkEmail()
              }}
            >
              <label className="block text-sm font-medium text-gray-700 flex-1 min-w-[16rem]">
                Add email
                <input
                  type="email"
                  value={upcDnkDraftEmail}
                  onChange={(e) => setUpcDnkDraftEmail(e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder="name@metroshoewarehouse.com"
                  autoComplete="off"
                />
              </label>
              <button
                type="submit"
                disabled={upcDnkSaving || !upcDnkDraftEmail.trim()}
                className="px-4 py-2 rounded-lg bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 disabled:opacity-50"
              >
                {upcDnkSaving ? 'Saving…' : 'Add'}
              </button>
            </form>
            {upcDnkMessage && <p className="text-sm text-emerald-700">{upcDnkMessage}</p>}
            {upcDnkError && <p className="text-sm text-red-700">{upcDnkError}</p>}
          </>
        )}
      </div>

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setShowPendingOnly(false)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            !showPendingOnly
              ? 'bg-[#404040] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All Users ({users.length})
        </button>
        <button
          type="button"
          onClick={() => setShowPendingOnly(true)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            showPendingOnly
              ? 'bg-[#81B81D] text-white'
              : 'bg-[#81B81D]/20 text-[#111827] hover:bg-[#81B81D]/30'
          }`}
        >
          Pending Requests ({pendingUsers.length})
        </button>
      </div>

      {error && (
        <div className="card p-4 bg-red-50 border-red-200">
          <div className="text-red-800">{error}</div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="app-table-scroll overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Account Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  MSW Overwatch Access
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tools Management Access
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {visibleUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                    {showPendingOnly ? 'No pending requests' : 'No users found'}
                  </td>
                </tr>
              ) : (
                visibleUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-10 h-10 bg-[#404040] rounded-full flex items-center justify-center">
                          <span className="text-white text-sm font-semibold">
                            {userInitial(user)}
                          </span>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {userDisplayLabel(user)}
                          </div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded ${
                          user.role === 'admin'
                            ? 'bg-[#404040]/10 text-[#404040]'
                            : user.role === 'superadmin'
                              ? 'bg-purple-100 text-purple-900'
                              : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {user.role === 'admin'
                          ? 'Admin'
                          : user.role === 'superadmin'
                            ? 'Superadmin'
                            : 'User'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded ${
                          user.is_active === false ? 'bg-[#81B81D]/20 text-[#111827]' : 'bg-green-100 text-green-800'
                        }`}
                      >
                        {user.is_active === false ? 'Pending Approval' : 'Approved'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded ${
                          user.has_keepa_access ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {user.has_keepa_access ? '✓ Granted' : '✗ Not Granted'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded ${
                          user.can_manage_tools ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {user.can_manage_tools ? '✓ Granted' : '✗ Not Granted'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex flex-col gap-2">
                        {user.is_active === false && (
                          <button
                            type="button"
                            onClick={() => handleApproveUser(user.id, user.email)}
                            disabled={updating === user.id}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {updating === user.id ? 'Updating...' : 'Approve user'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleKeepaAccess(user.id, user.has_keepa_access)}
                          disabled={updating === user.id}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            user.has_keepa_access
                              ? 'bg-red-600 hover:bg-red-700 text-white'
                              : 'bg-green-600 hover:bg-green-700 text-white'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {updating === user.id
                            ? 'Updating...'
                            : user.has_keepa_access
                              ? 'Revoke access'
                              : 'Grant access'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleToolsAccess(user.id, user.can_manage_tools)}
                          disabled={updating === user.id}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            user.can_manage_tools
                              ? 'bg-red-600 hover:bg-red-700 text-white'
                              : 'bg-green-600 hover:bg-green-700 text-white'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          {updating === user.id
                            ? 'Updating...'
                            : user.can_manage_tools
                              ? 'Revoke Tools'
                              : 'Grant Tools'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeactivateUser(user.id, user.email)}
                          disabled={
                            removing === user.id ||
                            updating === user.id ||
                            user.id === userInfo?.id
                          }
                          title={
                            user.id === userInfo?.id
                              ? 'You cannot remove your own account'
                              : 'Deactivate account — user cannot sign in'
                          }
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-700 hover:bg-red-800 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {removing === user.id ? 'Removing…' : 'Remove user'}
                        </button>
                      </div>
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
