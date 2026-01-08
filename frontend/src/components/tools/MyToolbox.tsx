import { useEffect, useState } from 'react'
import { toolsApi } from '../../services/api'
import type { PublicTool, UserTool, JobAid } from '../../types'

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
  const [starredJobAids, setStarredJobAids] = useState<JobAid[]>([])
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
      // Load starred tools, job aids, and personal tools
      const [toolboxData, personal] = await Promise.all([
        toolsApi.getMyToolbox().catch(() => ({ public_tools: [], job_aids: [] })),
        toolsApi.getUserTools().catch(() => [])
      ])
      setStarredTools(toolboxData.public_tools || [])
      setStarredJobAids(toolboxData.job_aids || [])
      setPersonalTools(personal)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load your toolbox')
    } finally {
      setLoading(false)
    }
  }

  const handleUnstar = async (toolId: string, isJobAid: boolean = false) => {
    try {
      if (isJobAid) {
        await toolsApi.unstarJobAid(toolId)
        setStarredJobAids(starredJobAids.filter(aid => aid.id !== toolId))
      } else {
        await toolsApi.unstarTool(toolId)
        setStarredTools(starredTools.filter(tool => tool.id !== toolId))
      }
      setSuccess('Item removed from toolbox!')
      setTimeout(() => setSuccess(''), 2000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to remove item from toolbox')
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

  const hasAnyTools = starredTools.length > 0 || starredJobAids.length > 0 || personalTools.length > 0

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
          <p className="mt-1 text-sm text-gray-500">Your starred tools, job aids, and personal tools</p>
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

      {!hasAnyTools ? (
        <div className="card p-12 text-center">
          <div className="text-gray-500 mb-2">Your toolbox is empty.</div>
          <p className="text-sm text-gray-400 mb-4">
            Star tools from the Public Tools or Job Aids pages, or create your own tools.
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
        <div className="space-y-8">
          {/* Starred Job Aids Section */}
          {starredJobAids.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-2xl font-bold text-gray-900">🛠️ Job Aids</h2>
                <span className="text-sm text-gray-500">({starredJobAids.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {starredJobAids.map((aid) => (
                  <div key={aid.id} className="card card-hover p-6 border-l-4 border-l-blue-500">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-3 flex-1">
                        {aid.icon && <span className="text-2xl">{aid.icon}</span>}
                        <h3 className="text-lg font-semibold text-gray-900">{aid.name}</h3>
                      </div>
                      <button
                        onClick={() => handleUnstar(aid.id, true)}
                        className="text-yellow-500 hover:text-yellow-600 text-2xl transition-transform hover:scale-110"
                        title="Remove from toolbox"
                      >
                        ⭐
                      </button>
                    </div>
                    {aid.description && (
                      <p className="text-sm text-gray-600 mb-3">{aid.description}</p>
                    )}
                    {aid.developer && (
                      <p className="text-xs text-gray-500 mb-3">
                        <span className="font-medium">Developer:</span> {aid.developer}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mb-4">
                      {aid.category && (
                        <span className="inline-block px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                          {aid.category}
                        </span>
                      )}
                      <span className="inline-block px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                        Job Aid
                      </span>
                    </div>
                    <div className="space-y-2">
                      <a
                        href={aid.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm inline-block w-full text-center px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg hover:from-orange-600 hover:to-orange-700 transition-all font-medium shadow-md hover:shadow-lg"
                      >
                        Open Job Aid →
                      </a>
                      {aid.video_url && (
                        <a
                          href={aid.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm inline-block w-full text-center px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-all font-medium shadow-md hover:shadow-lg"
                        >
                          📹 Watch Video →
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Starred Public Tools Section */}
          {starredTools.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-2xl font-bold text-gray-900">⭐ Starred Tools</h2>
                <span className="text-sm text-gray-500">({starredTools.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {starredTools.map((tool) => (
                  <div key={tool.id} className="card card-hover p-6 border-l-4 border-l-indigo-500">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-3 flex-1">
                        {tool.icon && <span className="text-2xl">{tool.icon}</span>}
                        <h3 className="text-lg font-semibold text-gray-900">{tool.name}</h3>
                      </div>
                      <button
                        onClick={() => handleUnstar(tool.id, false)}
                        className="text-yellow-500 hover:text-yellow-600 text-2xl transition-transform hover:scale-110"
                        title="Remove from toolbox"
                      >
                        ⭐
                      </button>
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
            </div>
          )}

          {/* Personal Tools Section */}
          {personalTools.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-2xl font-bold text-gray-900">🔧 Personal Tools</h2>
                <span className="text-sm text-gray-500">({personalTools.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {personalTools.map((tool) => (
                  <div key={tool.id} className="card card-hover p-6 border-l-4 border-l-purple-500">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-3 flex-1">
                        {tool.icon && <span className="text-2xl">{tool.icon}</span>}
                        <h3 className="text-lg font-semibold text-gray-900">{tool.name}</h3>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleEdit(tool)}
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
                      <span className="inline-block px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded">
                        Personal
                      </span>
                    </div>
                    <a
                      href={tool.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm inline-block w-full text-center px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition-all font-medium shadow-md hover:shadow-lg"
                    >
                      Open Tool →
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

