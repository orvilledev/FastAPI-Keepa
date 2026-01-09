import axios from 'axios'
import { supabase } from '../lib/supabase'
import type { BatchJob, JobStatus, PriceAlert, UPC, MAP, SchedulerStatus, PublicTool, QuickAccessLink, Task, Subtask, DashboardWidget, UserTool, Note, JobAid, TaskValidation, TaskAttachment } from '../types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Cache for auth token to avoid repeated getSession calls
let cachedToken: string | null = null
let tokenExpiresAt: number = 0

// Listen for auth changes to update cached token
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.access_token) {
    cachedToken = session.access_token
    // Set expiry 5 minutes before actual expiry for safety
    tokenExpiresAt = (session.expires_at || 0) * 1000 - 5 * 60 * 1000
  } else {
    cachedToken = null
    tokenExpiresAt = 0
  }
})

// Initialize token on load
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session?.access_token) {
    cachedToken = session.access_token
    tokenExpiresAt = (session.expires_at || 0) * 1000 - 5 * 60 * 1000
  }
})

// Add auth token to requests (using cached token)
api.interceptors.request.use(async (config) => {
  // Only fetch fresh session if token is expired or missing
  if (!cachedToken || Date.now() > tokenExpiresAt) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      cachedToken = session.access_token
      tokenExpiresAt = (session.expires_at || 0) * 1000 - 5 * 60 * 1000
    }
  }
  
  if (cachedToken) {
    config.headers.Authorization = `Bearer ${cachedToken}`
  }
  return config
})

// Centralized error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Extract error message from response
    const message = error.response?.data?.detail || error.message || 'An error occurred'
    
    // Log error for debugging
    console.error('API Error:', {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      message,
    })
    
    // You could add toast notifications here in the future
    // toast.error(message)
    
    return Promise.reject(error)
  }
)

// Auth API
export const authApi = {
  getCurrentUser: async () => {
    const response = await api.get('/api/v1/auth/me')
    return response.data
  },
  getProfile: async () => {
    const response = await api.get('/api/v1/auth/profile')
    return response.data
  },
  getAllUsers: async () => {
    const response = await api.get<{ users: Array<{ id: string; email: string; role: string; display_name?: string; has_keepa_access: boolean; can_manage_tools: boolean; can_assign_tasks: boolean; created_at: string }> }>('/api/v1/auth/users')
    return response.data
  },
  updateUserKeepaAccess: async (userId: string, hasKeepaAccess: boolean) => {
    const response = await api.put<{ user_id: string; has_keepa_access: boolean; message: string }>(`/api/v1/auth/users/${userId}/keepa-access`, { has_keepa_access: hasKeepaAccess })
    return response.data
  },
  updateUserToolsAccess: async (userId: string, canManageTools: boolean) => {
    const response = await api.put<{ user_id: string; can_manage_tools: boolean; message: string }>(`/api/v1/auth/users/${userId}/tools-access`, { can_manage_tools: canManageTools })
    return response.data
  },
  updateUserTasksAccess: async (userId: string, canAssignTasks: boolean) => {
    const response = await api.put<{ user_id: string; can_assign_tasks: boolean; message: string }>(`/api/v1/auth/users/${userId}/tasks-access`, { can_assign_tasks: canAssignTasks })
    return response.data
  },
  updateProfile: async (profileData: any) => {
    const response = await api.put('/api/v1/auth/profile', profileData)
    return response.data
  },
  updateDisplayName: async (displayName: string) => {
    const response = await api.patch('/api/v1/auth/me/display-name', {
      display_name: displayName
    })
    return response.data
  },
}

// Jobs API
export const jobsApi = {
  createJob: async (jobData: { job_name: string; upcs: string[] }) => {
    const response = await api.post<BatchJob>('/api/v1/jobs', jobData)
    return response.data
  },
  
  listJobs: async (limit: number = 20, offset: number = 0) => {
    const response = await api.get<BatchJob[]>('/api/v1/jobs', {
      params: { limit, offset }
    })
    return response.data
  },
  
  getJob: async (jobId: string) => {
    const response = await api.get<BatchJob>(`/api/v1/jobs/${jobId}`)
    return response.data
  },
  
  updateJob: async (jobId: string, jobData: { job_name?: string; description?: string; email_recipients?: string }) => {
    const response = await api.put<BatchJob>(`/api/v1/jobs/${jobId}`, jobData)
    return response.data
  },
  
  getJobStatus: async (jobId: string) => {
    const response = await api.get<JobStatus>(`/api/v1/jobs/${jobId}/status`)
    return response.data
  },
  
  triggerJob: async (jobId: string) => {
    const response = await api.post(`/api/v1/jobs/${jobId}/trigger`)
    return response.data
  },
  
  deleteJob: async (jobId: string) => {
    const response = await api.delete(`/api/v1/jobs/${jobId}`)
    return response.data
  },
}

