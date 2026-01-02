import { useEffect, useState } from 'react'
import { toolsApi } from '../../services/api'
import type { PublicTool, UserTool } from '../../types'

interface ToolItem {
  id: string
  name: string
  description?: string
  url: string
  category?: string
  icon?: string
  developer?: string
  isStarred?: boolean
  isPersonal?: boolean
}

export default function MyToolbox() {
  const [starredTools, setStarredTools] = useState<PublicTool[]>([])
  const [personalTools, setPersonalTools] = useState<UserTool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingTool, setEditingTool] = useState<UserTool | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    url: '',
    developer: '',
    category: '',
    icon: '',
  })

  useEffect(() => {
    loadToolbox()
  }, [])

  const loadToolbox = async () => {
    try {
      setLoading(true)
      setError('')
      // Load both starred tools and personal tools
      const [starred, personal] = await Promise.all([
        toolsApi.getMyToolbox().catch(() => []),
        toolsApi.getUserTools().catch(() => [])
      ])
      setStarredTools(starred)
      setPersonalTools(personal)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load your toolbox')
    } finally {
      setLoading(false)
    }
  }

  const handleUnstar = async (toolId: string) => {
    try {
      await toolsApi.unstarTool(toolId)
      setStarredTools(starredTools.filter(tool => tool.id !== toolId))
      setSuccess('Tool removed from toolbox!')
      setTimeout(() => setSuccess(''), 2000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to remove tool from toolbox')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!formData.name || !formData.url) {
      setError('Name and URL are required')
      return
    }

    try {
      if (editingTool) {
        await toolsApi.updateUserTool(editingTool.id, formData)
        setSuccess('Tool updated successfully!')
      } else {
        await toolsApi.createUserTool(formData)
        setSuccess('Tool created successfully!')
      }
      setFormData({ name: '', description: '', url: '', developer: '', category: '', icon: '' })
      setShowAddForm(false)
      setEditingTool(null)
      loadToolbox()
      setTimeout(() => setSuccess(''), 2000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save tool')
    }
  }

  const handleEdit = (tool: UserTool) => {
    setEditingTool(tool)
    setFormData({
      name: tool.name,
      description: tool.description || '',
      url: tool.url,
      developer: tool.developer || '',
      category: tool.category || '',
      icon: tool.icon || '',
    })
    setShowAddForm(true)
  }

  const handleDelete = async (toolId: string) => {
    if (!confirm('Are you sure you want to delete this tool?')) {
      return
    }

    try {
      await toolsApi.deleteUserTool(toolId)
      setPersonalTools(personalTools.filter(tool => tool.id !== toolId))
      setSuccess('Tool deleted successfully!')
      setTimeout(() => setSuccess(''), 2000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete tool')
    }
  }

  // Combine starred and personal tools for display
  const allTools: ToolItem[] = [
    ...starredTools.map(tool => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      url: tool.url,
      category: tool.category,
      icon: tool.icon,
      developer: tool.developer,
      isStarred: true,
      isPersonal: false,
    })),
    ...personalTools.map(tool => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      url: tool.url,
      category: tool.category,
      icon: tool.icon,
      developer: tool.developer,
      isStarred: false,
      isPersonal: true,
    }))
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading your toolbox...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My Toolbox</h1>
          <p className="mt-1 text-sm text-gray-500">Your starred tools and personal tools</p>
        </div>
        <button
          onClick={() => {
            setShowAddForm(true)
            setEditingTool(null)
            setFormData({ name: '', description: '', url: '', developer: '', category: '', icon: '' })
          }}
          className="btn-primary"
        >
          + Create Tool
        </button>
      </div>

      {error && (
        <div className="card p-4 bg-red-50 border-red-200">
          <div className="text-red-800">{error}</div>
        </div>
      )}

      {success && (
        <div className="card p-4 bg-green-50 border-green-200">
          <div className="text-green-800">{success}</div>
        </div>
      )}

      {/* Create/Edit Form */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-semibold text-gray-900">
                  {editingTool ? 'Edit Tool' : 'Create New Tool'}
                </h2>
                <button
                  onClick={() => {
                    setShowAddForm(false)
                    setEditingTool(null)
                    setFormData({ name: '', description: '', url: '', developer: '', category: '', icon: '' })
                    setError('')
                  }}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Link *
                  </label>
                  <input
                    type="url"
                    required
                    value={formData.url}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="https://example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description *
                  </label>
                  <textarea
                    required
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    rows={4}
                    placeholder="Brief description of what this tool does..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Developer Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.developer}
                    onChange={(e) => setFormData({ ...formData, developer: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="e.g., John Doe, Company Name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tool Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="e.g., Keepa API Documentation"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Category
                    </label>
                    <input
                      type="text"
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="e.g., API, Documentation"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Icon (emoji)
                  </label>
                  <input
                    type="text"
                    value={formData.icon}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="🔧"
                    maxLength={2}
                  />
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(false)
                      setEditingTool(null)
                      setFormData({ name: '', description: '', url: '', developer: '', category: '', icon: '' })
                      setError('')
                    }}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    {editingTool ? 'Update Tool' : 'Create Tool'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {allTools.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-gray-500 mb-2">Your toolbox is empty.</div>
          <p className="text-sm text-gray-400 mb-4">
            Star tools from the Public Tools page or create your own tools.
          </p>
          <button
            onClick={() => {
              setShowAddForm(true)
              setEditingTool(null)
              setFormData({ name: '', description: '', url: '', developer: '', category: '', icon: '' })
            }}
            className="btn-primary"
          >
            Create Your First Tool
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {allTools.map((tool) => (
            <div key={tool.id} className="card card-hover p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3 flex-1">
                  {tool.icon && <span className="text-2xl">{tool.icon}</span>}
                  <h3 className="text-lg font-semibold text-gray-900">{tool.name}</h3>
                </div>
                <div className="flex items-center space-x-2">
                  {tool.isStarred && (
                    <button
                      onClick={() => handleUnstar(tool.id)}
                      className="text-yellow-500 hover:text-yellow-600 text-2xl transition-transform hover:scale-110"
                      title="Remove from toolbox"
                    >
                      ⭐
                    </button>
                  )}
                  {tool.isPersonal && (
                    <>
                      <button
                        onClick={() => handleEdit(tool as any)}
                        className="text-indigo-600 hover:text-indigo-800 text-sm"
                        title="Edit"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDelete(tool.id)}
                        className="text-red-600 hover:text-red-800 text-sm"
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </>
                  )}
                </div>
              </div>
              {tool.description && (
                <p className="text-sm text-gray-600 mb-3">{tool.description}</p>
              )}
              {tool.developer && (
                <p className="text-xs text-gray-500 mb-3">
                  <span className="font-medium">Developer:</span> {tool.developer}
                </p>
              )}
              <div className="flex items-center gap-2 mb-4">
                {tool.category && (
                  <span className="inline-block px-2 py-1 text-xs font-medium bg-indigo-100 text-indigo-800 rounded">
                    {tool.category}
                  </span>
                )}
                {tool.isPersonal && (
                  <span className="inline-block px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded">
                    Personal
                  </span>
                )}
              </div>
              <a
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary text-sm inline-block w-full text-center"
              >
                Open Tool →
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

