import { useEffect, useState } from 'react'
import { tasksApi } from '../../services/api'
import type { Task, Subtask } from '../../types'

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    status: 'pending' as 'pending' | 'in_progress' | 'completed',
    priority: 'medium' as 'low' | 'medium' | 'high',
    due_date: '',
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [subtasks, setSubtasks] = useState<Record<string, Subtask[]>>({})
  const [showSubtaskForm, setShowSubtaskForm] = useState<string | null>(null)
  const [editingSubtask, setEditingSubtask] = useState<{ taskId: string; subtask: Subtask } | null>(null)
  const [subtaskFormData, setSubtaskFormData] = useState({ title: '', description: '' })
  const [updatingSubtasks, setUpdatingSubtasks] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadTasks()
  }, [filterStatus])

  const loadTasks = async () => {
    try {
      setLoading(true)
      setError('')
      const status = filterStatus === 'all' ? undefined : filterStatus
      const data = await tasksApi.getTasks(status)
      setTasks(data)
      setSuccess('') // Clear success message after loading
    } catch (err: any) {
      console.error('Failed to load tasks:', err)
      const errorMessage = err.response?.data?.detail || err.message || 'Failed to load tasks. Please refresh the page.'
      setError(errorMessage)
      // If it's a 404, the table might not exist yet - that's okay
      if (err.response?.status === 404) {
        setTasks([])
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!formData.title.trim()) {
      setError('Title is required')
      return
    }

    try {
      const taskData = {
        title: formData.title,
        description: formData.description || undefined,
        status: formData.status,
        priority: formData.priority,
        due_date: formData.due_date || undefined,
      }

      if (editingTask) {
        await tasksApi.updateTask(editingTask.id, taskData)
        setSuccess('Task updated successfully!')
      } else {
        await tasksApi.createTask(taskData)
        setSuccess('Task created successfully!')
      }
      setFormData({ title: '', description: '', status: 'pending', priority: 'medium', due_date: '' })
      setShowAddForm(false)
      setEditingTask(null)
      setError('')
      // Reload tasks after a short delay to ensure backend has processed the change
      setTimeout(() => {
        loadTasks()
      }, 300)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save task')
    }
  }

  const handleEdit = (task: Task) => {
    setEditingTask(task)
    setFormData({
      title: task.title,
      description: task.description || '',
      status: task.status,
      priority: task.priority,
      due_date: task.due_date ? task.due_date.split('T')[0] : '',
    })
    setShowAddForm(true)
  }

  const handleDelete = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) {
      return
    }

    try {
      await tasksApi.deleteTask(taskId)
      setSuccess('Task deleted successfully!')
      loadTasks()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete task')
    }
  }

  const handleStatusChange = async (taskId: string, newStatus: 'pending' | 'in_progress' | 'completed') => {
    try {
      await tasksApi.updateTask(taskId, { status: newStatus })
      loadTasks()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update task status')
    }
  }

  const toggleTaskExpanded = async (taskId: string) => {
    const newExpanded = new Set(expandedTasks)
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId)
    } else {
      newExpanded.add(taskId)
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

  const handleSubtaskSubmit = async (e: React.FormEvent, taskId: string) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!subtaskFormData.title.trim()) {
      setError('Subtask title is required')
      return
    }

    try {
      if (editingSubtask) {
        await tasksApi.updateSubtask(taskId, editingSubtask.subtask.id, {
          title: subtaskFormData.title,
          description: subtaskFormData.description || undefined,
        })
        setSuccess('Subtask updated successfully!')
      } else {
        await tasksApi.createSubtask(taskId, {
          title: subtaskFormData.title,
          description: subtaskFormData.description || undefined,
        })
        setSuccess('Subtask created successfully!')
      }
      setSubtaskFormData({ title: '', description: '' })
      setShowSubtaskForm(null)
      setEditingSubtask(null)
      // Reload subtasks
      const data = await tasksApi.getSubtasks(taskId)
      setSubtasks({ ...subtasks, [taskId]: data })
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save subtask')
    }
  }

  const handleSubtaskEdit = (taskId: string, subtask: Subtask) => {
    setEditingSubtask({ taskId, subtask })
    setSubtaskFormData({
      title: subtask.title,
      description: subtask.description || '',
    })
    setShowSubtaskForm(taskId)
  }

  const handleSubtaskDelete = async (taskId: string, subtaskId: string) => {
    if (!confirm('Are you sure you want to delete this subtask?')) {
      return
    }

    try {
      await tasksApi.deleteSubtask(taskId, subtaskId)
      setSuccess('Subtask deleted successfully!')
      // Reload subtasks
      const data = await tasksApi.getSubtasks(taskId)
      setSubtasks({ ...subtasks, [taskId]: data })
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete subtask')
    }
  }

  const handleSubtaskStatusChange = async (taskId: string, subtaskId: string, newStatus: 'pending' | 'completed') => {
    const updateKey = `${taskId}-${subtaskId}`
    
    // Prevent double updates
    if (updatingSubtasks.has(updateKey)) {
      return
    }
    
    setUpdatingSubtasks(prev => new Set(prev).add(updateKey))
    
    // Optimistically update the UI first
    const updatedSubtasks = subtasks[taskId]?.map(subtask =>
      subtask.id === subtaskId ? { ...subtask, status: newStatus } : subtask
    ) || []
    setSubtasks(prev => ({ ...prev, [taskId]: updatedSubtasks }))

    try {
      await tasksApi.updateSubtask(taskId, subtaskId, { status: newStatus })
      // Reload subtasks to ensure consistency
      const data = await tasksApi.getSubtasks(taskId)
      setSubtasks(prev => ({ ...prev, [taskId]: data }))
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update subtask status')
      // Revert on error
      const data = await tasksApi.getSubtasks(taskId)
      setSubtasks(prev => ({ ...prev, [taskId]: data }))
    } finally {
      setUpdatingSubtasks(prev => {
        const newSet = new Set(prev)
        newSet.delete(updateKey)
        return newSet
      })
    }
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

  const filteredTasks = tasks.filter(task => {
    if (filterStatus === 'all') return true
    return task.status === filterStatus
  })

  const pendingCount = tasks.filter(t => t.status === 'pending').length
  const inProgressCount = tasks.filter(t => t.status === 'in_progress').length
  const completedCount = tasks.filter(t => t.status === 'completed').length

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">My Tasks</h1>
        <button
          onClick={() => {
            setShowAddForm(true)
            setEditingTask(null)
            setFormData({ title: '', description: '', status: 'pending', priority: 'medium', due_date: '' })
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

      {/* Filter Tabs */}
      <div className="flex space-x-2 border-b border-gray-200">
        <button
          onClick={() => setFilterStatus('all')}
          className={`px-4 py-2 font-medium text-sm ${
            filterStatus === 'all'
              ? 'border-b-2 border-indigo-500 text-indigo-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          All ({tasks.length})
        </button>
        <button
          onClick={() => setFilterStatus('pending')}
          className={`px-4 py-2 font-medium text-sm ${
            filterStatus === 'pending'
              ? 'border-b-2 border-indigo-500 text-indigo-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Pending ({pendingCount})
        </button>
        <button
          onClick={() => setFilterStatus('in_progress')}
          className={`px-4 py-2 font-medium text-sm ${
            filterStatus === 'in_progress'
              ? 'border-b-2 border-indigo-500 text-indigo-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          In Progress ({inProgressCount})
        </button>
        <button
          onClick={() => setFilterStatus('completed')}
          className={`px-4 py-2 font-medium text-sm ${
            filterStatus === 'completed'
              ? 'border-b-2 border-indigo-500 text-indigo-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Completed ({completedCount})
        </button>
      </div>

      {/* Add/Edit Form */}
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
                setFormData({ title: '', description: '', status: 'pending', priority: 'medium', due_date: '' })
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
            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false)
                  setEditingTask(null)
                  setFormData({ title: '', description: '', status: 'pending', priority: 'medium', due_date: '' })
                  setError('')
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                {editingTask ? 'Update Task' : 'Create Task'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tasks List */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading tasks...</div>
      ) : filteredTasks.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-gray-500 mb-4">
            {filterStatus === 'all' 
              ? 'No tasks yet. Create your first task to get started!'
              : `No ${filterStatus.replace('_', ' ')} tasks.`}
          </div>
          <button
            onClick={() => {
              setShowAddForm(true)
              setEditingTask(null)
              setFormData({ title: '', description: '', status: 'pending', priority: 'medium', due_date: '' })
            }}
            className="btn-primary"
          >
            Create Task
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTasks.map((task) => {
            const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed'
            return (
              <div
                key={task.id}
                className={`card p-4 hover:shadow-md transition-shadow ${
                  task.status === 'completed' ? 'opacity-75' : ''
                } ${isOverdue ? 'border-l-4 border-red-500' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <input
                        type="checkbox"
                        checked={task.status === 'completed'}
                        onChange={(e) => {
                          handleStatusChange(task.id, e.target.checked ? 'completed' : 'pending')
                        }}
                        className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                      />
                      <h3 className={`text-lg font-semibold ${task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                        {task.title}
                      </h3>
                    </div>
                    {task.description && (
                      <p className="text-sm text-gray-600 mb-3 ml-8">{task.description}</p>
                    )}
                    <div className="flex items-center space-x-3 ml-8">
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
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
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
                      className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg"
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
                </div>

                {/* Subtasks Section */}
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <button
                      onClick={() => toggleTaskExpanded(task.id)}
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
                        className="text-xs px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded"
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
                                className="px-3 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
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
                                  className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
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
                                className="p-1 text-indigo-600 hover:bg-indigo-50 rounded text-xs"
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

