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
  const [maintenanceSaving, setMaintenanceSaving] = useState(false)

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

  const loadMaintenanceMode = async () => {
    try {
      const state = await authApi.getMaintenanceMode()
      setMaintenanceMode(Boolean(state.maintenance_mode))
      setMaintenanceMessage(state.message || '')
      setMaintenanceDurationHours(
        typeof state.duration_hours === 'number' && state.duration_hours > 0 ? state.duration_hours : 0
      )
      setMaintenanceExpectedEndAt(state.expected_end_at || null)
    } catch (err) {
      console.error('Failed to load maintenance mode:', err)
    }
  }

  useEffect(() => {
    if (userInfoLoading) return
    if (!isSuperadmin) return
    void loadUsers()
    void loadMaintenanceMode()
  }, [userInfoLoading, isSuperadmin])

  const handleToggleMaintenanceMode = async () => {
    const nextMode = !maintenanceMode
    const confirmed = window.confirm(
      nextMode
        ? 'Enable maintenance mode? Non-superadmin users will see the maintenance page.'
        : 'Disable maintenance mode and restore normal access for users?'
    )
    if (!confirmed) return
    try {
      setMaintenanceSaving(true)
      const updated = await authApi.updateMaintenanceMode(
        nextMode,
        maintenanceMessage,
        maintenanceDurationHours > 0 ? maintenanceDurationHours : 0
      )
      setMaintenanceMode(Boolean(updated.maintenance_mode))
      setMaintenanceMessage(updated.message || '')
      setMaintenanceDurationHours(
        typeof updated.duration_hours === 'number' && updated.duration_hours > 0 ? updated.duration_hours : 0
      )
      setMaintenanceExpectedEndAt(updated.expected_end_at || null)
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
    try {
      setMaintenanceSaving(true)
      const updated = await authApi.updateMaintenanceMode(
        maintenanceMode,
        maintenanceMessage,
        maintenanceDurationHours > 0 ? maintenanceDurationHours : 0
      )
      setMaintenanceMode(Boolean(updated.maintenance_mode))
      setMaintenanceMessage(updated.message || '')
      setMaintenanceDurationHours(
        typeof updated.duration_hours === 'number' && updated.duration_hours > 0 ? updated.duration_hours : 0
      )
      setMaintenanceExpectedEndAt(updated.expected_end_at || null)
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
        <div className="text-sm">
          <span
            className={`px-2 py-1 rounded font-medium ${
              maintenanceMode ? 'bg-[#81B81D]/20 text-[#111827]' : 'bg-green-100 text-green-800'
            }`}
          >
            {maintenanceMode ? 'Maintenance ON' : 'Maintenance OFF'}
          </span>
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
        {maintenanceMode && maintenanceExpectedEndAt && (
          <p className="text-xs text-gray-600">
            Expected completion: {new Date(maintenanceExpectedEndAt).toLocaleString()}
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
