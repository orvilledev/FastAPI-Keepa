import { useEffect, useState } from 'react'
import { authApi } from '../../services/api'

interface User {
  id: string
  email: string
  role: string
  display_name?: string
  has_keepa_access: boolean
  can_manage_tools: boolean
  created_at: string
}

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [isSuperadmin, setIsSuperadmin] = useState(false)

  useEffect(() => {
    checkSuperadmin()
    loadUsers()
  }, [])

  const checkSuperadmin = async () => {
    try {
      const userInfo = await authApi.getCurrentUser()
      setCurrentUser(userInfo)
      setIsSuperadmin(userInfo.email?.toLowerCase() === 'orvillebarba@gmail.com')
    } catch (err) {
      console.error('Failed to check superadmin status:', err)
      setIsSuperadmin(false)
    }
  }

  const loadUsers = async () => {
    try {
      setError('')
      setLoading(true)
      const data = await authApi.getAllUsers()
      setUsers(data.users || [])
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to load users')
      console.error('Failed to load users:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleToggleKeepaAccess = async (userId: string, currentAccess: boolean) => {
    if (!window.confirm(`Are you sure you want to ${currentAccess ? 'revoke' : 'grant'} Keepa Alert Service access for this user?`)) {
      return
    }

    try {
      setUpdating(userId)
      await authApi.updateUserKeepaAccess(userId, !currentAccess)
      // Reload users to get updated data
      await loadUsers()
    } catch (err: any) {
      const errorMessage = err?.response?.data?.detail || err?.message || 'Failed to update user access'
      alert(`Error: ${errorMessage}`)
      console.error('Failed to update user access:', err)
    } finally {
      setUpdating(null)
    }
  }

  const handleToggleToolsAccess = async (userId: string, currentAccess: boolean) => {
    if (!window.confirm(`Are you sure you want to ${currentAccess ? 'revoke' : 'grant'} Tools Management access for this user?`)) {
      return
    }

    try {
      setUpdating(userId)
      await authApi.updateUserToolsAccess(userId, !currentAccess)
      // Reload users to get updated data
      await loadUsers()
    } catch (err: any) {
      const errorMessage = err?.response?.data?.detail || err?.message || 'Failed to update user access'
      alert(`Error: ${errorMessage}`)
      console.error('Failed to update user access:', err)
    } finally {
      setUpdating(null)
    }
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
                  Keepa Alert Service Access
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
                        <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
                          <span className="text-white text-sm font-semibold">
                            {user.display_name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {user.display_name || 'No name'}
                          </div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        user.role === 'admin' 
                          ? 'bg-purple-100 text-purple-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {user.role === 'admin' ? 'Admin' : 'User'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        user.has_keepa_access 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {user.has_keepa_access ? '✓ Granted' : '✗ Not Granted'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        user.can_manage_tools 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {user.can_manage_tools ? '✓ Granted' : '✗ Not Granted'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex flex-col gap-2">
                        <button
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
                              ? 'Revoke Keepa' 
                              : 'Grant Keepa'
                          }
                        </button>
                        <button
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
                              : 'Grant Tools'
                          }
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

