import axios from 'axios'
import { supabase } from '../lib/supabase'
import type {
  MapVendorType, BatchJob, JobStatus, PriceAlert, UPC, MAP, SchedulerStatus, SchedulerSettings, PublicTool, QuickAccessLink, DashboardWidget, UserTool, Note, JobAid, Notification, ComprehensiveReportRow, SellerName } from '../types'

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

  // Let axios/browser set multipart boundary automatically for FormData.
  // A global JSON content-type breaks FastAPI UploadFile parsing (422).
  if (config.data instanceof FormData && config.headers) {
    delete config.headers['Content-Type']
  }
  return config
})

// Centralized error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Extract error message from response
    const message = error.response?.data?.detail || error.message || 'An error occurred'
    
    // Handle 401 Unauthorized - try to refresh token
    if (error.response?.status === 401 && error.config && !error.config._retry) {
      error.config._retry = true
      
      try {
        // Get fresh session from Supabase
        const { data: { session } } = await supabase.auth.getSession()
        
        if (session?.access_token) {
          // Update cached token
          cachedToken = session.access_token
          tokenExpiresAt = (session.expires_at || 0) * 1000 - 5 * 60 * 1000
          
          // Retry the request with new token
          error.config.headers.Authorization = `Bearer ${cachedToken}`
          return api.request(error.config)
        } else {
          // No valid session, redirect to login
          console.error('No valid session found, redirecting to login')
          window.location.href = '/login'
          return Promise.reject(error)
        }
      } catch (refreshError) {
        // Failed to refresh, redirect to login
        console.error('Failed to refresh token:', refreshError)
        window.location.href = '/login'
        return Promise.reject(error)
      }
    }
    
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
    const response = await api.get<{ users: Array<{ id: string; email: string; role: string; display_name?: string; has_keepa_access: boolean; can_manage_tools: boolean; is_active?: boolean; created_at: string }> }>('/api/v1/auth/users')
    return response.data
  },
  approveUser: async (userId: string) => {
    const response = await api.post<{ user_id: string; message: string }>(`/api/v1/auth/users/${userId}/approve`)
    return response.data
  },
  deactivateUser: async (userId: string) => {
    const response = await api.post<{ user_id: string; message: string }>(`/api/v1/auth/users/${userId}/deactivate`)
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
  createJob: async (jobData: {
    job_name: string
    upcs: string[]
    email_recipients?: string
    map_vendor_type?: MapVendorType
    keepa_offers_limit: number
    off_price_scope?: 'buybox_only' | 'buybox_and_non_buybox_below_map'
  }) => {
    const response = await api.post<BatchJob>('/api/v1/jobs', jobData)
    return response.data
  },
  
  listJobs: async (limit: number = 20, offset: number = 0) => {
    const response = await api.get<BatchJob[]>('/api/v1/jobs', {
      params: { limit, offset }
    })
    return response.data
  },

  getJobStats: async () => {
    const response = await api.get<{
      total: number
      processing: number
      completed: number
      failed: number
    }>('/api/v1/jobs/stats')
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

  stopJob: async (jobId: string) => {
    const response = await api.post(`/api/v1/jobs/${jobId}/stop`)
    return response.data
  },
  
  deleteJob: async (jobId: string) => {
    const response = await api.delete(`/api/v1/jobs/${jobId}`)
    return response.data
  },
}

export type EmailPoolEntry = { id: string; email: string; display_name?: string | null }
export type EmailSavedList = { id: string; name: string; emails: string[] }

export const emailRecipientsApi = {
  syncUsedToPool: async (): Promise<{ ok: boolean; discovered: number; inserted: number }> => {
    const response = await api.post<{ ok: boolean; discovered: number; inserted: number }>(
      '/api/v1/email-recipients/pool/sync-used'
    )
    return response.data
  },
  getRegistered: async (): Promise<string[]> => {
    const response = await api.get<{ emails: string[] }>('/api/v1/email-recipients/registered')
    return response.data.emails
  },
  getPool: async (): Promise<EmailPoolEntry[]> => {
    const response = await api.get<EmailPoolEntry[]>('/api/v1/email-recipients/pool')
    return response.data
  },
  addToPool: async (email: string, display_name?: string): Promise<EmailPoolEntry> => {
    const response = await api.post<EmailPoolEntry>('/api/v1/email-recipients/pool', { email, display_name })
    return response.data
  },
  updatePoolEntry: async (entryId: string, display_name?: string): Promise<EmailPoolEntry> => {
    const response = await api.patch<EmailPoolEntry>(`/api/v1/email-recipients/pool/${entryId}`, { display_name })
    return response.data
  },
  deletePoolEntry: async (entryId: string): Promise<void> => {
    await api.delete(`/api/v1/email-recipients/pool/${entryId}`)
  },
  getLists: async (): Promise<EmailSavedList[]> => {
    const response = await api.get<EmailSavedList[]>('/api/v1/email-recipients/lists')
    return response.data
  },
  createList: async (name: string, emails: string[]): Promise<EmailSavedList> => {
    const response = await api.post<EmailSavedList>('/api/v1/email-recipients/lists', { name, emails })
    return response.data
  },
  deleteList: async (listId: string): Promise<void> => {
    await api.delete(`/api/v1/email-recipients/lists/${listId}`)
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
    const response = await api.get<ComprehensiveReportRow[]>(`/api/v1/reports/${jobId}`)
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
  listCategories: async () => {
    const response = await api.get<{ categories: string[] }>('/api/v1/upcs/categories')
    return response.data
  },

  addUPCs: async (upcs: string[], category: string = 'dnk') => {
    const upcsArray = Array.isArray(upcs) ? upcs : [upcs]
    const requestBody = { upcs: upcsArray, category }

    // Temporary debug logging
    console.log('addUPCs called with:', { upcs: upcsArray.length, category })
    console.log('Request body:', JSON.stringify(requestBody))

    try {
      const response = await api.post('/api/v1/upcs', requestBody)
      console.log('addUPCs success:', response.data)
      return response.data
    } catch (error: any) {
      console.error('addUPCs error:', error.response?.data)
      throw error
    }
  },
  
  listUPCs: async (limit: number = 100, offset: number = 0, category?: string, search?: string) => {
    const params: Record<string, string | number> = { limit, offset }
    if (category) params.category = category
    if (search && search.trim()) params.search = search.trim()
    const response = await api.get<UPC[]>('/api/v1/upcs', { params })
    return response.data
  },
  
  getUPCCount: async (category?: string, search?: string) => {
    const params: Record<string, string> = {}
    if (category) params.category = category
    if (search && search.trim()) params.search = search.trim()
    const response = await api.get<{ count: number }>('/api/v1/upcs/count', { params })
    return response.data
  },
  
  deleteUPC: async (upc: string, category?: string) => {
    const categoryParam = category ? `?category=${category}` : ''
    const response = await api.delete(`/api/v1/upcs/${upc}${categoryParam}`)
    return response.data
  },
  
  deleteAllUPCs: async (category?: string) => {
    const categoryParam = category ? `?category=${category}` : ''
    const response = await api.delete(`/api/v1/upcs${categoryParam}`)
    return response.data
  },
}

// MAP API
export const mapApi = {
  listVendors: async () => {
    const response = await api.get<{ vendors: string[] }>('/api/v1/map/vendors')
    return response.data
  },

  checkMAPDuplicates: async (
    maps: Array<{ upc: string; map_price: number; vendor_type: MapVendorType }>
  ) => {
    const response = await api.post('/api/v1/map/check-duplicates', maps)
    return response.data
  },

  addMAPs: async (
    maps: Array<{ upc: string; map_price: number; vendor_type: MapVendorType }>,
    replaceDuplicates: boolean = false
  ) => {
    const response = await api.post(`/api/v1/map?replace_duplicates=${replaceDuplicates}`, maps)
    return response.data
  },

  listMAPs: async (
    limit: number = 100,
    offset: number = 0,
    search?: string,
    vendorType?: MapVendorType
  ) => {
    const params = new URLSearchParams()
    params.append('limit', limit.toString())
    params.append('offset', offset.toString())
    if (search && search.trim()) {
      params.append('search', search.trim())
    }
    if (vendorType) {
      params.append('vendor_type', vendorType)
    }
    const response = await api.get<MAP[]>(`/api/v1/map?${params.toString()}`)
    return response.data
  },

  getMAPCount: async (search?: string, vendorType?: MapVendorType) => {
    const params = new URLSearchParams()
    if (search && search.trim()) {
      params.append('search', search.trim())
    }
    if (vendorType) {
      params.append('vendor_type', vendorType)
    }
    const response = await api.get<{ count: number }>(`/api/v1/map/count?${params.toString()}`)
    return response.data
  },

  getMAPByUPC: async (upc: string, vendorType: MapVendorType = 'dnk') => {
    const params = new URLSearchParams()
    params.append('vendor_type', vendorType)
    const response = await api.get<MAP>(`/api/v1/map/${encodeURIComponent(upc)}?${params.toString()}`)
    return response.data
  },

  deleteMAP: async (upc: string, vendorType: MapVendorType) => {
    const params = new URLSearchParams()
    params.append('vendor_type', vendorType)
    const response = await api.delete(`/api/v1/map/${encodeURIComponent(upc)}?${params.toString()}`)
    return response.data
  },

  deleteAllMAPs: async (vendorType?: MapVendorType) => {
    const params = new URLSearchParams()
    if (vendorType) {
      params.append('vendor_type', vendorType)
    }
    const qs = params.toString()
    const response = await api.delete(`/api/v1/map${qs ? `?${qs}` : ''}`)
    return response.data
  },

  /** Delete all MAP rows for each UPC (DNK and CLK rows removed). */
  deleteMAPsByUpcs: async (upcs: string[]) => {
    const response = await api.post<{
      deleted_rows: number
      upcs_requested: number
      upcs_not_found: string[]
    }>('/api/v1/map/delete-by-upcs', { upcs })
    return response.data
  },
}

// Seller name mappings (Keepa seller ID → display name), stored in `seller_names`
export const sellersApi = {
  list: async () => {
    const response = await api.get<{ sellers: SellerName[]; total: number }>('/api/v1/sellers')
    return response.data
  },
  add: async (seller_id: string, seller_name: string) => {
    const response = await api.post('/api/v1/sellers', { seller_id, seller_name })
    return response.data
  },
  bulkUpsert: async (sellers: Array<{ seller_id: string; seller_name: string }>) => {
    const response = await api.post<{ message: string; count: number }>('/api/v1/sellers/bulk', { sellers })
    return response.data
  },
  update: async (seller_id: string, seller_name: string) => {
    const response = await api.put(`/api/v1/sellers/${encodeURIComponent(seller_id)}`, { seller_name })
    return response.data
  },
  delete: async (seller_id: string) => {
    const response = await api.delete(`/api/v1/sellers/${encodeURIComponent(seller_id)}`)
    return response.data
  },
  bulkDelete: async (seller_ids: string[]) => {
    const response = await api.post<{ message: string; count: number }>('/api/v1/sellers/bulk-delete', {
      seller_ids,
    })
    return response.data
  },
}

// Scheduler API
export const schedulerApi = {
  getNextRun: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' = 'dnk') => {
    const response = await api.get<SchedulerStatus>(`/api/v1/scheduler/next-run?category=${category}`)
    return response.data
  },
  getSettings: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' = 'dnk') => {
    const response = await api.get<SchedulerSettings>(`/api/v1/scheduler/settings?category=${category}`)
    return response.data
  },
  updateSettings: async (
    settings: {
      timezone?: string
      hour?: number
      minute?: number
      enabled?: boolean
      run_mode?: 'daily' | 'every_other_day' | 'custom_days'
      custom_days?: string[]
      anchor_date?: string | null
      email_recipients?: string | null
      input_mode?: 'api' | 'uploaded'
    },
    category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' = 'dnk'
  ) => {
    const response = await api.put<SchedulerSettings & { message: string }>(`/api/v1/scheduler/settings?category=${category}`, settings)
    return response.data
  },
  getCalendar: async () => {
    const response = await api.get<{
      generated_at: string
      vendors: Array<{
        category: string
        enabled: boolean
        timezone: string
        hour: number
        minute: number
        run_mode: 'daily' | 'every_other_day' | 'custom_days' | string
        custom_days: string[]
        anchor_date?: string | null
        scheduled_time: string
        next_run_time: string | null
        scheduler_job_present: boolean
        latest_job?: {
          id: string
          job_name: string
          status: string
          created_at: string
          completed_at?: string | null
        } | null
        is_ongoing: boolean
      }>
      ongoing_runs: Array<{
        id: string
        job_name: string
        category: string
        status: string
        created_at: string
        completed_at?: string | null
      }>
    }>('/api/v1/scheduler/calendar')
    return response.data
  },
  uploadReport: async (file: File, category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha') => {
    const formData = new FormData()
    formData.append('file', file)
    // Let browser/axios set multipart boundary automatically.
    const response = await api.post(`/api/v1/scheduler/uploaded-report?category=${category}`, formData)
    return response.data as {
      message: string
      report_id: string
      category: string
      filename: string
      uploaded_for_date: string
      upc_count: number
      parse_status: 'pending' | 'processing' | 'completed' | 'failed'
    }
  },
  getLatestUploadedReport: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha') => {
    const response = await api.get(`/api/v1/scheduler/uploaded-report/latest?category=${category}`)
    return response.data as {
      report: null | {
        id: string
        category: string
        filename: string
        uploaded_for_date: string
        upc_count: number
        row_count?: number
        parse_status?: 'pending' | 'processing' | 'completed' | 'failed'
        parse_error?: string | null
        parsed_at?: string | null
        created_at: string
      }
    }
  },
  getLatestUploadedReportStatus: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha') => {
    const response = await api.get(`/api/v1/scheduler/uploaded-report/status?category=${category}`)
    return response.data as {
      report: null | {
        id: string
        parse_status?: 'pending' | 'processing' | 'completed' | 'failed'
        parse_error?: string | null
        upc_count?: number
        row_count?: number
        parsed_at?: string | null
        created_at: string
      }
    }
  },
  deleteUploadedReport: async (
    reportId: string,
    category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha'
  ) => {
    const response = await api.delete(`/api/v1/scheduler/uploaded-report/${reportId}?category=${category}`)
    return response.data as { message: string; id: string; category: string }
  },
  rerunUploadedReport: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha') => {
    const response = await api.post(`/api/v1/scheduler/uploaded-report/rerun?category=${category}`)
    return response.data as { message: string }
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
    description: string
    url?: string
    video_url?: string
    developer: string
    category: string
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

export const notificationsApi = {
  getCatalog: async (): Promise<{
    items: Array<{
      type: string
      priority: 'critical' | 'warning' | 'info' | string
      title_template: string
      message_template: string
    }>
  }> => {
    const response = await api.get(`/api/v1/notifications/catalog`)
    return response.data
  },

  getNotifications: async (unreadOnly: boolean = false, limit: number = 50): Promise<Notification[]> => {
    const response = await api.get(`/api/v1/notifications`, {
      params: { unread_only: unreadOnly, limit }
    })
    return response.data
  },
  
  getUnreadCount: async (): Promise<number> => {
    const response = await api.get(`/api/v1/notifications/unread-count`)
    return response.data.count
  },
  
  markAsRead: async (notificationId: string): Promise<Notification> => {
    const response = await api.put(`/api/v1/notifications/${notificationId}/read`)
    return response.data
  },
  
  markAllAsRead: async (): Promise<void> => {
    await api.put(`/api/v1/notifications/read-all`)
  },
  
  deleteNotification: async (notificationId: string): Promise<void> => {
    await api.delete(`/api/v1/notifications/${notificationId}`)
  },
}

export default api

