import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { tasksApi, authApi } from '../../services/api'
import type { Task, Subtask, User, TaskAttachment, TaskValidation } from '../../types'

export default function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const [task, setTask] = useState<Task | null>(null)
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [validations, setValidations] = useState<TaskValidation[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentUserId, setCurrentUserId] = useState<string>('')

  useEffect(() => {
    if (taskId) {
      loadTask()
      loadUsers()
    }
  }, [taskId])

  const loadUsers = async () => {
    try {
      const usersData = await authApi.getAllUsers()
      setAllUsers(usersData.users || [])
      
      // Get current user ID
      const currentUser = await authApi.getCurrentUser()
      setCurrentUserId(currentUser.id)
    } catch (err: any) {
      console.warn('Failed to load users:', err)
    }
  }

  const loadTask = async () => {
    if (!taskId) return
    try {
      setLoading(true)
      setError('')
      
      // Load task details - get all tasks and find the one we need
      // (The API doesn't have a single task endpoint, so we filter from all tasks)
      const tasks = await tasksApi.getTasks()
      const foundTask = tasks.find(t => t.id === taskId)
      
      if (!foundTask) {
        setError('Task not found')
        setLoading(false)
        return
      }
      
      // Check if user has access (created by them or assigned to them)
      const currentUser = await authApi.getCurrentUser()
      if (foundTask.user_id !== currentUser.id && foundTask.assigned_to !== currentUser.id) {
        setError('You do not have access to this task')
        setLoading(false)
        return
      }
      
      setTask(foundTask)
      
      // Load related data
      await Promise.all([
        loadSubtasks(),
        loadAttachments(),
        loadValidations()
      ])
    } catch (err: any) {
      console.error('Failed to load task:', err)
      setError(err.response?.data?.detail || 'Failed to load task')
    } finally {
      setLoading(false)
    }
  }

  const loadSubtasks = async () => {
    if (!taskId) return
    try {
      const data = await tasksApi.getSubtasks(taskId)
      setSubtasks(data)
    } catch (err) {
      console.error('Failed to load subtasks:', err)
    }
  }

  const loadAttachments = async () => {
    if (!taskId) return
    try {
      const data = await tasksApi.getTaskAttachments(taskId)
      setAttachments(data)
    } catch (err) {
      console.error('Failed to load attachments:', err)
    }
  }

  const loadValidations = async () => {
    if (!taskId) return
    try {
      const data = await tasksApi.getTaskValidations(taskId)
      setValidations(data)
    } catch (err) {
      console.error('Failed to load validations:', err)
    }
  }

  const getUserName = (userId: string) => {
    const user = allUsers.find(u => u.id === userId)
    return user?.display_name || user?.email || 'Unknown'
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200'
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 border-blue-200'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200'
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

  const getFileIcon = (fileCategory: string) => {
    switch (fileCategory) {
      case 'image':
        return '🖼️'
      case 'pdf':
        return '📄'
      case 'excel':
        return '📊'
      case 'csv':
        return '📈'
      case 'powerpoint':
        return '📽️'
      case 'word':
        return '📝'
      default:
        return '📎'
    }
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const isOverdue = task?.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed'

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0B1020] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading task details...</p>
        </div>
      </div>
    )
  }

  if (error || !task) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="card p-6">
          <div className="text-center">
            <p className="text-red-600 mb-4">{error || 'Task not found'}</p>
            <Link to="/tasks" className="btn-primary">
              ← Back to My Tasks
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link to="/tasks" className="text-[#0B1020] hover:text-indigo-800 mb-4 inline-flex items-center">
          ← Back to My Tasks
        </Link>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">{task.title}</h1>
            {task.description && (
              <p className="text-lg text-gray-600">{task.description}</p>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <span className={`px-4 py-2 rounded-lg text-sm font-semibold border ${getStatusColor(task.status)}`}>
              {task.status.replace('_', ' ').toUpperCase()}
            </span>
            <span className={`px-4 py-2 rounded-lg text-sm font-semibold border ${getPriorityColor(task.priority)}`}>
              {task.priority.toUpperCase()} PRIORITY
            </span>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Main Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Task Information Card */}
          <div className="card p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-6 pb-4 border-b border-gray-200">
              Task Information
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-500">Status</label>
                  <p className={`mt-1 px-3 py-2 rounded-lg text-sm font-medium inline-block ${getStatusColor(task.status)}`}>
                    {task.status.replace('_', ' ')}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Priority</label>
                  <p className={`mt-1 px-3 py-2 rounded-lg text-sm font-medium inline-block ${getPriorityColor(task.priority)}`}>
                    {task.priority}
                  </p>
                </div>
              </div>
              
              {task.due_date && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Due Date</label>
                  <p className={`mt-1 text-lg font-semibold ${isOverdue ? 'text-red-600' : 'text-gray-900'}`}>
                    {new Date(task.due_date).toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}
                    {isOverdue && <span className="ml-2 text-red-600">⚠️ Overdue</span>}
                  </p>
                </div>
              )}


              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200">
                <div>
                  <label className="text-sm font-medium text-gray-500">Created By</label>
                  <p className="mt-1 text-gray-900 font-medium">{getUserName(task.user_id)}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(task.created_at).toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
                {task.assigned_to && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Assigned To</label>
                    <p className="mt-1 text-gray-900 font-medium">{getUserName(task.assigned_to)}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Subtasks Card */}
          <div className="card p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-6 pb-4 border-b border-gray-200">
              Subtasks ({subtasks.length})
            </h2>
            {subtasks.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No subtasks for this task.
              </div>
            ) : (
              <div className="space-y-3">
                {subtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className={`p-4 rounded-lg border-2 ${
                      subtask.status === 'completed'
                        ? 'bg-green-50 border-green-200'
                        : 'bg-white border-gray-200'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        checked={subtask.status === 'completed'}
                        disabled
                        className="w-5 h-5 mt-1 text-[#0B1020] rounded focus:ring-indigo-500"
                      />
                      <div className="flex-1">
                        <h3 className={`font-semibold ${
                          subtask.status === 'completed'
                            ? 'line-through text-gray-500'
                            : 'text-gray-900'
                        }`}>
                          {subtask.title}
                        </h3>
                        {subtask.description && (
                          <p className="text-sm text-gray-600 mt-1">{subtask.description}</p>
                        )}
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        subtask.status === 'completed'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {subtask.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Validations Card */}
          {validations.length > 0 && (
            <div className="card p-6">
              <h2 className="text-2xl font-semibold text-gray-900 mb-6 pb-4 border-b border-gray-200">
                Validations & Approvals ({validations.length})
              </h2>
              <div className="space-y-4">
                {validations.map((validation) => (
                  <div
                    key={validation.id}
                    className="p-4 bg-gray-50 rounded-lg border border-gray-200"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <span className={`px-3 py-1 rounded-lg text-sm font-medium ${getValidationStatusColor(validation.status)}`}>
                          {validation.status.toUpperCase()}
                        </span>
                        <span className="text-sm text-gray-500">
                          {validation.validation_type === 'file' ? '📎 File' : '📝 Text'}
                        </span>
                        <span className="text-sm text-gray-500">
                          by {getUserName(validation.submitted_by)}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">
                        {new Date(validation.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    
                    {validation.validation_type === 'file' ? (
                      <div>
                        <a
                          href={validation.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#0B1020] hover:underline font-medium"
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
                      <div className="p-3 bg-white rounded border border-gray-200 mt-2">
                        <p className="text-gray-700">{validation.text_content}</p>
                      </div>
                    )}

                    {validation.review_notes && (
                      <div className="mt-3 p-3 bg-blue-50 rounded border-l-4 border-blue-400">
                        <p className="text-sm text-gray-700">
                          <strong>Review Note:</strong> {validation.review_notes}
                        </p>
                      </div>
                    )}

                    {validation.reviewed_by && (
                      <p className="text-xs text-gray-500 mt-2">
                        Reviewed by {getUserName(validation.reviewed_by)} on{' '}
                        {validation.reviewed_at && new Date(validation.reviewed_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Attachments Card */}
          <div className="card p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 pb-3 border-b border-gray-200">
              Attachments ({attachments.length})
            </h2>
            {attachments.length === 0 ? (
              <div className="text-center py-6 text-gray-500 text-sm">
                No attachments uploaded yet.
              </div>
            ) : (
              <div className="space-y-3">
                {attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={attachment.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="text-2xl">{getFileIcon(attachment.file_category)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {attachment.file_name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatFileSize(attachment.file_size)} • {attachment.file_category}
                        </p>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Quick Actions Card */}
          <div className="card p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 pb-3 border-b border-gray-200">
              Quick Actions
            </h2>
            <div className="space-y-3">
              <Link
                to="/tasks"
                className="block w-full px-4 py-2 text-center bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors"
              >
                Edit Task
              </Link>
              {task.assigned_to === currentUserId && (
                <Link
                  to="/team-tasks"
                  className="block w-full px-4 py-2 text-center bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Submit Validation
                </Link>
              )}
            </div>
          </div>

          {/* Metadata Card */}
          <div className="card p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 pb-3 border-b border-gray-200">
              Metadata
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-gray-500">Task ID</label>
                <p className="text-gray-900 font-mono text-xs break-all">{task.id}</p>
              </div>
              <div>
                <label className="text-gray-500">Created</label>
                <p className="text-gray-900">
                  {new Date(task.created_at).toLocaleString()}
                </p>
              </div>
              <div>
                <label className="text-gray-500">Last Updated</label>
                <p className="text-gray-900">
                  {new Date(task.updated_at).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

