import { useEffect, useState, lazy, Suspense, useRef, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { tasksApi, authApi } from '../../services/api'
import type { Task, User, TaskValidation, TaskAttachment, Subtask } from '../../types'
import { supabase } from '../../lib/supabase'

// Lazy load ReactQuill
const ReactQuill = lazy(() => import('react-quill'))

// Editor loading placeholder
const EditorLoading = () => (
  <div className="border border-gray-300 rounded-lg p-4 min-h-[150px] flex items-center justify-center bg-gray-50">
    <div className="flex flex-col items-center space-y-2">
      <div className="w-8 h-8 border-4 border-[#0B1020] border-t-transparent rounded-full animate-spin"></div>
      <span className="text-gray-500 text-sm">Loading editor...</span>
    </div>
  </div>
)

// Quill modules base config
const quillModulesBase = {
  toolbar: {
    container: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      ['link', 'image'],
      [{ 'color': [] }, { 'background': [] }],
      ['clean'],
    ],
  },
  clipboard: {
    matchVisual: false,
  },
}

const quillFormats = [
  'header',
  'bold', 'italic', 'underline', 'strike',
  'list', 'bullet',
  'link', 'image',
  'color', 'background',
]

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
    link: '',
    purpose: '',
    purpose_custom: '',
    description: '',
    status: 'pending' as 'pending' | 'in_progress' | 'completed',
    priority: 'medium' as 'low' | 'medium' | 'high',
    due_date: '',
    assigned_to: '',
  })
  const [success, setSuccess] = useState('')
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [subtasks, setSubtasks] = useState<Record<string, Subtask[]>>({})
  const [showSubtaskForm, setShowSubtaskForm] = useState<string | null>(null)
  const [editingSubtask, setEditingSubtask] = useState<{ taskId: string; subtask: Subtask } | null>(null)
  const [subtaskFormData, setSubtaskFormData] = useState({ title: '', description: '', assigned_to: '' })
  const [updatingSubtasks, setUpdatingSubtasks] = useState<Set<string>>(new Set())
  const [quillCssLoaded, setQuillCssLoaded] = useState(false)
  const quillRef = useRef<any>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  useEffect(() => {
    loadCurrentUser()
    loadUsers()
  }, [])

  // Load Quill CSS when form is shown
  useEffect(() => {
    if (showAddForm && !quillCssLoaded) {
      import('react-quill/dist/quill.snow.css').then(() => {
        setQuillCssLoaded(true)
      }).catch(() => {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/react-quill@2.0.0/dist/quill.snow.css'
        document.head.appendChild(link)
        setQuillCssLoaded(true)
      })
    }
  }, [showAddForm, quillCssLoaded])

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
          console.log('Loaded subtasks for task', taskId, ':', data)
          setSubtasks(prev => ({ ...prev, [taskId]: data }))
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

  const handleDelete = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task? This action cannot be undone.')) {
      return
    }
    try {
      await tasksApi.deleteTask(taskId)
      setSuccess('Task deleted!')
      setError('')
      await loadTasks()
    } catch (err: any) {
      const errorMessage = err.response?.data?.detail || 'Failed to delete task'
      setError(errorMessage)
      setSuccess('')
    }
  }

  const handleStatusChange = async (taskId: string, newStatus: 'pending' | 'in_progress' | 'completed') => {
    try {
      // Find the task to check if current user is assigned
      const task = tasks.find(t => t.id === taskId)
      if (!task) {
        setError('Task not found')
        return
      }

      // Update the task status
      await tasksApi.updateTask(taskId, { status: newStatus })
      
      // If task is marked as completed by the assigned user, notify the sender
      if (newStatus === 'completed' && task.assigned_to === currentUserId && task.user_id !== currentUserId) {
        // The backend will handle the notification
        setSuccess('Task marked as completed! The task creator will be notified.')
      } else {
        setSuccess('Task status updated!')
      }
      
      // Reload tasks to reflect the change
      await loadTasks()
    } catch (err: any) {
      const errorMessage = err.response?.data?.detail || 'Failed to update task status'
      setError(errorMessage)
      setSuccess('')
    }
  }

  const handleSubtaskSubmit = async (e: React.FormEvent, taskId: string) => {
    e.preventDefault()
    if (!subtaskFormData.title.trim()) {
      return
    }

    try {
      if (editingSubtask && editingSubtask.taskId === taskId) {
        // Update existing subtask
        await tasksApi.updateSubtask(taskId, editingSubtask.subtask.id, {
          title: subtaskFormData.title.trim(),
          description: subtaskFormData.description.trim() || undefined,
          assigned_to: subtaskFormData.assigned_to || undefined,
        })
      } else {
        // Create new subtask
        await tasksApi.createSubtask(taskId, {
          title: subtaskFormData.title.trim(),
          description: subtaskFormData.description.trim() || undefined,
          assigned_to: subtaskFormData.assigned_to || undefined,
        })
      }

      // Reload subtasks for this task
      const data = await tasksApi.getSubtasks(taskId)
      setSubtasks(prev => ({ ...prev, [taskId]: data }))

      // Reset form
      setShowSubtaskForm(null)
      setEditingSubtask(null)
      setSubtaskFormData({ title: '', description: '', assigned_to: '' })
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to save subtask')
    }
  }

  const handleSubtaskStatusChange = async (taskId: string, subtaskId: string, newStatus: 'pending' | 'completed') => {
    const updateKey = `${taskId}-${subtaskId}`
    setUpdatingSubtasks(prev => new Set(prev).add(updateKey))
    
    try {
      await tasksApi.updateSubtask(taskId, subtaskId, { status: newStatus })
      // Reload subtasks for this task
      const data = await tasksApi.getSubtasks(taskId)
      setSubtasks(prev => ({ ...prev, [taskId]: data }))
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to update subtask status')
    } finally {
      setUpdatingSubtasks(prev => {
        const newSet = new Set(prev)
        newSet.delete(updateKey)
        return newSet
      })
    }
  }

  const handleSubtaskEdit = (taskId: string, subtask: Subtask) => {
    setEditingSubtask({ taskId, subtask })
    setShowSubtaskForm(taskId)
    setSubtaskFormData({
      title: subtask.title,
      description: subtask.description || '',
      assigned_to: subtask.assigned_to || '',
    })
  }

  const handleSubtaskDelete = async (taskId: string, subtaskId: string) => {
    if (!confirm('Are you sure you want to delete this subtask?')) {
      return
    }
    try {
      await tasksApi.deleteSubtask(taskId, subtaskId)
      // Reload subtasks for this task
      const data = await tasksApi.getSubtasks(taskId)
      setSubtasks(prev => ({ ...prev, [taskId]: data }))
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete subtask')
    }
  }

  const handleDeleteAttachment = async (attachmentId: string, taskId: string) => {
    if (!confirm('Are you sure you want to delete this attachment?')) {
      return
    }
    try {
      await tasksApi.deleteTaskAttachment(attachmentId)
      await loadAttachments(taskId)
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to delete attachment')
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

  // Resize image to max 450x450px
  const resizeImage = useCallback((file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = new Image()
        img.onload = () => {
          const maxWidth = 450
          const maxHeight = 450
          
          let width = img.width
          let height = img.height
          
          // Calculate new dimensions maintaining aspect ratio
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height)
            width = width * ratio
            height = height * ratio
          }
          
          // Create canvas and resize
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          
          if (!ctx) {
            reject(new Error('Failed to get canvas context'))
            return
          }
          
          ctx.drawImage(img, 0, 0, width, height)
          
          // Convert canvas to blob
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Failed to create blob'))
              return
            }
            const resizedFile = new File([blob], file.name, {
              type: file.type || 'image/png',
              lastModified: Date.now()
            })
            resolve(resizedFile)
          }, file.type || 'image/png', 0.9)
        }
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = e.target?.result as string
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(file)
    })
  }, [])

  // Handle image/file paste in Quill editor
  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    try {
      setUploadingImage(true)
      
      // Resize image if it's an image file
      let fileToUpload = file
      if (file.type.startsWith('image/')) {
        try {
          fileToUpload = await resizeImage(file)
        } catch (error) {
          console.warn('Failed to resize image, using original:', error)
          // Continue with original file if resize fails
        }
      }
      
      const timestamp = Date.now()
      const fileExt = fileToUpload.name.split('.').pop()
      const fileName = `${timestamp}-${Math.random().toString(36).substring(7)}.${fileExt}`
      const filePath = `task-descriptions/${currentUserId}/${fileName}`

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from('task-attachments')
        .upload(filePath, fileToUpload, {
          cacheControl: '3600',
          upsert: false
        })

      if (error) throw error

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('task-attachments')
        .getPublicUrl(filePath)

      return urlData.publicUrl
    } catch (error: any) {
      console.error('Error uploading image:', error)
      alert(`Failed to upload image: ${error.message}`)
      throw error
    } finally {
      setUploadingImage(false)
    }
  }, [currentUserId, resizeImage])

  // Create Quill modules with image handler (memoized)
  const quillModules = useMemo(() => ({
    ...quillModulesBase,
    toolbar: {
      ...quillModulesBase.toolbar,
      handlers: {
        image: function(this: any) {
          const input = document.createElement('input')
          input.setAttribute('type', 'file')
          input.setAttribute('accept', 'image/*')
          input.click()
          
          input.onchange = async () => {
            const file = input.files?.[0]
            if (file) {
              try {
                const url = await handleImageUpload(file)
                const quill = this.quill
                const range = quill.getSelection(true)
                quill.insertEmbed(range.index, 'image', url, 'user')
                quill.setSelection(range.index + 1)
              } catch (error) {
                console.error('Failed to upload image:', error)
              }
            }
          }
        }
      }
    }
  }), [handleImageUpload])

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

    try {
      // Determine the final purpose value
      const finalPurpose = formData.purpose
        ? (formData.purpose === 'Others' 
            ? formData.purpose_custom.trim()
            : formData.purpose)
        : undefined

      const taskData = {
        title: formData.title,
        link: formData.link.trim() || undefined,
        purpose: finalPurpose,
        description: formData.description || undefined,
        status: formData.status,
        priority: formData.priority,
        due_date: formData.due_date || undefined,
        assigned_to: formData.assigned_to || undefined,
      }

      let newTask
      if (editingTask) {
        newTask = await tasksApi.updateTask(editingTask.id, taskData)
        setSuccess('Task updated successfully!')
      } else {
        newTask = await tasksApi.createTask(taskData)
        setSuccess('Task created successfully!')
      }
      
      setFormData({ title: '', link: '', purpose: '', purpose_custom: '', description: '', status: 'pending', priority: 'medium', due_date: '', assigned_to: '' })
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

  const handleEdit = (task: Task) => {
    setEditingTask(task)
    setShowAddForm(true)
    
    // Determine if purpose is in the predefined list or is custom
    const purposeOptions = [
      'Box Contents Validation',
      'Master Sheet',
      'Amazon Audit',
      'Amazon Case',
      'Amazon Reimbursement',
      'FBA Inventory'
    ]
    
    const taskPurpose = task.purpose || ''
    const isCustomPurpose = taskPurpose && !purposeOptions.includes(taskPurpose)
    
    setFormData({
      title: task.title || '',
      link: task.link || '',
      purpose: isCustomPurpose ? 'Others' : (taskPurpose || ''),
      purpose_custom: isCustomPurpose ? taskPurpose : '',
      description: task.description || '',
      status: task.status || 'pending',
      priority: task.priority || 'medium',
      due_date: task.due_date || '',
      assigned_to: task.assigned_to || '',
    })
    setError('')
    setSuccess('')
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
            setFormData({ title: '', link: '', purpose: '', purpose_custom: '', description: '', status: 'pending', priority: 'medium', due_date: '', assigned_to: '' })
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
                setFormData({ title: '', link: '', purpose: '', purpose_custom: '', description: '', status: 'pending', priority: 'medium', due_date: '', assigned_to: '' })
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
                Link (Optional)
              </label>
              <input
                type="url"
                value={formData.link}
                onChange={(e) => setFormData({ ...formData, link: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="https://example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Purpose of Task
              </label>
              <select
                value={formData.purpose}
                onChange={(e) => {
                  setFormData({ ...formData, purpose: e.target.value, purpose_custom: '' })
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                <option value="">Select purpose...</option>
                <option value="Box Contents Validation">Box Contents Validation</option>
                <option value="Master Sheet">Master Sheet</option>
                <option value="Amazon Audit">Amazon Audit</option>
                <option value="Amazon Case">Amazon Case</option>
                <option value="Amazon Reimbursement">Amazon Reimbursement</option>
                <option value="FBA Inventory">FBA Inventory</option>
                <option value="Others">Others</option>
              </select>
              {formData.purpose === 'Others' && (
                <input
                  type="text"
                  value={formData.purpose_custom}
                  onChange={(e) => setFormData({ ...formData, purpose_custom: e.target.value })}
                  className="w-full mt-2 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="Specify purpose..."
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <div className="border border-gray-300 rounded-lg overflow-hidden">
                <Suspense fallback={<EditorLoading />}>
                  <ReactQuill
                    ref={quillRef}
                    theme="snow"
                    value={formData.description}
                    onChange={(value) => setFormData({ ...formData, description: value })}
                    modules={quillModules}
                    formats={quillFormats}
                    placeholder="Enter task description... You can paste images or files here (Ctrl+V or Cmd+V)"
                    style={{ minHeight: '150px' }}
                    onPaste={(e) => {
                      const clipboardData = e.clipboardData
                      const items = clipboardData.items

                      for (let i = 0; i < items.length; i++) {
                        const item = items[i]
                        
                        // Handle image paste
                        if (item.type.indexOf('image') !== -1) {
                          e.preventDefault()
                          const file = item.getAsFile()
                          if (file) {
                            handleImageUpload(file).then((url) => {
                              const quill = quillRef.current?.getEditor()
                              if (quill) {
                                const range = quill.getSelection(true)
                                quill.insertEmbed(range.index, 'image', url, 'user')
                                quill.setSelection(range.index + 1)
                              }
                            }).catch(() => {
                              // Error already handled in handleImageUpload
                            })
                          }
                          return
                        }
                        
                        // Handle file paste
                        if (item.kind === 'file' && item.type.indexOf('image') === -1) {
                          e.preventDefault()
                          const file = item.getAsFile()
                          if (file) {
                            handleImageUpload(file).then((url) => {
                              const quill = quillRef.current?.getEditor()
                              if (quill) {
                                const range = quill.getSelection(true)
                                const fileName = file.name
                                quill.insertText(range.index, `📎 ${fileName} `, 'user')
                                quill.insertEmbed(range.index + fileName.length + 2, 'link', url, 'user')
                                quill.setSelection(range.index + fileName.length + 2)
                              }
                            }).catch(() => {
                              // Error already handled
                            })
                          }
                          return
                        }
                      }
                    }}
                  />
                </Suspense>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                💡 Tip: Paste images or files directly into the editor (Ctrl+V / Cmd+V). Images will be embedded, files will be linked.
              </p>
              <style>{`
                .ql-editor {
                  min-height: 150px;
                }
                .ql-container {
                  font-size: 14px;
                }
                .ql-editor img {
                  max-width: 450px;
                  max-height: 450px;
                  width: auto;
                  height: auto;
                  object-fit: contain;
                  cursor: pointer;
                  border: 1px solid #e5e7eb;
                  border-radius: 4px;
                  margin: 4px 0;
                }
                .ql-editor img:hover {
                  opacity: 0.8;
                }
                .ql-editor a {
                  color: #0B1020;
                  text-decoration: underline;
                }
                /* Style for rendered description images */
                div[class*="text-sm"] img,
                div[class*="text-gray"] img {
                  max-width: 450px;
                  max-height: 450px;
                  width: auto;
                  height: auto;
                  object-fit: contain;
                  cursor: pointer;
                  border: 1px solid #e5e7eb;
                  border-radius: 4px;
                  margin: 4px 0;
                }
                div[class*="text-sm"] img:hover,
                div[class*="text-gray"] img:hover {
                  opacity: 0.8;
                }
              `}</style>
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
            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false)
                  setEditingTask(null)
                  setFormData({ title: '', link: '', purpose: '', purpose_custom: '', description: '', status: 'pending', priority: 'medium', due_date: '', assigned_to: '' })
                  setError('')
                  setSuccess('')
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingTask ? 'Update Task' : 'Create Task'}
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
                        onClick={async (e) => {
                          e.stopPropagation()
                          setSelectedTask(task)
                          setShowTaskModal(true)
                          // Always fetch fresh attachments when opening modal
                          try {
                            console.log('Loading attachments for task:', task.id)
                            const taskAttachments = await tasksApi.getTaskAttachments(task.id)
                            console.log('Attachments loaded:', taskAttachments)
                            setModalAttachments(taskAttachments || [])
                          } catch (err: any) {
                            console.error('Failed to load attachments:', err)
                            const errorMsg = err?.response?.data?.detail || err?.message || 'Failed to load attachments'
                            console.error('Error details:', errorMsg)
                            setModalAttachments([])
                            // Show error to user
                            setError(`Failed to load attachments: ${errorMsg}`)
                          }
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
                      <div 
                        className="text-sm text-gray-600 mb-3 ml-8"
                        dangerouslySetInnerHTML={{ __html: task.description }}
                        onClick={(e) => {
                          // Make images downloadable
                          const target = e.target as HTMLElement
                          if (target.tagName === 'IMG') {
                            e.preventDefault()
                            const img = target as HTMLImageElement
                            const link = document.createElement('a')
                            link.href = img.src
                            link.download = img.alt || `image-${Date.now()}.png`
                            link.target = '_blank'
                            document.body.appendChild(link)
                            link.click()
                            document.body.removeChild(link)
                          }
                        }}
                        style={{
                          cursor: 'default'
                        }}
                      />
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
                          // Always fetch fresh attachments when opening modal
                          try {
                            console.log('Loading attachments for task:', task.id)
                            const taskAttachments = await tasksApi.getTaskAttachments(task.id)
                            console.log('Attachments loaded:', taskAttachments)
                            setModalAttachments(taskAttachments || [])
                          } catch (err: any) {
                            console.error('Failed to load attachments:', err)
                            const errorMsg = err?.response?.data?.detail || err?.message || 'Failed to load attachments'
                            console.error('Error details:', errorMsg)
                            setModalAttachments([])
                            // Show error to user
                            setError(`Failed to load attachments: ${errorMsg}`)
                          }
                        }}
                        className="px-3 py-1.5 text-sm bg-[#0B1020] text-white rounded-lg hover:bg-[#F97316] transition-colors"
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
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-gray-200 ml-8">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-semibold text-gray-900">Subtasks ({subtasks[task.id]?.length || 0})</h4>
                          <button
                            onClick={() => {
                              setShowSubtaskForm(task.id)
                              setEditingSubtask(null)
                              setSubtaskFormData({ title: '', description: '', assigned_to: '' })
                            }}
                            className="px-3 py-1.5 text-sm bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors"
                          >
                            + Add Subtask
                          </button>
                        </div>

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
                                <select
                                  value={subtaskFormData.assigned_to}
                                  onChange={(e) => setSubtaskFormData({ ...subtaskFormData, assigned_to: e.target.value })}
                                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                >
                                  <option value="">Assign to (optional)</option>
                                  {allUsers.map((user) => (
                                    <option key={user.id} value={user.id}>
                                      {user.display_name || user.email || user.id}
                                    </option>
                                  ))}
                                </select>
                                <div className="flex justify-end space-x-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowSubtaskForm(null)
                                      setEditingSubtask(null)
                                      setSubtaskFormData({ title: '', description: '', assigned_to: '' })
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
                                
                                // Debug: log subtask data
                                if (subtask.assigned_to) {
                                  console.log('Subtask assigned_to:', subtask.id, subtask.assigned_to, getUserName(subtask.assigned_to))
                                }
                                
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
                                    <div className="flex-1 flex items-center gap-2">
                                      <span
                                        className={`text-sm ${
                                          subtask.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'
                                        }`}
                                      >
                                        {subtask.title}
                                      </span>
                                      {subtask.assigned_to && (
                                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                                          👤 {getUserName(subtask.assigned_to)}
                                        </span>
                                      )}
                                    </div>
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
                {selectedTask.description ? (
                  <div 
                    className="mt-1 text-gray-900"
                    dangerouslySetInnerHTML={{ __html: selectedTask.description }}
                    onClick={(e) => {
                      // Make images downloadable
                      const target = e.target as HTMLElement
                      if (target.tagName === 'IMG') {
                        e.preventDefault()
                        const img = target as HTMLImageElement
                        const link = document.createElement('a')
                        link.href = img.src
                        link.download = img.alt || `image-${Date.now()}.png`
                        link.target = '_blank'
                        document.body.appendChild(link)
                        link.click()
                        document.body.removeChild(link)
                      }
                    }}
                    style={{
                      cursor: 'default'
                    }}
                  />
                ) : (
                  <p className="mt-1 text-gray-500">No description provided</p>
                )}
              </div>

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
                ) : null}
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
