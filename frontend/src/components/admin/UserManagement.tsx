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

  useEffect(() => {
    if (userInfoLoading) return
    if (!isSuperadmin) return
    void loadUsers()
  }, [userInfoLoading, isSuperadmin])

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
        <p className="mt-1 text-sm text-gray-500">Manage user permissions and access</p>
      </div>

      {error && (
        <div className="card p-4 bg-red-50 border-red-200">
          <div className="text-red-800">{error}</div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
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
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-10 h-10 bg-[#0B1020] rounded-full flex items-center justify-center">
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
                            ? 'bg-[#0B1020]/10 text-[#0B1020]'
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