// Batches API
export const batchesApi = {
  stopBatch: async (batchId: string) => {
    const response = await api.post(`/api/v1/batches/${batchId}/stop`)
    return response.data
  },
}

// Reports API
export const reportsApi = {
  getPriceAlerts: async (jobId: string) => {
    const response = await api.get<PriceAlert[]>(`/api/v1/reports/${jobId}`)
    return response.data
  },
  
  downloadCSV: async (jobId: string) => {
    const response = await api.get(`/api/v1/reports/${jobId}/csv`, {
      responseType: 'blob',
    })
    return response.data
  },
  
  resendEmail: async (jobId: string) => {
    const response = await api.post(`/api/v1/reports/${jobId}/email`)
    return response.data
  },
}

// UPCs API
export const upcsApi = {
  addUPCs: async (upcs: string[]) => {
    const response = await api.post('/api/v1/upcs', upcs)
    return response.data
  },
  
  listUPCs: async (limit: number = 100, offset: number = 0) => {
    const response = await api.get<UPC[]>(`/api/v1/upcs?limit=${limit}&offset=${offset}`)
    return response.data
  },
  
  getUPCCount: async () => {
    const response = await api.get<{ count: number }>('/api/v1/upcs/count')
    return response.data
  },
  
  deleteUPC: async (upc: string) => {
    const response = await api.delete(`/api/v1/upcs/${upc}`)
    return response.data
  },
  
  deleteAllUPCs: async () => {
    const response = await api.delete('/api/v1/upcs')
    return response.data
  },
}

// MAP API
export const mapApi = {
  checkMAPDuplicates: async (maps: Array<{ upc: string; map_price: number }>) => {
    const response = await api.post('/api/v1/map/check-duplicates', maps)
    return response.data
  },
  
  addMAPs: async (maps: Array<{ upc: string; map_price: number }>, replaceDuplicates: boolean = false) => {
    const response = await api.post(`/api/v1/map?replace_duplicates=${replaceDuplicates}`, maps)
    return response.data
  },
  
  listMAPs: async (limit: number = 100, offset: number = 0, search?: string) => {
    const params = new URLSearchParams()
    params.append('limit', limit.toString())
    params.append('offset', offset.toString())
    if (search && search.trim()) {
      params.append('search', search.trim())
    }
    const response = await api.get<MAP[]>(`/api/v1/map?${params.toString()}`)
    return response.data
  },
  
  getMAPCount: async (search?: string) => {
    const params = new URLSearchParams()
    if (search && search.trim()) {
      params.append('search', search.trim())
    }
    const response = await api.get<{ count: number }>(`/api/v1/map/count?${params.toString()}`)
    return response.data
  },
  
  getMAPByUPC: async (upc: string) => {
    const response = await api.get<MAP>(`/api/v1/map/${upc}`)
    return response.data
  },
  
  deleteMAP: async (upc: string) => {
    const response = await api.delete(`/api/v1/map/${upc}`)
    return response.data
  },
  
  deleteAllMAPs: async () => {
    const response = await api.delete('/api/v1/map')
    return response.data
  },
}

// Scheduler API
export const schedulerApi = {
  getNextRun: async () => {
    const response = await api.get<SchedulerStatus>('/api/v1/scheduler/next-run')
    return response.data
  },
  getSettings: async () => {
    const response = await api.get<{ timezone: string; hour: number; minute: number; enabled: boolean }>('/api/v1/scheduler/settings')
    return response.data
  },
  updateSettings: async (settings: { timezone?: string; hour?: number; minute?: number; enabled?: boolean }) => {
    const response = await api.put<{ timezone: string; hour: number; minute: number; enabled: boolean; message: string }>('/api/v1/scheduler/settings', settings)
    return response.data
  },
}

