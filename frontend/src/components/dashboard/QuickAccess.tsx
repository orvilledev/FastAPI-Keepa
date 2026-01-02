import { useEffect, useState } from 'react'
import { quickAccessApi } from '../../services/api'
import type { QuickAccessLink } from '../../types'

export default function QuickAccess() {
  const [links, setLinks] = useState<QuickAccessLink[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingLink, setEditingLink] = useState<QuickAccessLink | null>(null)
  const [formData, setFormData] = useState({
    title: '',
    url: '',
    icon: '',
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    loadLinks()
  }, [])

  // Don't crash if API fails - just show empty state
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading && links.length === 0) {
        setLoading(false)
      }
    }, 3000) // Timeout after 3 seconds
    return () => clearTimeout(timer)
  }, [loading, links.length])

  const loadLinks = async () => {
    try {
      setLoading(true)
      const data = await quickAccessApi.getLinks()
      setLinks(data)
    } catch (err: any) {
      console.error('Failed to load quick access links:', err)
      // If it's a 404 or table doesn't exist, that's okay - user just hasn't created links yet
      if (err.response?.status !== 404) {
        setError('Failed to load quick access links. Please refresh the page.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!formData.title || !formData.url) {
      setError('Title and URL are required')
      return
    }

    try {
      if (editingLink) {
        await quickAccessApi.updateLink(editingLink.id, formData)
        setSuccess('Link updated successfully!')
      } else {
        await quickAccessApi.createLink(formData)
        setSuccess('Link added successfully!')
      }
      setFormData({ title: '', url: '', icon: '' })
      setShowAddForm(false)
      setEditingLink(null)
      loadLinks()
      
      // Clear success message after 2 seconds
      setTimeout(() => {
        setSuccess('')
      }, 2000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save link')
    }
  }

  const handleEdit = (link: QuickAccessLink) => {
    setEditingLink(link)
    setFormData({
      title: link.title,
      url: link.url,
      icon: link.icon || '',
    })
    setShowAddForm(true)
  }

  const handleDelete = async (linkId: string) => {
    if (!confirm('Are you sure you want to delete this link?')) {
      return
    }

    try {
      await quickAccessApi.deleteLink(linkId)
      setSuccess('Link deleted successfully!')
      loadLinks()
      
      // Clear success message after 2 seconds
      setTimeout(() => {
        setSuccess('')
      }, 2000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete link')
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Quick Access</h2>
        </div>
        <div className="text-center py-4 text-gray-500 text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900">Quick Access</h2>
        <button
          onClick={() => {
            setShowAddForm(true)
            setEditingLink(null)
            setFormData({ title: '', url: '', icon: '' })
          }}
          className="px-3 py-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-colors"
        >
          + Add Link
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          {success}
        </div>
      )}

      {showAddForm && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-medium text-gray-900">
              {editingLink ? 'Edit Link' : 'Add New Link'}
            </h3>
            <button
              onClick={() => {
                setShowAddForm(false)
                setEditingLink(null)
                setFormData({ title: '', url: '', icon: '' })
                setError('')
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title *
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                placeholder="e.g., Keepa API"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                URL *
              </label>
              <input
                type="url"
                required
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                placeholder="https://example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Icon (emoji)
              </label>
              <input
                type="text"
                value={formData.icon}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                placeholder="🔗"
                maxLength={2}
              />
            </div>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false)
                  setEditingLink(null)
                  setFormData({ title: '', url: '', icon: '' })
                  setError('')
                }}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                {editingLink ? 'Update' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      )}

      {links.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          No quick access links yet. Click "Add Link" to get started.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {links.map((link) => (
            <div
              key={link.id}
              className="group relative p-4 border border-gray-200 rounded-lg hover:border-indigo-300 hover:shadow-md transition-all"
            >
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center text-center space-y-2"
              >
                {link.icon && (
                  <span className="text-3xl">{link.icon}</span>
                )}
                <span className="text-sm font-medium text-gray-900 group-hover:text-indigo-600">
                  {link.title}
                </span>
              </a>
              <div className="absolute top-2 right-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    handleEdit(link)
                  }}
                  className="p-1 text-indigo-600 hover:bg-indigo-50 rounded"
                  title="Edit"
                >
                  ✏️
                </button>
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    handleDelete(link.id)
                  }}
                  className="p-1 text-red-600 hover:bg-red-50 rounded"
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

