import { useEffect, useState } from 'react'
import { toolsApi, authApi } from '../../services/api'
import type { JobAid } from '../../types'

export default function JobAids() {
  const [aids, setAids] = useState<JobAid[]>([])
  const [starredAids, setStarredAids] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [canManageTools, setCanManageTools] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingAid, setEditingAid] = useState<JobAid | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    url: '',
    video_url: '',
    developer: '',
    category: '',
    icon: '',
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    loadAids()
    checkToolsAccess()
  }, [])

  const loadStarredStatus = async () => {
    try {
      const starredIds = await toolsApi.getStarredJobAidIds()
      setStarredAids(new Set(starredIds))
    } catch (err) {
      console.error('Failed to load starred status:', err)
    }
  }

  const checkToolsAccess = async () => {
    try {
      const userInfo = await authApi.getCurrentUser()
      setCanManageTools(userInfo.can_manage_tools || false)
    } catch (err) {
      console.error('Failed to check tools access:', err)
      setCanManageTools(false)
    }
  }

  const loadAids = async () => {
    try {
      setLoading(true)
      const data = await toolsApi.getJobAids()
      setAids(data)
      // Load starred status after aids are loaded
      await loadStarredStatus()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load job aids')
    } finally {
      setLoading(false)
    }
  }

  const handleStarToggle = async (aidId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setError('')
    setSuccess('')
    
    try {
      const isStarred = starredAids.has(aidId)
      if (isStarred) {
        await toolsApi.unstarJobAid(aidId)
        setStarredAids(prev => {
          const newSet = new Set(prev)
          newSet.delete(aidId)
          return newSet
        })
        setSuccess('Job aid removed from your toolbox!')
      } else {
        await toolsApi.starJobAid(aidId)
        setStarredAids(prev => new Set(prev).add(aidId))
        setSuccess('Job aid added to your toolbox!')
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update star status')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    try {
      if (editingAid) {
        // Update existing aid
        await toolsApi.updateJobAid(editingAid.id, formData)
        setSuccess('Job aid updated successfully!')
      } else {
        // Create new aid
        await toolsApi.createJobAid(formData)
        setSuccess('Job aid added successfully!')
      }
      setFormData({ name: '', description: '', url: '', video_url: '', developer: '', category: '', icon: '' })
      setShowAddForm(false)
      setEditingAid(null)
      loadAids()
    } catch (err: any) {
      if (err.response?.status === 403) {
        setError('Permission to manage tools required')
      } else {
        setError(err.response?.data?.detail || editingAid ? 'Failed to update job aid' : 'Failed to add job aid')
      }
    }
  }

  const handleEdit = (aid: JobAid) => {
    setEditingAid(aid)
    setFormData({
      name: aid.name,
      description: aid.description || '',
      url: aid.url,
      video_url: aid.video_url || '',
      developer: aid.developer || '',
      category: aid.category || '',
      icon: aid.icon || '',
    })
    setShowAddForm(true)
  }

  const handleDelete = async (aidId: string) => {
    if (!confirm('Are you sure you want to delete this job aid?')) {
      return
    }

    try {
      await toolsApi.deleteJobAid(aidId)
      setSuccess('Job aid deleted successfully!')
      loadAids()
    } catch (err: any) {
      if (err.response?.status === 403) {
        setError('Permission to manage tools required')
      } else {
        setError(err.response?.data?.detail || 'Failed to delete job aid')
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading job aids...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Job Aids</h1>
          <p className="mt-1 text-sm text-gray-500">Access job-related tools and resources</p>
        </div>
        {canManageTools && (
          <button
            onClick={() => setShowAddForm(true)}
            className="btn-primary"
          >
            Create Job Aid
          </button>
        )}
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

      {/* Search Box */}
      {aids.length > 0 && (
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg
              className="h-5 w-5 text-gray-400"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search job aids by name, description, developer, or category..."
            className="block w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
            >
              <svg
                className="h-5 w-5 text-gray-400 hover:text-gray-600"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Category Filter Menu */}
      {aids.length > 0 && (() => {
        const categories = Array.from(new Set(aids.map(aid => aid.category).filter(Boolean))) as string[]
        
        // Filter aids by category and search term
        let filteredAids = aids
        
        // Apply category filter
        if (selectedCategory) {
          filteredAids = filteredAids.filter(aid => aid.category === selectedCategory)
        }
        
        // Apply search filter
        if (searchTerm.trim()) {
          const searchLower = searchTerm.toLowerCase().trim()
          filteredAids = filteredAids.filter(aid => 
            aid.name.toLowerCase().includes(searchLower) ||
            (aid.description && aid.description.toLowerCase().includes(searchLower)) ||
            (aid.developer && aid.developer.toLowerCase().includes(searchLower)) ||
            (aid.category && aid.category.toLowerCase().includes(searchLower))
          )
        }

        return (
          <>
            <div className="flex flex-wrap gap-2 mb-6">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedCategory === null
                    ? 'bg-[#0B1020] text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All
              </button>
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    selectedCategory === category
                      ? 'bg-[#0B1020] text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>

            {searchTerm && (
              <div className="mb-4 text-sm text-gray-600">
                Found {filteredAids.length} job aid{filteredAids.length !== 1 ? 's' : ''} matching "{searchTerm}"
                {selectedCategory && ` in ${selectedCategory} category`}
              </div>
            )}
            
            {filteredAids.length === 0 ? (
              <div className="card p-12 text-center">
                <div className="text-gray-500 mb-4">
                  {searchTerm 
                    ? `No job aids found matching "${searchTerm}"${selectedCategory ? ` in ${selectedCategory} category` : ''}.`
                    : selectedCategory 
                      ? `No job aids found in ${selectedCategory} category.`
                      : 'No job aids found.'}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredAids.map((aid) => (
                  <div key={aid.id} className="card card-hover p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-3 flex-1">
                        {aid.icon && <span className="text-2xl">{aid.icon}</span>}
                        <h3 className="text-lg font-semibold text-gray-900">{aid.name}</h3>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={(e) => handleStarToggle(aid.id, e)}
                          className={`text-xl transition-colors ${
                            starredAids.has(aid.id) ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500'
                          }`}
                          title={starredAids.has(aid.id) ? 'Remove from toolbox' : 'Add to toolbox'}
                        >
                          {starredAids.has(aid.id) ? '⭐' : '☆'}
                        </button>
                        {canManageTools && (
                          <>
                            <button
                              onClick={() => handleEdit(aid)}
                              className="text-[#0B1020] hover:text-indigo-800 text-sm"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(aid.id)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
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
                        <span className="inline-block px-2 py-1 text-xs font-medium bg-[#0B1020]/10 text-[#0B1020] rounded">
                          {aid.category}
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <a
                        href={aid.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm inline-block w-full text-center px-4 py-2 bg-[#F97316] hover:bg-[#1a2235] text-white rounded-lg transition-all font-medium shadow-md hover:shadow-lg"
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
            )}
          </>
        )
      })()}

      {showAddForm && canManageTools && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-semibold text-gray-900">
                  {editingAid ? 'Edit Job Aid' : 'Create New Job Aid'}
                </h2>
                <button
                  onClick={() => {
                    setShowAddForm(false)
                    setEditingAid(null)
                    setFormData({ name: '', description: '', url: '', video_url: '', developer: '', category: '', icon: '' })
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
                    Video Link (Optional)
                  </label>
                  <input
                    type="url"
                    value={formData.video_url}
                    onChange={(e) => setFormData({ ...formData, video_url: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="https://youtube.com/watch?v=... or video URL"
                  />
                  <p className="text-xs text-gray-500 mt-1">Link to video tutorial or demonstration</p>
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
                    placeholder="Brief description of what this job aid does..."
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
                      Job Aid Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="e.g., Getting Started Guide"
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
                    Icon (Emoji)
                  </label>
                  <input
                    type="text"
                    value={formData.icon}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="e.g., 🔧, 📊, 📝"
                    maxLength={2}
                  />
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(false)
                      setEditingAid(null)
                      setFormData({ name: '', description: '', url: '', video_url: '', developer: '', category: '', icon: '' })
                      setError('')
                    }}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    {editingAid ? 'Update Job Aid' : 'Create Job Aid'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {aids.length === 0 && (
        <div className="card p-12 text-center">
          <div className="text-gray-500 mb-4">No job aids available yet.</div>
          {canManageTools && (
            <button
              onClick={() => setShowAddForm(true)}
              className="btn-primary"
            >
              Create First Job Aid
            </button>
          )}
        </div>
      )}
    </div>
  )
}