// Tools API
export const toolsApi = {
  getPublicTools: async () => {
    const response = await api.get<PublicTool[]>('/api/v1/tools/public')
    return response.data
  },
  
  createPublicTool: async (toolData: {
    name: string
    description?: string
    url: string
    video_url?: string
    developer?: string
    category?: string
    icon?: string
  }) => {
    const response = await api.post<PublicTool>('/api/v1/tools/public', toolData)
    return response.data
  },
  
  updatePublicTool: async (toolId: string, toolData: {
    name?: string
    description?: string
    url?: string
    video_url?: string
    developer?: string
    category?: string
    icon?: string
  }) => {
    const response = await api.put<PublicTool>(`/api/v1/tools/public/${toolId}`, toolData)
    return response.data
  },
  
  deletePublicTool: async (toolId: string) => {
    const response = await api.delete(`/api/v1/tools/public/${toolId}`)
    return response.data
  },
  
  starTool: async (toolId: string) => {
    const response = await api.post(`/api/v1/tools/public/${toolId}/star`)
    return response.data
  },
  
  unstarTool: async (toolId: string) => {
    const response = await api.delete(`/api/v1/tools/public/${toolId}/star`)
    return response.data
  },
  
  getStarredToolIds: async () => {
    const response = await api.get<{ starred_ids: string[] }>('/api/v1/tools/public/starred')
    return response.data.starred_ids
  },
  
  getMyToolbox: async () => {
    const response = await api.get<{ public_tools: PublicTool[]; job_aids: JobAid[] }>('/api/v1/tools/my-toolbox')
    return response.data
  },
  // User Tools (personal tools)
  getUserTools: async () => {
    const response = await api.get<UserTool[]>('/api/v1/tools/user')
    return response.data
  },
  createUserTool: async (toolData: {
    name: string
    description?: string
    url: string
    developer?: string
    category?: string
    icon?: string
  }) => {
    const response = await api.post<UserTool>('/api/v1/tools/user', toolData)
    return response.data
  },
  updateUserTool: async (toolId: string, toolData: {
    name?: string
    description?: string
    url?: string
    developer?: string
    category?: string
    icon?: string
  }) => {
    const response = await api.put<UserTool>(`/api/v1/tools/user/${toolId}`, toolData)
    return response.data
  },
  deleteUserTool: async (toolId: string) => {
    const response = await api.delete(`/api/v1/tools/user/${toolId}`)
    return response.data
  },
  // Job Aids
  getJobAids: async () => {
    const response = await api.get<JobAid[]>('/api/v1/tools/job-aids')
    return response.data
  },
  createJobAid: async (aidData: {
    name: string
    description?: string
    url: string
    video_url?: string
    developer?: string
    category?: string
    icon?: string
  }) => {
    const response = await api.post<JobAid>('/api/v1/tools/job-aids', aidData)
    return response.data
  },
  updateJobAid: async (aidId: string, aidData: {
    name?: string
    description?: string
    url?: string
    video_url?: string
    developer?: string
    category?: string
    icon?: string
  }) => {
    const response = await api.put<JobAid>(`/api/v1/tools/job-aids/${aidId}`, aidData)
    return response.data
  },
  deleteJobAid: async (aidId: string) => {
    const response = await api.delete(`/api/v1/tools/job-aids/${aidId}`)
    return response.data
  },
  starJobAid: async (aidId: string) => {
    const response = await api.post(`/api/v1/tools/job-aids/${aidId}/star`)
    return response.data
  },
  unstarJobAid: async (aidId: string) => {
    const response = await api.delete(`/api/v1/tools/job-aids/${aidId}/star`)
    return response.data
  },
  getStarredJobAidIds: async () => {
    const response = await api.get<{ starred_ids: string[] }>('/api/v1/tools/job-aids/starred')
    return response.data.starred_ids
  },
}

// Quick Access Links API
export const quickAccessApi = {
  getLinks: async () => {
    const response = await api.get<QuickAccessLink[]>('/api/v1/quick-access')
    return response.data
  },
  createLink: async (linkData: {
    title: string
    url: string
    icon?: string
    display_order?: number
  }) => {
    const response = await api.post<QuickAccessLink>('/api/v1/quick-access', linkData)
    return response.data
  },
  updateLink: async (linkId: string, linkData: {
    title?: string
    url?: string
    icon?: string
    display_order?: number
  }) => {
    const response = await api.put<QuickAccessLink>(`/api/v1/quick-access/${linkId}`, linkData)
    return response.data
  },
  deleteLink: async (linkId: string) => {
    const response = await api.delete(`/api/v1/quick-access/${linkId}`)
    return response.data
  },
}

