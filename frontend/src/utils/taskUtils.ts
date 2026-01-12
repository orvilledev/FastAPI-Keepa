/**
 * Task utility functions
 */

export const getStatusColor = (status: string): string => {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800'
    case 'in_progress':
      return 'bg-blue-100 text-blue-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export const getPriorityColor = (priority: string): string => {
  switch (priority) {
    case 'high':
      return 'bg-red-100 text-red-800'
    case 'medium':
      return 'bg-yellow-100 text-yellow-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export const getValidationStatusColor = (status: string): string => {
  switch (status) {
    case 'approved':
      return 'bg-green-100 text-green-800'
    case 'rejected':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-yellow-100 text-yellow-800'
  }
}

export const getFileIcon = (fileCategory: string): string => {
  switch (fileCategory) {
    case 'image':
      return '🖼️'
    case 'pdf':
      return '📄'
    case 'excel':
      return '📊'
    case 'csv':
      return '📋'
    case 'powerpoint':
      return '📽️'
    case 'word':
      return '📝'
    default:
      return '📎'
  }
}

export const formatFileSize = (bytes?: number): string => {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export const isTaskOverdue = (task: { due_date?: string; status: string }): boolean => {
  return !!(task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed')
}

export const ALLOWED_FILE_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'application/csv',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]

export const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export const validateFile = (file: File): { valid: boolean; error?: string } => {
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return { valid: false, error: `${file.name} (unsupported type)` }
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `${file.name} (exceeds 50MB)` }
  }
  return { valid: true }
}

export const validateFiles = (files: File[]): { validFiles: File[]; invalidFiles: string[] } => {
  const validFiles: File[] = []
  const invalidFiles: string[] = []

  files.forEach(file => {
    const result = validateFile(file)
    if (result.valid) {
      validFiles.push(file)
    } else {
      invalidFiles.push(result.error!)
    }
  })

  return { validFiles, invalidFiles }
}

export const PURPOSE_OPTIONS = [
  'Box Contents Validation',
  'Amazon Cases',
  'Amazon Audit',
  'Master Sheet',
  'Inventory Adjustment',
  'Others',
]
