/**
 * useTaskManagement - Custom hook for task state management
 * Handles all task-related state and API operations
 */

import { useState, useEffect, useCallback } from 'react'
import { tasksApi, authApi } from '../services/api'
import type { Task, User, TaskValidation, TaskAttachment, Subtask } from '../types'

export interface TaskFormData {
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high'
  due_date: string
  assigned_to: string
  assignment_purpose: string
  assignment_purpose_custom: string
}

export interface SubtaskFormData {
  title: string
  description: string
}

const initialFormData: TaskFormData = {
  title: '',
  description: '',
  status: 'pending',
  priority: 'medium',
  due_date: '',
  assigned_to: '',
  assignment_purpose: '',
  assignment_purpose_custom: '',
}

const initialSubtaskFormData: SubtaskFormData = {
  title: '',
  description: '',
}

export function useTaskManagement() {
  // Core state
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Filter state
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterView, setFilterView] = useState<'all' | 'my-tasks'>('all')

  // User state
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [currentUserId, setCurrentUserId] = useState<string>('')
  const [currentUserInfo, setCurrentUserInfo] = useState<any>(null)

  // Expanded tasks state
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())

  // Related data
  const [validations, setValidations] = useState<Record<string, TaskValidation[]>>({})
  const [attachments, setAttachments] = useState<Record<string, TaskAttachment[]>>({})
  const [subtasks, setSubtasks] = useState<Record<string, Subtask[]>>({})

  // Form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [formData, setFormData] = useState<TaskFormData>(initialFormData)
  const [purposeType, setPurposeType] = useState<string>('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploadingFiles, setUploadingFiles] = useState(false)

  // Subtask form state
  const [showSubtaskForm, setShowSubtaskForm] = useState<string | null>(null)
  const [editingSubtask, setEditingSubtask] = useState<{ taskId: string; subtask: Subtask } | null>(null)
  const [subtaskFormData, setSubtaskFormData] = useState<SubtaskFormData>(initialSubtaskFormData)
  const [updatingSubtasks, setUpdatingSubtasks] = useState<Set<string>>(new Set())

  // Modal state
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [modalAttachments, setModalAttachments] = useState<TaskAttachment[]>([])

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState<string | null>(null)
  const [showAttachmentModal, setShowAttachmentModal] = useState<string | null>(null)
  const [uploadType, setUploadType] = useState<'file' | 'text'>('file')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedAttachmentFile, setSelectedAttachmentFile] = useState<File | null>(null)
  const [textContent, setTextContent] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})

  // Load initial data
  useEffect(() => {
    loadCurrentUser()
    loadUsers()
  }, [])

  useEffect(() => {
    if (currentUserId) {
      loadTasks()
    }
  }, [filterStatus, currentUserId])

  // Data loading functions
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
      setTasks(data)
      
      for (const task of data) {
        loadValidations(task.id)
        loadAttachments(task.id)
      }
    } catch (err: any) {
      console.error('Failed to load tasks:', err)
      const errorMessage = err.response?.data?.detail || err.message || 'Failed to load tasks.'
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

  const loadSubtasks = async (taskId: string) => {
    try {
      const data = await tasksApi.getSubtasks(taskId)
      setSubtasks(prev => ({ ...prev, [taskId]: data }))
    } catch (err: any) {
      console.error('Failed to load subtasks:', err)
    }
  }

  // Task expansion
  const toggleTaskExpansion = async (taskId: string) => {
    const newExpanded = new Set(expandedTasks)
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId)
    } else {
      newExpanded.add(taskId)
      if (!validations[taskId]) loadValidations(taskId)
      if (!attachments[taskId]) loadAttachments(taskId)
      if (!subtasks[taskId]) loadSubtasks(taskId)
    }
    setExpandedTasks(newExpanded)
  }

  // Task CRUD operations
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!formData.title.trim()) {
      setError('Title is required')
      return
    }

    const finalPurpose = formData.assigned_to && purposeType
      ? (purposeType === 'Others' ? formData.assignment_purpose_custom.trim() : purposeType)
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

      // Upload files if any
      if (selectedFiles.length > 0) {
        setUploadingFiles(true)
        const uploadErrors: string[] = []
        for (const file of selectedFiles) {
          try {
            await tasksApi.uploadTaskAttachment(newTask.id, file)
          } catch (singleFileErr: any) {
            const errMsg = singleFileErr.response?.data?.detail || singleFileErr.message || 'Unknown error'
            uploadErrors.push(`${file.name}: ${errMsg}`)
          }
        }
        
        if (uploadErrors.length === 0) {
          setSuccess('Task created and files uploaded successfully!')
        } else if (uploadErrors.length < selectedFiles.length) {
          setSuccess(`Task created. Some files uploaded, but ${uploadErrors.length} failed.`)
          setError(`Upload errors: ${uploadErrors.join('; ')}`)
        } else {
          setSuccess('Task created!')
          setError(`All file uploads failed: ${uploadErrors.join('; ')}`)
        }
        setUploadingFiles(false)
      }

      resetForm()
      setTimeout(() => loadTasks(), 300)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create task')
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task? This action cannot be undone.')) return
    
    try {
      await tasksApi.deleteTask(taskId)
      setSuccess('Task deleted!')
      setError('')
      await loadTasks()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete task')
      setSuccess('')
    }
  }

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try {
      await tasksApi.updateTask(taskId, { status: newStatus as any })
      await loadTasks()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update status')
    }
  }

  const handleEditTask = (task: Task) => {
    setEditingTask(task)
    setFormData({
      title: task.title,
      description: task.description || '',
      status: task.status,
      priority: task.priority,
      due_date: task.due_date || '',
      assigned_to: task.assigned_to || '',
      assignment_purpose: task.assignment_purpose || '',
      assignment_purpose_custom: '',
    })
    setPurposeType(task.assignment_purpose || '')
    setShowAddForm(true)
  }

  // Subtask operations
  const handleSubtaskSubmit = async (e: React.FormEvent, taskId: string) => {
    e.preventDefault()
    if (!subtaskFormData.title.trim()) return

    try {
      if (editingSubtask) {
        await tasksApi.updateSubtask(taskId, editingSubtask.subtask.id, subtaskFormData)
      } else {
        await tasksApi.createSubtask(taskId, subtaskFormData)
      }
      await loadSubtasks(taskId)
      resetSubtaskForm()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save subtask')
    }
  }

  const handleSubtaskStatusChange = async (taskId: string, subtaskId: string, newStatus: string) => {
    const updateKey = `${taskId}-${subtaskId}`
    setUpdatingSubtasks(prev => new Set(prev).add(updateKey))
    
    try {
      await tasksApi.updateSubtask(taskId, subtaskId, { status: newStatus as any })
      await loadSubtasks(taskId)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update subtask')
    } finally {
      setUpdatingSubtasks(prev => {
        const newSet = new Set(prev)
        newSet.delete(updateKey)
        return newSet
      })
    }
  }

  const handleSubtaskDelete = async (taskId: string, subtaskId: string) => {
    if (!confirm('Are you sure you want to delete this subtask?')) return
    
    try {
      await tasksApi.deleteSubtask(taskId, subtaskId)
      await loadSubtasks(taskId)
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete subtask')
    }
  }

  const handleSubtaskEdit = (taskId: string, subtask: Subtask) => {
    setEditingSubtask({ taskId, subtask })
    setSubtaskFormData({ title: subtask.title, description: subtask.description || '' })
    setShowSubtaskForm(taskId)
  }

  // Validation operations
  const handleUploadValidation = async (taskId: string) => {
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
      
      await loadValidations(taskId)
      resetUploadModal()
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to upload validation')
    } finally {
      setUploading(false)
    }
  }

  const handleReviewValidation = async (validationId: string, status: 'approved' | 'rejected') => {
    const notes = reviewNotes[validationId] || ''
    try {
      await tasksApi.reviewValidation(validationId, status, notes)
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
    if (!confirm('Are you sure you want to delete this validation?')) return
    
    try {
      await tasksApi.deleteValidation(validationId)
      await loadValidations(taskId)
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete validation')
    }
  }

  // Attachment operations
  const handleUploadAttachment = async (taskId: string) => {
    if (!selectedAttachmentFile) {
      alert('Please select a file')
      return
    }

    try {
      setUploadingAttachment(true)
      await tasksApi.uploadTaskAttachment(taskId, selectedAttachmentFile)
      await loadAttachments(taskId)
      setShowAttachmentModal(null)
      setSelectedAttachmentFile(null)
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to upload attachment')
    } finally {
      setUploadingAttachment(false)
    }
  }

  const handleDeleteAttachment = async (attachmentId: string, taskId: string) => {
    if (!confirm('Are you sure you want to delete this attachment?')) return
    
    try {
      await tasksApi.deleteTaskAttachment(attachmentId)
      await loadAttachments(taskId)
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete attachment')
    }
  }

  // Reset functions
  const resetForm = () => {
    setFormData(initialFormData)
    setPurposeType('')
    setSelectedFiles([])
    setShowAddForm(false)
    setEditingTask(null)
  }

  const resetSubtaskForm = () => {
    setSubtaskFormData(initialSubtaskFormData)
    setShowSubtaskForm(null)
    setEditingSubtask(null)
  }

  const resetUploadModal = () => {
    setShowUploadModal(null)
    setSelectedFile(null)
    setTextContent('')
    setUploadType('file')
  }

  // Utility functions
  const getUserName = useCallback((userId: string) => {
    const user = allUsers.find(u => u.id === userId)
    return user?.display_name || user?.email || 'Unknown User'
  }, [allUsers])

  const getFilteredTasks = useCallback(() => {
    return tasks.filter(task => {
      if (filterView === 'my-tasks' && task.assigned_to !== currentUserId) {
        return false
      }
      if (filterStatus !== 'all' && task.status !== filterStatus) {
        return false
      }
      return true
    })
  }, [tasks, filterView, filterStatus, currentUserId])

  const getTaskCounts = useCallback(() => {
    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      inProgress: tasks.filter(t => t.status === 'in_progress').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      myTasks: tasks.filter(t => t.assigned_to === currentUserId).length,
    }
  }, [tasks, currentUserId])

  return {
    // State
    tasks,
    loading,
    error,
    success,
    filterStatus,
    filterView,
    allUsers,
    currentUserId,
    currentUserInfo,
    expandedTasks,
    validations,
    attachments,
    subtasks,
    showAddForm,
    editingTask,
    formData,
    purposeType,
    selectedFiles,
    uploadingFiles,
    showSubtaskForm,
    editingSubtask,
    subtaskFormData,
    updatingSubtasks,
    selectedTask,
    showTaskModal,
    modalAttachments,
    showUploadModal,
    showAttachmentModal,
    uploadType,
    selectedFile,
    selectedAttachmentFile,
    textContent,
    uploading,
    uploadingAttachment,
    reviewNotes,

    // Setters
    setError,
    setSuccess,
    setFilterStatus,
    setFilterView,
    setShowAddForm,
    setFormData,
    setPurposeType,
    setSelectedFiles,
    setShowSubtaskForm,
    setSubtaskFormData,
    setEditingSubtask,
    setSelectedTask,
    setShowTaskModal,
    setModalAttachments,
    setShowUploadModal,
    setShowAttachmentModal,
    setUploadType,
    setSelectedFile,
    setSelectedAttachmentFile,
    setTextContent,
    setReviewNotes,

    // Actions
    loadTasks,
    loadValidations,
    loadAttachments,
    loadSubtasks,
    toggleTaskExpansion,
    handleCreateTask,
    handleDeleteTask,
    handleStatusChange,
    handleEditTask,
    handleSubtaskSubmit,
    handleSubtaskStatusChange,
    handleSubtaskDelete,
    handleSubtaskEdit,
    handleUploadValidation,
    handleReviewValidation,
    handleDeleteValidation,
    handleUploadAttachment,
    handleDeleteAttachment,
    resetForm,
    resetSubtaskForm,
    resetUploadModal,

    // Utilities
    getUserName,
    getFilteredTasks,
    getTaskCounts,
  }
}
