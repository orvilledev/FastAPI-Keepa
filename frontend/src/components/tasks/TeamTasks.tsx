import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { tasksApi, authApi } from '../../services/api'
import type { Task, User, TaskValidation, TaskAttachment, Subtask } from '../../types'

export default function TeamTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterView, setFilterView] = useState<'all' | 'my-tasks'>('all')
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [currentUserInfo, setCurrentUserInfo] = useState<any>(null)
  const [error, setError] = useState('')
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [validations, setValidations] = useState<Record<string, TaskValidation[]>>({})
  const [attachments, setAttachments] = useState<Record<string, TaskAttachment[]>>({})
  const [showUploadModal, setShowUploadModal] = useState<string | null>(null)
  const [showAttachmentModal, setShowAttachmentModal] = useState<string | null>(null)
  const [selectedAttachmentFile, setSelectedAttachmentFile] = useState<File | null>(null)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [expandedModal, setExpandedModal] = useState(false)
  const [modalAttachments, setModalAttachments] = useState<TaskAttachment[]>([])
  const [uploadType, setUploadType] = useState<'file' | 'text'>('file')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [textContent, setTextContent] = useState('')
  const [uploading, setUploading] = useState(false)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    status: 'pending' as 'pending' | 'in_progress' | 'completed',
    priority: 'medium' as 'low' | 'medium' | 'high',
    due_date: '',
    assigned_to: '',
    assignment_purpose: '',
    assignment_purpose_custom: '',
  })
  const [purposeType, setPurposeType] = useState<string>('')
  const [success, setSuccess] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [subtasks, setSubtasks] = useState<Record<string, Subtask[]>>({})
  const [showSubtaskForm, setShowSubtaskForm] = useState<string | null>(null)
  const [editingSubtask, setEditingSubtask] = useState<{ taskId: string; subtask: Subtask } | null>(null)
  const [subtaskFormData, setSubtaskFormData] = useState({ title: '', description: '' })
  const [updatingSubtasks, setUpdatingSubtasks] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadCurrentUser()
    loadUsers()
  }, [])

  useEffect(() => {
    if (currentUserId) {
      loadTasks()
    }
  }, [filterStatus, currentUserId])

  const loadCurrentUser = async () => {
    try {
      const userInfo = await authApi.getCurrentUser()
      setCurrentUserId(userInfo.id)
      setCurrentUserInfo(userInfo)
    } catch (err) {
      console.error('Failed to load current user:', err)
    }
  }

  const loadUsers = async () => {
    try {
      const usersData = await authApi.getAllUsers()
      setAllUsers(usersData.users || [])
    } catch (err: any) {
      console.warn('Failed to load users:', err?.response?.data?.detail || err?.message)
    }
  }

  const loadTasks = async () => {
    try {
      setLoading(true)
      setError('')
      const status = filterStatus === 'all' ? undefined : filterStatus
      const data = await tasksApi.getTasks(status)
      
      // Show ALL tasks (not just team tasks)
      setTasks(data)
      
      // Load validations and attachments for each task
      for (const task of data) {
        loadValidations(task.id)
        loadAttachments(task.id)
      }
    } catch (err: any) {
      console.error('Failed to load tasks:', err)
      const errorMessage = err.response?.data?.detail || err.message || 'Failed to load tasks. Please refresh the page.'
      setError(errorMessage)
      if (err.response?.status === 404) {
        setTasks([])
      }
    } finally {
      setLoading(false)
    }
  }

  const loadValidations = async (taskId: string) => {
    try {
      const data = await tasksApi.getTaskValidations(taskId)
      setValidations(prev => ({ ...prev, [taskId]: data }))
    } catch (err) {
      console.error(`Failed to load validations for task ${taskId}:`, err)
    }
  }

  const loadAttachments = async (taskId: string) => {
    try {
      const data = await tasksApi.getTaskAttachments(taskId)
      setAttachments(prev => ({ ...prev, [taskId]: data }))
    } catch (err) {
      console.error(`Failed to load attachments for task ${taskId}:`, err)
    }
  }

  const toggleTaskExpansion = async (taskId: string) => {
    const newExpanded = new Set(expandedTasks)
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId)
    } else {
      newExpanded.add(taskId)
      // Load validations and attachments when expanding
      if (!validations[taskId]) {
        loadValidations(taskId)
      }
      if (!attachments[taskId]) {
        loadAttachments(taskId)
      }
      // Load subtasks if not already loaded
      if (!subtasks[taskId]) {
        try {
          const data = await tasksApi.getSubtasks(taskId)
          setSubtasks({ ...subtasks, [taskId]: data })
        } catch (err: any) {
          console.error('Failed to load subtasks:', err)
        }
      }
    }
    setExpandedTasks(newExpanded)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0])
    }
  }

  const handleUpload = async (taskId: string) => {
    if (uploadType === 'file' && !selectedFile) {
      alert('Please select a file')
      return
    }
    if (uploadType === 'text' && !textContent.trim()) {
      alert('Please enter text content')
      return
    }

    try {
      setUploading(true)
      if (uploadType === 'file' && selectedFile) {
        await tasksApi.uploadFileValidation(taskId, selectedFile)
      } else if (uploadType === 'text') {
        await tasksApi.submitTextValidation(taskId, textContent)
      }
      
      // Reload validations
      await loadValidations(taskId)
      
      // Reset form
      setShowUploadModal(null)
      setSelectedFile(null)
      setTextContent('')
      setUploadType('file')
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to upload validation')
    } finally {
      setUploading(false)
    }
  }

  const handleReview = async (validationId: string, status: 'approved' | 'rejected') => {
    const notes = reviewNotes[validationId] || ''
    try {
      await tasksApi.reviewValidation(validationId, status, notes)
      // Find which task this validation belongs to and reload
      for (const [taskId, taskValidations] of Object.entries(validations)) {
        if (taskValidations.some(v => v.id === validationId)) {
          await loadValidations(taskId)
          break
        }
      }
      setReviewNotes(prev => {
        const newNotes = { ...prev }
        delete newNotes[validationId]
        return newNotes
      })
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to review validation')
    }
  }

  const handleDeleteValidation = async (validationId: string, taskId: string) => {
    if (!confirm('Are you sure you want to delete this validation?')) {
      return
    }
    try {
      await tasksApi.deleteValidation(validationId)
      await loadValidations(taskId)
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete validation')
    }
  }

  const canReview = (task: Task) => {
    return task.user_id === currentUserId || currentUserInfo?.can_assign_tasks
  }

  const isAssignedToMe = (task: Task) => {
    return task.assigned_to === currentUserId
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'in_progress':
        return 'bg-blue-100 text-blue-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getValidationStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-800'
      case 'rejected':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-yellow-100 text-yellow-800'
    }
  }

  const getUserName = (userId: string) => {
    const user = allUsers.find(u => u.id === userId)
    return user?.display_name || user?.email || 'Unknown User'
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!formData.title.trim()) {
      setError('Title is required')
      return
    }

    // Assignment and purpose are optional - can assign to self or leave unassigned
    // Determine the final purpose value (only if assigned)
    const finalPurpose = formData.assigned_to && purposeType
      ? (purposeType === 'Others' 
          ? formData.assignment_purpose_custom.trim()
          : purposeType)
      : undefined

    try {
      const taskData = {
        title: formData.title,
        description: formData.description || undefined,
        status: formData.status,
        priority: formData.priority,
        due_date: formData.due_date || undefined,
        assigned_to: formData.assigned_to || undefined,
        assignment_purpose: finalPurpose,
      }

      let newTask
      if (editingTask) {
        newTask = await tasksApi.updateTask(editingTask.id, taskData)
        setSuccess('Task updated successfully!')
      } else {
        newTask = await tasksApi.createTask(taskData)
        setSuccess('Task created successfully!')
      }
      
      // Upload selected files as attachments if any
      if (selectedFiles.length > 0) {
        try {
          setUploadingFiles(true)
          for (const file of selectedFiles) {
            await tasksApi.uploadTaskAttachment(newTask.id, file)
          }
          setSuccess('Team task created and files uploaded successfully!')
        } catch (fileErr: any) {
          console.error('Failed to upload some files:', fileErr)
          setSuccess('Team task created, but some files failed to upload. You can upload them manually.')
        } finally {
          setUploadingFiles(false)
        }
      }
      
      setFormData({ title: '', description: '', status: 'pending', priority: 'medium', due_date: '', assigned_to: '', assignment_purpose: '', assignment_purpose_custom: '' })
      setPurposeType('')
      setSelectedFiles([])
      setShowAddForm(false)
      setEditingTask(null)
      setError('')
      // Reload tasks after a short delay
      setTimeout(() => {
        loadTasks()
      }, 300)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create task')
    }
  }

  const filteredTasks = tasks.filter(task => {
    // Filter by view type (all tasks vs my tasks)
    if (filterView === 'my-tasks') {
      // Only show tasks assigned to the current user
      if (task.assigned_to !== currentUserId) {
        return false
      }
    }
    
    // Filter by status
    if (filterStatus === 'all') return true
    return task.status === filterStatus
  })

  const pendingCount = tasks.filter(t => t.status === 'pending').length
  const inProgressCount = tasks.filter(t => t.status === 'in_progress').length
  const completedCount = tasks.filter(t => t.status === 'completed').length

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Tasks</h1>
        <button
          onClick={() => {
            setShowAddForm(true)
            setEditingTask(null)
            setFormData({ title: '', description: '', status: 'pending', priority: 'medium', due_date: '', assigned_to: '', assignment_purpose: '', assignment_purpose_custom: '' })
            setPurposeType('')
            setSelectedFiles([])
          }}
          className="btn-primary"
        >
          + New Task
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg">
          {success}
        </div>
      )}

      {/* Create Task Form */}
      {showAddForm && (
        <div className="card p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              {editingTask ? 'Edit Task' : 'Create New Task'}
            </h2>
            <button
              onClick={() => {
                setShowAddForm(false)
                setEditingTask(null)
                setFormData({ title: '', description: '', status: 'pending', priority: 'medium', due_date: '', assigned_to: '', assignment_purpose: '', assignment_purpose_custom: '' })
                setPurposeType('')
                setSelectedFiles([])
                setError('')
                setSuccess('')
              }}
              className="text-gray-400 hover:text-gray-600 text-2xl"
            >
              ×
            </button>
          </div>
          <form onSubmit={handleCreateTask} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title *
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Enter task title"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                rows={3}
                placeholder="Enter task description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority
                </label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Due Date
                </label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assign To (Optional)
                </label>
                <select
                  value={formData.assigned_to}
                  onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="">Assign to me (or leave unassigned)</option>
                  {allUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.display_name || user.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {formData.assigned_to && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Purpose of Assignment (Optional)
                </label>
                <select
                  value={purposeType}
                  onChange={(e) => {
                    setPurposeType(e.target.value)
                    if (e.target.value !== 'Others') {
                      setFormData({ ...formData, assignment_purpose_custom: '' })
                    }
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent mb-2"
                >
                  <option value="">Select purpose...</option>
                  <option value="Box Contents Validation">Box Contents Validation</option>
                  <option value="Amazon Cases">Amazon Cases</option>
                  <option value="Amazon Audit">Amazon Audit</option>
                  <option value="Master Sheet">Master Sheet</option>
                  <option value="Inventory Adjustment">Inventory Adjustment</option>
                  <option value="Others">Others</option>
                </select>
                {purposeType === 'Others' && (
                  <textarea
                    value={formData.assignment_purpose_custom}
                    onChange={(e) => setFormData({ ...formData, assignment_purpose_custom: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent mt-2"
                    rows={3}
                    placeholder="Specify the purpose..."
                  />
                )}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Attachments (Optional)
              </label>
              <input
                type="file"
                multiple
                accept="image/*,.pdf,.xls,.xlsx,.csv,.ppt,.pptx,.doc,.docx"
                onChange={(e) => {
                  if (e.target.files) {
                    const files = Array.from(e.target.files)
                    // Validate file types and sizes
                    const validFiles: File[] = []
                    const invalidFiles: string[] = []
                    
                    files.forEach(file => {
                      const allowedTypes = [
                        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
                        'application/pdf',
                        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'text/csv', 'application/csv',
                        'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                      ]
                      
                      if (!allowedTypes.includes(file.type)) {
                        invalidFiles.push(`${file.name} (unsupported type)`)
                      } else if (file.size > 50 * 1024 * 1024) {
                        invalidFiles.push(`${file.name} (exceeds 50MB)`)
                      } else {
                        validFiles.push(file)
                      }
                    })
                    
                    if (invalidFiles.length > 0) {
                      alert(`Some files were not added:\n${invalidFiles.join('\n')}\n\nAllowed: Images, PDF, Excel, CSV, PowerPoint, Word (max 50MB each)`)
                    }
                    
                    setSelectedFiles(prev => [...prev, ...validFiles])
                  }
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              {selectedFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {selectedFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm">
                      <span className="text-gray-700">
                        📎 {file.name} ({formatFileSize(file.size)})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFiles(prev => prev.filter((_, i) => i !== index))
                        }}
                        className="text-red-600 hover:text-red-800 ml-2"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Supported: Images (JPEG, PNG, GIF, WebP), PDF, Excel, CSV, PowerPoint, Word. Max 50MB per file.
              </p>
            </div>
            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false)
                  setEditingTask(null)
                  setFormData({ title: '', description: '', status: 'pending', priority: 'medium', due_date: '', assigned_to: '', assignment_purpose: '', assignment_purpose_custom: '' })
                  setPurposeType('')
                  setSelectedFiles([])
                  setError('')
                  setSuccess('')
                }}
                className="btn-secondary"
                disabled={uploadingFiles}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={uploadingFiles}
              >
                {uploadingFiles ? 'Creating & Uploading...' : editingTask ? 'Update Task' : 'Create Task'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* View Filter Tabs (All Tasks vs My Tasks) */}
      <div className="flex space-x-2 border-b border-gray-200 mb-4">
        <button
          onClick={() => {
            setFilterView('all')
            setFilterStatus('all') // Reset status filter when switching views
          }}
          className={`px-4 py-2 font-medium text-sm ${
            filterView === 'all'
              ? 'border-b-2 border-[#0B1020] text-[#0B1020]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          All Tasks ({tasks.length})
        </button>
        <button
          onClick={() => {
            setFilterView('my-tasks')
            setFilterStatus('all') // Reset status filter when switching views
          }}
          className={`px-4 py-2 font-medium text-sm flex items-center space-x-2 ${
            filterView === 'my-tasks'
              ? 'border-b-2 border-[#0B1020] text-[#0B1020]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span>My Tasks ({tasks.filter(t => t.assigned_to === currentUserId).length})</span>
          {tasks.filter(t => t.assigned_to === currentUserId && t.is_urgent).length > 0 && (
            <span className="text-red-600 text-lg animate-pulse" title="You have urgent tasks">
              🔔
            </span>
          )}
        </button>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex space-x-2 border-b border-gray-200">
        <button
          onClick={() => setFilterStatus('all')}
          className={`px-4 py-2 font-medium text-sm ${
            filterStatus === 'all'
              ? 'border-b-2 border-[#0B1020] text-[#0B1020]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          All ({filteredTasks.length})
        </button>
        <button
          onClick={() => setFilterStatus('pending')}
          className={`px-4 py-2 font-medium text-sm ${
            filterStatus === 'pending'
              ? 'border-b-2 border-[#0B1020] text-[#0B1020]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Pending ({filteredTasks.filter(t => t.status === 'pending').length})
        </button>
        <button
          onClick={() => setFilterStatus('in_progress')}
          className={`px-4 py-2 font-medium text-sm ${
            filterStatus === 'in_progress'
              ? 'border-b-2 border-[#0B1020] text-[#0B1020]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          In Progress ({filteredTasks.filter(t => t.status === 'in_progress').length})
        </button>
        <button
          onClick={() => setFilterStatus('completed')}
          className={`px-4 py-2 font-medium text-sm ${
            filterStatus === 'completed'
              ? 'border-b-2 border-[#0B1020] text-[#0B1020]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Completed ({filteredTasks.filter(t => t.status === 'completed').length})
        </button>
      </div>

      {/* Tasks List */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading tasks...</div>
      ) : filteredTasks.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-gray-500 mb-4">
            {filterView === 'my-tasks' 
              ? (filterStatus === 'all' 
                  ? 'No tasks assigned to you yet.'
                  : `No ${filterStatus.replace('_', ' ')} tasks assigned to you.`)
              : (filterStatus === 'all' 
                  ? 'No tasks yet. Create your first task to get started!'
                  : `No ${filterStatus.replace('_', ' ')} tasks.`)}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTasks.map((task) => {
            const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed'
            const isExpanded = expandedTasks.has(task.id)
            const taskValidations = validations[task.id] || []
            const pendingValidations = taskValidations.filter(v => v.status === 'pending')
            
            return (
              <div
                key={task.id}
                className={`card p-4 hover:shadow-md transition-shadow ${
                  task.status === 'completed' ? 'opacity-75' : ''
                } ${isOverdue ? 'border-l-4 border-red-500' : ''} ${
                  filterView === 'my-tasks' && task.is_urgent && task.assigned_to === currentUserId
                    ? 'border-l-4 border-red-600 bg-red-50' 
                    : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <button
                        onClick={() => toggleTaskExpansion(task.id)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        {isExpanded ? '▼' : '▶'}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedTask(task)
                          setShowTaskModal(true)
                        }}
                        className={`text-lg font-semibold hover:text-[#0B1020] transition-colors text-left cursor-pointer ${
                          task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'
                        }`}
                      >
                        {task.title}
                      </button>
                      {/* Red bell icon for urgency in My Tasks view - shown for all tasks */}
                      {filterView === 'my-tasks' && (
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            try {
                              const currentUrgent = task.is_urgent || false
                              await tasksApi.updateTask(task.id, { is_urgent: !currentUrgent })
                              loadTasks()
                            } catch (err: any) {
                              console.error('Error updating urgency:', err)
                              setError(err.response?.data?.detail || 'Failed to update urgency. Make sure the database migration has been run.')
                            }
                          }}
                          className={`text-2xl transition-all hover:scale-110 inline-block flex-shrink-0 ${
                            task.is_urgent 
                              ? 'text-red-600 animate-pulse' 
                              : 'text-gray-500 hover:text-red-500'
                          }`}
                          title={task.is_urgent ? 'Mark as not urgent' : 'Mark as urgent'}
                          style={{ lineHeight: '1', minWidth: '24px', minHeight: '24px' }}
                        >
                          🔔
                        </button>
                      )}
                      {pendingValidations.length > 0 && (
                        <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-full">
                          {pendingValidations.length} pending validation{pendingValidations.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {task.description && (
                      <p className="text-sm text-gray-600 mb-3 ml-8">{task.description}</p>
                    )}
                    {task.assignment_purpose && (
                      <div className="ml-8 mb-3 p-3 bg-blue-50 border-l-4 border-blue-400 rounded">
                        <p className="text-xs font-semibold text-blue-800 mb-1">Purpose of Assignment:</p>
                        <p className="text-sm text-blue-900">{task.assignment_purpose}</p>
                      </div>
                    )}
                    <div className="flex items-center justify-between ml-8">
                      <div className="flex items-center space-x-3 flex-wrap gap-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(task.status)}`}>
                          {task.status.replace('_', ' ')}
                        </span>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPriorityColor(task.priority)}`}>
                          {task.priority}
                        </span>
                        {task.due_date && (
                          <span className={`text-xs ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                            Due: {new Date(task.due_date).toLocaleDateString()}
                          </span>
                        )}
                        {task.assigned_to && (
                          <span className="text-xs text-[#0B1020] font-medium">
                            👤 Assigned to: {getUserName(task.assigned_to)}
                          </span>
                        )}
                        {task.user_id && (
                          <span className="text-xs text-gray-500">
                            Created by: {getUserName(task.user_id)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 ml-8 mt-2">
                      <button
                        onClick={async () => {
                          setSelectedTask(task)
                          setShowTaskModal(true)
                          // Load attachments for this task
                          try {
                            const attachments = await tasksApi.getTaskAttachments(task.id)
                            setModalAttachments(attachments)
                          } catch (err) {
                            console.error('Failed to load attachments:', err)
                            setModalAttachments([])
                          }
                        }}
                        className="px-3 py-1.5 text-sm bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors"
                        title="View Task"
                      >
                        View Task
                      </button>
                      <select
                        value={task.status}
                        onChange={(e) => handleStatusChange(task.id, e.target.value as any)}
                        className="px-3 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                      </select>
                      <button
                        onClick={() => handleEdit(task)}
                        className="p-2 text-[#0B1020] hover:bg-gray-100 rounded-lg"
                        title="Edit"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>

                    {/* Subtasks Section */}
                    <div className="mt-4 pt-4 border-t border-gray-200 ml-8">
                      <div className="flex items-center justify-between mb-2">
                        <button
                          onClick={() => toggleTaskExpansion(task.id)}
                          className="flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900"
                        >
                          <span>{expandedTasks.has(task.id) ? '▼' : '▶'}</span>
                          <span>Subtasks ({subtasks[task.id]?.length || 0})</span>
                        </button>
                        {expandedTasks.has(task.id) && (
                          <button
                            onClick={() => {
                              setShowSubtaskForm(task.id)
                              setEditingSubtask(null)
                              setSubtaskFormData({ title: '', description: '' })
                            }}
                            className="text-xs px-2 py-1 text-[#0B1020] hover:bg-gray-100 rounded"
                          >
                            + Add Subtask
                          </button>
                        )}
                      </div>

                      {expandedTasks.has(task.id) && (
                        <div className="ml-6 space-y-2">
                          {/* Subtask Form */}
                          {showSubtaskForm === task.id && (
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                              <form onSubmit={(e) => handleSubtaskSubmit(e, task.id)} className="space-y-2">
                                <input
                                  type="text"
                                  required
                                  value={subtaskFormData.title}
                                  onChange={(e) => setSubtaskFormData({ ...subtaskFormData, title: e.target.value })}
                                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                  placeholder="Subtask title"
                                />
                                <textarea
                                  value={subtaskFormData.description}
                                  onChange={(e) => setSubtaskFormData({ ...subtaskFormData, description: e.target.value })}
                                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                  rows={2}
                                  placeholder="Description (optional)"
                                />
                                <div className="flex justify-end space-x-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowSubtaskForm(null)
                                      setEditingSubtask(null)
                                      setSubtaskFormData({ title: '', description: '' })
                                    }}
                                    className="px-3 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="submit"
                                    className="px-3 py-1 text-xs bg-[#0B1020] text-white rounded hover:bg-[#1a2235]"
                                  >
                                    {editingSubtask ? 'Update' : 'Add'}
                                  </button>
                                </div>
                              </form>
                            </div>
                          )}

                          {/* Subtasks List */}
                          {subtasks[task.id] && subtasks[task.id].length > 0 ? (
                            <div className="space-y-2">
                              {subtasks[task.id].map((subtask) => {
                                const updateKey = `${task.id}-${subtask.id}`
                                const isUpdating = updatingSubtasks.has(updateKey)
                                
                                return (
                                  <div
                                    key={subtask.id}
                                    className="flex items-center space-x-2 p-2 bg-gray-50 rounded-lg hover:bg-gray-100"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={subtask.status === 'completed'}
                                      disabled={isUpdating}
                                      onChange={(e) => {
                                        e.stopPropagation()
                                        if (!isUpdating) {
                                          const newStatus = e.target.checked ? 'completed' : 'pending'
                                          handleSubtaskStatusChange(task.id, subtask.id, newStatus)
                                        }
                                      }}
                                      className="w-4 h-4 text-[#0B1020] rounded focus:ring-indigo-500 cursor-pointer flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    <span
                                      className={`flex-1 text-sm ${
                                        subtask.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'
                                      }`}
                                    >
                                      {subtask.title}
                                    </span>
                                    <button
                                      onClick={() => handleSubtaskEdit(task.id, subtask)}
                                      className="p-1 text-[#0B1020] hover:bg-gray-100 rounded text-xs"
                                      title="Edit"
                                    >
                                      ✏️
                                    </button>
                                    <button
                                      onClick={() => handleSubtaskDelete(task.id, subtask.id)}
                                      className="p-1 text-red-600 hover:bg-red-50 rounded text-xs"
                                      title="Delete"
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            showSubtaskForm !== task.id && (
                              <div className="text-xs text-gray-500 py-2">No subtasks yet. Click "Add Subtask" to create one.</div>
                            )
                          )}
                        </div>
                      )}
                    </div>

                    {/* Attachments Section */}
                    {isExpanded && (
                      <div className="mt-4 ml-8 space-y-4">
                        <div className="flex justify-between items-center">
                          <h4 className="font-semibold text-gray-900">Attachments</h4>
                          <button
                            onClick={() => {
                              setShowAttachmentModal(task.id)
                              setSelectedAttachmentFile(null)
                            }}
                            className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
                          >
                            + Upload Attachment
                          </button>
                        </div>

                        {(!attachments[task.id] || attachments[task.id].length === 0) ? (
                          <div className="text-sm text-gray-500 py-4">
                            No attachments uploaded yet.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {attachments[task.id].map((attachment) => (
                              <div
                                key={attachment.id}
                                className="p-3 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between"
                              >
                                <div className="flex items-center space-x-3 flex-1">
                                  <span className="text-2xl">{getFileIcon(attachment.file_category)}</span>
                                  <div className="flex-1 min-w-0">
                                    <a
                                      href={attachment.file_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sm font-medium text-[#0B1020] hover:text-indigo-800 truncate block"
                                    >
                                      {attachment.file_name}
                                    </a>
                                    <p className="text-xs text-gray-500">
                                      {(attachment.file_size / 1024).toFixed(2)} KB • {attachment.file_category}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleDeleteAttachment(attachment.id, task.id)}
                                  className="ml-3 px-2 py-1 text-red-600 hover:text-red-800 text-sm"
                                  title="Delete attachment"
                                >
                                  🗑️
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Validations Section */}
                    {isExpanded && (
                      <div className="mt-4 ml-8 space-y-4">
                        <div className="flex justify-between items-center">
                          <h4 className="font-semibold text-gray-900">Validations & Approvals</h4>
                          {isAssignedToMe(task) && (
                            <button
                              onClick={() => {
                                setShowUploadModal(task.id)
                                setUploadType('file')
                              }}
                              className="px-3 py-1.5 bg-[#0B1020] text-white text-sm rounded-lg hover:bg-[#1a2235]"
                            >
                              + Upload File/Text
                            </button>
                          )}
                        </div>

                        {taskValidations.length === 0 ? (
                          <div className="text-sm text-gray-500 py-4">
                            No validations submitted yet.
                            {isAssignedToMe(task) && ' Click "Upload File/Text" to submit for approval.'}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {taskValidations.map((validation) => (
                              <div
                                key={validation.id}
                                className="p-3 bg-gray-50 rounded-lg border border-gray-200"
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <div className="flex-1">
                                    <div className="flex items-center space-x-2 mb-1">
                                      <span className={`px-2 py-1 rounded text-xs font-medium ${getValidationStatusColor(validation.status)}`}>
                                        {validation.status}
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        {validation.validation_type === 'file' ? '📎 File' : '📝 Text'}
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        Submitted by: {getUserName(validation.submitted_by)}
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        {new Date(validation.created_at).toLocaleDateString()}
                                      </span>
                                    </div>
                                    
                                    {validation.validation_type === 'file' ? (
                                      <div className="text-sm">
                                        <a
                                          href={validation.file_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-[#0B1020] hover:underline"
                                        >
                                          📄 {validation.file_name}
                                        </a>
                                        {validation.file_size && (
                                          <span className="text-gray-500 ml-2">
                                            ({formatFileSize(validation.file_size)})
                                          </span>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="text-sm text-gray-700 bg-white p-2 rounded border border-gray-200 mt-1">
                                        {validation.text_content}
                                      </div>
                                    )}

                                    {validation.review_notes && (
                                      <div className="mt-2 text-sm text-gray-600 italic">
                                        Review note: {validation.review_notes}
                                      </div>
                                    )}

                                    {validation.reviewed_by && (
                                      <div className="text-xs text-gray-500 mt-1">
                                        Reviewed by: {getUserName(validation.reviewed_by)} on{' '}
                                        {validation.reviewed_at && new Date(validation.reviewed_at).toLocaleDateString()}
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex items-center space-x-2">
                                    {validation.status === 'pending' && canReview(task) && (
                                      <div className="flex flex-col space-y-2">
                                        <input
                                          type="text"
                                          placeholder="Review notes (optional)"
                                          value={reviewNotes[validation.id] || ''}
                                          onChange={(e) => setReviewNotes(prev => ({ ...prev, [validation.id]: e.target.value }))}
                                          className="px-2 py-1 text-xs border border-gray-300 rounded"
                                        />
                                        <div className="flex space-x-1">
                                          <button
                                            onClick={() => handleReview(validation.id, 'approved')}
                                            className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                                          >
                                            ✓ Approve
                                          </button>
                                          <button
                                            onClick={() => handleReview(validation.id, 'rejected')}
                                            className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                                          >
                                            ✗ Reject
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {validation.status === 'pending' && validation.submitted_by === currentUserId && (
                                      <button
                                        onClick={() => handleDeleteValidation(validation.id, task.id)}
                                        className="px-2 py-1 text-red-600 text-xs hover:bg-red-50 rounded"
                                      >
                                        Delete
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Submit for Validation</h3>
              <button
                onClick={() => {
                  setShowUploadModal(null)
                  setSelectedFile(null)
                  setTextContent('')
                  setUploadType('file')
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Type
                </label>
                <div className="flex space-x-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="file"
                      checked={uploadType === 'file'}
                      onChange={(e) => setUploadType(e.target.value as 'file')}
                      className="mr-2"
                    />
                    File Upload
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      value="text"
                      checked={uploadType === 'text'}
                      onChange={(e) => setUploadType(e.target.value as 'text')}
                      className="mr-2"
                    />
                    Text Submission
                  </label>
                </div>
              </div>

              {uploadType === 'file' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select File
                  </label>
                  <input
                    type="file"
                    onChange={handleFileSelect}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                  {selectedFile && (
                    <p className="mt-2 text-sm text-gray-600">
                      Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Text Content
                  </label>
                  <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    rows={6}
                    placeholder="Enter text content for validation..."
                  />
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => {
                    setShowUploadModal(null)
                    setSelectedFile(null)
                    setTextContent('')
                    setUploadType('file')
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleUpload(showUploadModal)}
                  className="px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235]"
                  disabled={uploading}
                >
                  {uploading ? 'Uploading...' : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attachment Upload Modal */}
      {showAttachmentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Upload Attachment</h3>
              <button
                onClick={() => {
                  setShowAttachmentModal(null)
                  setSelectedAttachmentFile(null)
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select File (Images, PDF, Excel, CSV, PowerPoint, Word)
                </label>
                <input
                  type="file"
                  accept="image/*,.pdf,.xls,.xlsx,.csv,.ppt,.pptx,.doc,.docx"
                  onChange={handleAttachmentFileSelect}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
                {selectedAttachmentFile && (
                  <p className="mt-2 text-sm text-gray-600">
                    Selected: {selectedAttachmentFile.name} ({formatFileSize(selectedAttachmentFile.size)})
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-500">
                  Maximum file size: 50MB. Supported formats: Images (JPEG, PNG, GIF, WebP), PDF, Excel, CSV, PowerPoint, Word documents.
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowAttachmentModal(null)
                    setSelectedAttachmentFile(null)
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleUploadAttachment(showAttachmentModal)}
                  disabled={!selectedAttachmentFile || uploadingAttachment}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploadingAttachment ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Modal */}
      {showTaskModal && selectedTask && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900">{selectedTask.title}</h2>
              <button
                onClick={() => {
                  setShowTaskModal(false)
                  setSelectedTask(null)
                }}
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                ×
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Status and Priority */}
              <div className="flex items-center space-x-3 flex-wrap gap-2">
                <span className={`px-3 py-1 rounded-lg text-sm font-semibold ${getStatusColor(selectedTask.status)}`}>
                  {selectedTask.status.replace('_', ' ')}
                </span>
                <span className={`px-3 py-1 rounded-lg text-sm font-semibold ${getPriorityColor(selectedTask.priority)}`}>
                  {selectedTask.priority} Priority
                </span>
                {selectedTask.due_date && (
                  <span className={`text-sm ${
                    new Date(selectedTask.due_date) < new Date() && selectedTask.status !== 'completed'
                      ? 'text-red-600 font-semibold'
                      : 'text-gray-600'
                  }`}>
                    Due: {new Date(selectedTask.due_date).toLocaleDateString()}
                  </span>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="text-sm font-medium text-gray-500">Description</label>
                <p className="mt-1 text-gray-900">{selectedTask.description || 'No description provided'}</p>
              </div>

              {/* Purpose of Assignment */}
              {selectedTask.assignment_purpose && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Purpose of Assignment</label>
                  <div className="mt-2 p-4 bg-blue-50 border-l-4 border-blue-400 rounded-lg">
                    <p className="text-gray-900 font-medium">{selectedTask.assignment_purpose}</p>
                  </div>
                </div>
              )}

              {/* Assignment Info */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200">
                <div>
                  <label className="text-sm font-medium text-gray-500">Created By</label>
                  <p className="mt-1 text-gray-900">{getUserName(selectedTask.user_id)}</p>
                </div>
                {selectedTask.assigned_to && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Assigned To</label>
                    <p className="mt-1 text-gray-900">{getUserName(selectedTask.assigned_to)}</p>
                  </div>
                )}
              </div>

              {/* Created Date */}
              <div className="pt-4 border-t border-gray-200">
                <label className="text-sm font-medium text-gray-500">Created</label>
                <p className="mt-1 text-gray-900">
                  {new Date(selectedTask.created_at).toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>

              {/* Attachments Section */}
              <div className="pt-4 border-t border-gray-200">
                <label className="text-sm font-medium text-gray-500 mb-3 block">Attachments</label>
                {modalAttachments.length > 0 ? (
                  <div className="space-y-2">
                    {modalAttachments.map((attachment) => (
                      <a
                        key={attachment.id}
                        href={attachment.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                      >
                        <span className="text-2xl">{getFileIcon(attachment.file_category)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {attachment.file_name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatFileSize(attachment.file_size)} • {attachment.file_category}
                          </p>
                        </div>
                        <span className="text-[#0B1020] text-sm">Download</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No attachments uploaded yet.</p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowTaskModal(false)
                  setSelectedTask(null)
                  setExpandedModal(false)
                  setModalAttachments([])
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