// Tasks API
export const tasksApi = {
  getTasks: async (status?: string, priority?: string) => {
    const params = new URLSearchParams()
    if (status) params.append('status', status)
    if (priority) params.append('priority', priority)
    const queryString = params.toString()
    const url = `/api/v1/tasks${queryString ? `?${queryString}` : ''}`
    const response = await api.get<Task[]>(url)
    return response.data
  },
  createTask: async (taskData: {
    title: string
    description?: string
    status?: string
    priority?: string
    due_date?: string
    assigned_to?: string
    assignment_purpose?: string
  }) => {
    const response = await api.post<Task>('/api/v1/tasks', taskData)
    return response.data
  },
  updateTask: async (taskId: string, taskData: {
    title?: string
    description?: string
    status?: string
    priority?: string
    due_date?: string
    assigned_to?: string
    assignment_purpose?: string
  }) => {
    const response = await api.put<Task>(`/api/v1/tasks/${taskId}`, taskData)
    return response.data
  },
  deleteTask: async (taskId: string) => {
    const response = await api.delete(`/api/v1/tasks/${taskId}`)
    return response.data
  },
  // Subtasks
  getSubtasks: async (taskId: string) => {
    const response = await api.get<Subtask[]>(`/api/v1/tasks/${taskId}/subtasks`)
    return response.data
  },
  createSubtask: async (taskId: string, subtaskData: {
    title: string
    description?: string
    status?: string
    display_order?: number
  }) => {
    const response = await api.post<Subtask>(`/api/v1/tasks/${taskId}/subtasks`, subtaskData)
    return response.data
  },
  updateSubtask: async (taskId: string, subtaskId: string, subtaskData: {
    title?: string
    description?: string
    status?: string
    display_order?: number
  }) => {
    const response = await api.put<Subtask>(`/api/v1/tasks/${taskId}/subtasks/${subtaskId}`, subtaskData)
    return response.data
  },
  deleteSubtask: async (taskId: string, subtaskId: string) => {
    const response = await api.delete(`/api/v1/tasks/${taskId}/subtasks/${subtaskId}`)
    return response.data
  },
  // Task Validations
  getTaskValidations: async (taskId: string) => {
    const response = await api.get<TaskValidation[]>(`/api/v1/tasks/${taskId}/validations`)
    return response.data
  },
  uploadFileValidation: async (taskId: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await api.post<TaskValidation>(`/api/v1/tasks/${taskId}/validations/file`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    return response.data
  },
  submitTextValidation: async (taskId: string, textContent: string) => {
    const formData = new FormData()
    formData.append('text_content', textContent)
    const response = await api.post<TaskValidation>(`/api/v1/tasks/${taskId}/validations/text`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    return response.data
  },
  reviewValidation: async (validationId: string, status: 'approved' | 'rejected', reviewNotes?: string) => {
    const response = await api.put<TaskValidation>(`/api/v1/task-validations/${validationId}/review`, {
      status,
      review_notes: reviewNotes,
    })
    return response.data
  },
  deleteValidation: async (validationId: string) => {
    const response = await api.delete(`/api/v1/task-validations/${validationId}`)
    return response.data
  },
  // Task Attachments
  getTaskAttachments: async (taskId: string) => {
    const response = await api.get<TaskAttachment[]>(`/api/v1/tasks/${taskId}/attachments`)
    return response.data
  },
  uploadTaskAttachment: async (taskId: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    // Don't set Content-Type header - let browser set it with boundary for multipart/form-data
    const response = await api.post<TaskAttachment>(`/api/v1/tasks/${taskId}/attachments`, formData)
    return response.data
  },
  deleteTaskAttachment: async (attachmentId: string) => {
    const response = await api.delete(`/api/v1/task-attachments/${attachmentId}`)
    return response.data
  },
}

// Dashboard Widgets API
export const dashboardApi = {
  getWidgets: async () => {
    const response = await api.get<DashboardWidget[]>('/api/v1/dashboard/widgets')
    return response.data
  },
  updateWidgetOrder: async (widgets: { widget_id: string; display_order: number }[]) => {
    const response = await api.post<DashboardWidget[]>('/api/v1/dashboard/widgets/order', { widgets })
    return response.data
  },
}

// Notes API
export const notesApi = {
  listNotes: async (page: number = 0, pageSize: number = 20, search?: string, category?: string) => {
    const params: any = { page, page_size: pageSize }
    if (search) params.search = search
    if (category) params.category = category
    const response = await api.get<{
      notes: Note[]
      total: number
      page: number
      page_size: number
      total_pages: number
    }>('/api/v1/notes', { params })
    return response.data
  },
  getNote: async (noteId: string) => {
    const response = await api.get<Note>(`/api/v1/notes/${noteId}`)
    return response.data
  },
  createNote: async (noteData: { title: string; content: string; category?: string; color?: string; importance?: string; is_protected?: boolean; password?: string; require_password_always?: boolean }) => {
    const response = await api.post<Note>('/api/v1/notes', noteData)
    return response.data
  },
  updateNote: async (noteId: string, noteData: { title?: string; content?: string; category?: string; color?: string; importance?: string; is_protected?: boolean; password?: string; remove_password?: boolean; require_password_always?: boolean }) => {
    const response = await api.put<Note>(`/api/v1/notes/${noteId}`, noteData)
    return response.data
  },
  verifyNotePassword: async (noteId: string, password: string) => {
    const response = await api.post<{ verified: boolean }>(`/api/v1/notes/${noteId}/verify-password`, { password })
    return response.data
  },
  reorderNotes: async (noteIds: string[]) => {
    const response = await api.post<{ message: string }>('/api/v1/notes/reorder', { note_ids: noteIds })
    return response.data
  },
  deleteNote: async (noteId: string) => {
    const response = await api.delete(`/api/v1/notes/${noteId}`)
    return response.data
  },
}

export default api

