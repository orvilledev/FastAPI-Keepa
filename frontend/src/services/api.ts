import axios from 'axios'
import { supabase } from '../lib/supabase'
import { isMfaAuthRoute, redirectForIncompleteMfa } from '../lib/mfa'
import type {
  MapVendorType, BatchJob, JobStatus, PriceAlert, UPC, MAP, SchedulerStatus, SchedulerSettings, PublicTool, QuickAccessLink, DashboardWidget, UserTool, MicroToolRecord, JobAid, Notification, ComprehensiveReportRow, SellerName, CliChatSession, CliChatMessage, TrackingHistorySummary, TrackingHistoryDetail, TrackingScannerRow,
  WarehouseProductLookup, WarehouseProductImportResult, WarehouseProduct } from '../types'

/** All request paths begin with `/api/v1`. Strip a mistaken `/api/v1` suffix from env to avoid doubled paths (404 Not Found). */
function normalizeApiBaseUrl(raw: string): string {
  let base = raw.trim().replace(/\/+$/, '')
  const lower = base.toLowerCase()
  const suffix = '/api/v1'
  if (lower.endsWith(suffix)) {
    base = base.slice(0, base.length - suffix.length).replace(/\/+$/, '')
  }
  return base || 'http://localhost:8000'
}

const API_URL = normalizeApiBaseUrl(
  typeof import.meta.env.VITE_API_URL === 'string' && import.meta.env.VITE_API_URL.length > 0
    ? import.meta.env.VITE_API_URL
    : 'http://localhost:8000'
)

/** API origin baked in at build time (for error messages). */
export function getApiBaseUrl(): string {
  return API_URL
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return
  if (window.location.protocol === 'file:') {
    window.location.hash = '#/login'
  } else {
    window.location.href = '/login'
  }
}

const api = axios.create({
  baseURL: API_URL,
  timeout: 25_000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Cache for auth token to avoid repeated getSession calls
let cachedToken: string | null = null
let tokenExpiresAt: number = 0

/** Force the next API request to read a fresh Supabase session (e.g. after MFA step-up). */
export function invalidateAuthTokenCache() {
  cachedToken = null
  tokenExpiresAt = 0
}

async function syncAuthTokenFromSession() {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    cachedToken = session.access_token
    tokenExpiresAt = (session.expires_at || 0) * 1000 - 5 * 60 * 1000
    return session.access_token
  }
  cachedToken = null
  tokenExpiresAt = 0
  return null
}

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
    await syncAuthTokenFromSession()
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
    const mfaRequired =
      error.response?.status === 401 &&
      typeof message === 'string' &&
      message.toLowerCase().includes('mfa verification required')

    if (mfaRequired) {
      // Do not refreshSession here — it cannot promote AAL1→AAL2 and may invalidate the login session.
      if (!isMfaAuthRoute()) {
        void redirectForIncompleteMfa()
      }
      return Promise.reject(error)
    }
    
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
          redirectToLogin()
          return Promise.reject(error)
        }
      } catch (refreshError) {
        // Failed to refresh, redirect to login
        console.error('Failed to refresh token:', refreshError)
        redirectToLogin()
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
  createUser: async (payload: {
    email: string
    password: string
    has_keepa_access?: boolean
    is_active?: boolean
  }) => {
    const response = await api.post<{
      user_id: string
      email: string
      is_active: boolean
      has_keepa_access: boolean
      message: string
    }>('/api/v1/auth/users', payload)
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
  getMaintenanceMode: async () => {
    const response = await api.get<{
      maintenance_mode: boolean
      message: string
      effective_message: string
      duration_hours?: number | null
      expected_end_at?: string | null
    }>('/api/v1/auth/maintenance')
    return response.data
  },
  updateMaintenanceMode: async (maintenance_mode: boolean, message?: string, duration_hours?: number) => {
    const response = await api.put<{
      maintenance_mode: boolean
      message: string
      effective_message: string
      duration_hours?: number | null
      expected_end_at?: string | null
    }>('/api/v1/auth/maintenance', { maintenance_mode, message, duration_hours })
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
  confirmMfaEnrollment: async () => {
    const response = await api.post<{ message: string; mfa_enabled: boolean }>(
      '/api/v1/auth/mfa/confirm-enrollment'
    )
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
  
  listJobs: async (
    limit: number = 20,
    offset: number = 0,
    options?: { includeEnrichment?: boolean }
  ) => {
    const includeEnrichment = options?.includeEnrichment ?? true
    const response = await api.get<BatchJob[]>('/api/v1/jobs', {
      params: { limit, offset, include_enrichment: includeEnrichment }
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

  deleteCompletedJobs: async () => {
    const response = await api.delete<{ message: string; deleted_count: number }>(
      '/api/v1/jobs/completed'
    )
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
  updatePoolEntry: async (
    entryId: string,
    updates: { display_name?: string }
  ): Promise<EmailPoolEntry> => {
    const response = await api.patch<EmailPoolEntry>(`/api/v1/email-recipients/pool/${entryId}`, updates)
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

// Keepa Import Export tool API (standalone)
export type KeepaImportBuildStatus = {
  build_id: string
  category: string
  status: 'building' | 'complete' | 'failed' | 'cancelled'
  phase: string
  completed: number
  total: number
  progress_percent: number
  message: string
  error?: string | null
  filename?: string | null
}

export type KeepaImportBuildHistoryItem = {
  id: string
  user_id: string
  created_by_name?: string | null
  category: string
  status: 'building' | 'complete' | 'failed' | 'cancelled'
  upc_count: number
  completed_upcs: number
  progress_percent: number
  phase?: string | null
  message?: string | null
  error?: string | null
  filename?: string | null
  created_at: string
  updated_at?: string | null
  completed_at?: string | null
}

export type KeepaImportBuildContentRow = {
  upc: string
  title?: string | null
  buy_box_seller?: string | null
  buy_box_price?: string | null
  asin?: string | null
  amazon_url?: string | null
}

export type KeepaImportBuildContentsResponse = {
  build_id: string
  filename?: string | null
  category: string
  total: number
  offset: number
  limit: number
  rows: KeepaImportBuildContentRow[]
}

export type KeepaImportGlobalBusyStatus = {
  busy: boolean
  build_id?: string | null
  category?: string | null
  created_by_name?: string | null
  progress_percent?: number | null
  message?: string | null
}

export type KeepaImportSchedulerSettings = {
  timezone: string
  hour: number
  minute: number
  enabled: boolean
  run_mode: 'daily' | 'every_other_day' | 'custom_days'
  custom_days: string[]
  anchor_date?: string | null
  email_recipients?: string | null
  email_bcc_recipients?: string | null
  off_price_enabled?: boolean
  off_price_timezone?: string
  off_price_hour?: number
  off_price_minute?: number
  off_price_run_mode?: 'daily' | 'every_other_day' | 'custom_days'
  off_price_custom_days?: string[]
  off_price_anchor_date?: string | null
  off_price_email_recipients?: string | null
  off_price_email_bcc_recipients?: string | null
  off_price_send_after_build?: boolean
  category: string
}

export type KeepaImportSchedulerStatus = {
  next_run_time: string | null
  next_run_time_local: string | null
  scheduled_time: string
  timezone: string
  run_mode: string
  custom_days: string[]
  enabled: boolean
  message?: string
  seconds_until: number | null
  is_running: boolean
}

export const keepaImportExportApi = {
  getCount: async (category: string) => {
    const response = await api.get<{ category: string; upc_count: number }>(
      `/api/v1/keepa-import-export/${category}/count`
    )
    return response.data
  },

  startBuild: async (category: string, includeHeader: boolean = true) => {
    const response = await api.post<{
      build_id: string
      upc_count: number
      category: string
    }>(`/api/v1/keepa-import-export/${category}/build`, null, {
      params: { include_header: includeHeader },
    })
    return response.data
  },

  getBuildStatus: async (buildId: string) => {
    const response = await api.get<KeepaImportBuildStatus>(
      `/api/v1/keepa-import-export/builds/${buildId}/status`
    )
    return response.data
  },

  getActiveBuild: async () => {
    const response = await api.get<{ build: KeepaImportBuildStatus | null }>(
      '/api/v1/keepa-import-export/builds/active'
    )
    return response.data.build
  },

  cancelBuild: async (buildId: string) => {
    const response = await api.post<{
      build_id: string
      status: string
      cancelled: boolean
    }>(`/api/v1/keepa-import-export/builds/${buildId}/cancel`)
    return response.data
  },

  downloadBuild: async (buildId: string) => {
    const response = await api.get(
      `/api/v1/keepa-import-export/builds/${buildId}/download`,
      {
        responseType: 'blob',
        timeout: 5 * 60 * 1000,
      }
    )
    return response
  },

  listBuildHistory: async () => {
    const response = await api.get<KeepaImportBuildHistoryItem[]>(
      '/api/v1/keepa-import-export/builds/history'
    )
    return response.data
  },

  getGlobalBuildBusy: async () => {
    const response = await api.get<KeepaImportGlobalBusyStatus>(
      '/api/v1/keepa-import-export/builds/busy'
    )
    return response.data
  },

  downloadBuildHistory: async (buildId: string) => {
    const response = await api.get(
      `/api/v1/keepa-import-export/builds/history/${buildId}/download`,
      {
        responseType: 'blob',
        timeout: 5 * 60 * 1000,
      }
    )
    return response
  },

  deleteBuildHistory: async (buildId: string) => {
    await api.delete(`/api/v1/keepa-import-export/builds/history/${buildId}`)
  },

  clearBuildHistory: async () => {
    await api.delete('/api/v1/keepa-import-export/builds/history/all')
  },

  getBuildHistoryContents: async (
    buildId: string,
    params?: { offset?: number; limit?: number }
  ) => {
    const search = new URLSearchParams()
    if (params?.offset != null) search.set('offset', String(params.offset))
    if (params?.limit != null) search.set('limit', String(params.limit))
    const qs = search.toString()
    const response = await api.get<KeepaImportBuildContentsResponse>(
      `/api/v1/keepa-import-export/builds/history/${buildId}/contents${qs ? `?${qs}` : ''}`
    )
    return response.data
  },

  download: async (category: string, includeHeader: boolean = true) => {
    // Building the file calls Keepa once per UPC, so large vendor lists can take
    // several minutes. Override the 25s default with a generous 15-minute timeout
    // so the browser does not cancel a still-running build.
    const response = await api.get(
      `/api/v1/keepa-import-export/${category}/download`,
      {
        params: { include_header: includeHeader },
        responseType: 'blob',
        timeout: 15 * 60 * 1000,
      }
    )
    return response
  },

  getSettings: async () => {
    const response = await api.get<{ enabled: boolean }>(
      '/api/v1/keepa-import-export/settings'
    )
    return response.data
  },

  updateSettings: async (enabled: boolean) => {
    const response = await api.put<{ enabled: boolean }>(
      '/api/v1/keepa-import-export/settings',
      { enabled }
    )
    return response.data
  },

  getSchedulerSettings: async (category: string) => {
    const response = await api.get<KeepaImportSchedulerSettings>(
      `/api/v1/keepa-import-export/scheduler/settings?category=${category}`
    )
    return response.data
  },

  updateSchedulerSettings: async (
    category: string,
    settings: Partial<KeepaImportSchedulerSettings>
  ) => {
    const response = await api.put<KeepaImportSchedulerSettings & { message: string }>(
      `/api/v1/keepa-import-export/scheduler/settings?category=${category}`,
      settings
    )
    return response.data
  },

  getSchedulerNextRun: async (category: string) => {
    const response = await api.get<KeepaImportSchedulerStatus>(
      `/api/v1/keepa-import-export/scheduler/next-run?category=${category}`
    )
    return response.data
  },

  getOffPriceSchedulerNextRun: async (category: string) => {
    const response = await api.get<KeepaImportSchedulerStatus>(
      `/api/v1/keepa-import-export/scheduler/off-price/next-run?category=${category}`
    )
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
  getNextRun: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha') => {
    const response = await api.get<SchedulerStatus>(`/api/v1/scheduler/next-run?category=${category}`)
    return response.data
  },
  getSettings: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha') => {
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
      email_bcc_recipients?: string | null
      input_mode?: 'api' | 'uploaded'
      uploaded_wait_timeout_seconds?: number
      email_subject_template?: string | null
      email_body_template?: string | null
    },
    category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha'
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
        input_mode?: 'api' | 'uploaded'
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
  getMicroTools: async () => {
    const response = await api.get<MicroToolRecord[]>('/api/v1/tools/micro-tools')
    return response.data
  },
  createMicroTool: async (toolData: {
    name: string
    description?: string
    url: string
    action_label?: string
    tags?: string[]
    extra_links?: { label: string; url: string }[]
  }) => {
    const response = await api.post<MicroToolRecord>('/api/v1/tools/micro-tools', toolData)
    return response.data
  },
  updateMicroTool: async (
    toolId: string,
    toolData: {
      name?: string
      description?: string
      url?: string
      action_label?: string
      tags?: string[]
      extra_links?: { label: string; url: string }[]
    }
  ) => {
    const response = await api.put<MicroToolRecord>(`/api/v1/tools/micro-tools/${toolId}`, toolData)
    return response.data
  },
  deleteMicroTool: async (toolId: string) => {
    const response = await api.delete(`/api/v1/tools/micro-tools/${toolId}`)
    return response.data
  },
  downloadMicroToolFile: async (toolId: string) => {
    const response = await api.get(`/api/v1/tools/micro-tools/${toolId}/download`, {
      responseType: 'blob',
    })
    return response
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

/** Dev-only weekly/monthly/yearly off-price counts from daily runs (all vendors). */
export interface OffPriceAnalyticsVendor {
  code: string
  name: string
  off_price_count: number
  run_count: number
  scheduler_enabled: boolean
  sellers?: Array<{ seller_name: string; hits: number }>
}

export interface OffPriceAnalyticsResponse {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly'
  period_key: string
  period_label: string
  offset?: number
  start: string
  end: string
  total_off_price_count: number
  total_run_count: number
  distinct_sellers?: number
  vendors_with_hits?: number
  vendors: OffPriceAnalyticsVendor[]
  archived?: boolean
  source?: string
}

export interface OffPriceAnalyticsArchiveMeta {
  id: string
  period_type: 'daily' | 'weekly' | 'monthly' | 'yearly'
  period_key: string
  period_label: string
  period_start: string
  period_end: string
  total_off_price_count: number
  total_run_count: number
  distinct_sellers: number
  vendors_with_hits: number
  source: string
  created_at: string
  updated_at: string
}

export const analyticsApi = {
  getOffPrice: async (params: {
    period: 'daily' | 'weekly' | 'monthly' | 'yearly'
    offset?: number
    persist?: boolean
  }) => {
    const response = await api.get<OffPriceAnalyticsResponse>('/api/v1/analytics/off-price', {
      params: {
        period: params.period,
        offset: params.offset ?? 0,
        persist: params.persist ?? true,
      },
    })
    return response.data
  },

  listArchives: async (params?: {
    period_type?: 'daily' | 'weekly' | 'monthly' | 'yearly'
    limit?: number
  }) => {
    const response = await api.get<{ archives: OffPriceAnalyticsArchiveMeta[]; available: boolean }>(
      '/api/v1/analytics/off-price/archives',
      { params },
    )
    return response.data
  },

  getArchive: async (periodType: string, periodKey: string) => {
    const response = await api.get<OffPriceAnalyticsResponse>(
      `/api/v1/analytics/off-price/archives/${periodType}/${periodKey}`,
    )
    return response.data
  },

  seedDemoHistory: async () => {
    const response = await api.post<{ seeded: string[]; count: number }>(
      '/api/v1/analytics/off-price/seed-demo-history',
    )
    return response.data
  },

  listTracking: async () => {
    const response = await api.get<{
      vendors: Array<{
        vendor_code: string
        vendor_name: string
        tracking_enabled: boolean
        updated_at?: string | null
        updated_by?: string | null
      }>
    }>('/api/v1/analytics/off-price/tracking')
    return response.data
  },

  setTracking: async (vendorCode: string, enabled: boolean) => {
    const response = await api.put<{
      vendor_code: string
      vendor_name: string
      tracking_enabled: boolean
      updated_at?: string | null
      user_id?: string
    }>(`/api/v1/analytics/off-price/tracking/${vendorCode}`, null, {
      params: { enabled },
    })
    return response.data
  },

  listDownloadLogs: async (limit = 50) => {
    const response = await api.get<{
      logs: Array<{
        id: string | null
        user_id: string | null
        user_display_name: string | null
        user_email: string | null
        vendor_codes: string[]
        vendor_scope: 'all' | 'selected'
        vendor_label: string
        filename: string | null
        period: string | null
        downloaded_at: string
      }>
      available: boolean
    }>('/api/v1/analytics/off-price/download-logs', { params: { limit } })
    return response.data
  },

  recordDownloadLog: async (body: {
    vendor_codes: string[]
    filename?: string
    period?: string
  }) => {
    const response = await api.post('/api/v1/analytics/off-price/download-logs', body)
    return response.data
  },

  emailReport: async (body: {
    file: Blob
    filename: string
    email_recipients: string
    email_bcc_recipients?: string
    vendor_codes: string[]
    period?: string
  }) => {
    const form = new FormData()
    form.append('file', body.file, body.filename)
    form.append('filename', body.filename)
    form.append('email_recipients', body.email_recipients || '')
    form.append('email_bcc_recipients', body.email_bcc_recipients || '')
    form.append('vendor_codes', body.vendor_codes.join(','))
    form.append('period', body.period || '')
    const response = await api.post<{
      sent: boolean
      filename: string
      to_count: number
      bcc_count: number
      vendor_codes: string[]
    }>('/api/v1/analytics/off-price/email-report', form)
    return response.data
  },
}

export interface FeedbackItem {
  user_id: string
  id: string
  company: string
  first_name: string
  last_name: string
  submitted_name: string
  position: string
  signature: string
  message: string | null
  created_at: string
}

export const feedbackApi = {
  listMine: async (): Promise<FeedbackItem[]> => {
    const response = await api.get<FeedbackItem[]>('/api/v1/feedback/me')
    return response.data
  },

  listAllForAdmin: async (): Promise<FeedbackItem[]> => {
    const response = await api.get<FeedbackItem[]>('/api/v1/feedback/all')
    return response.data
  },

  delete: async (feedbackId: string): Promise<void> => {
    await api.delete(`/api/v1/feedback/${feedbackId}`)
  },

  patch: async (
    feedbackId: string,
    body: {
      first_name: string
      last_name: string
      position: string
      signature: string
      message?: string
    },
  ) => {
    const response = await api.patch<FeedbackItem>(`/api/v1/feedback/${feedbackId}`, body)
    return response.data
  },

  submit: async (body: {
    first_name: string
    last_name: string
    position: string
    signature: string
    message?: string
  }) => {
    const response = await api.post<FeedbackItem>('/api/v1/feedback', body)
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
  
  clearNotifications: async (): Promise<void> => {
    await api.delete(`/api/v1/notifications`)
  },
}

export const cliChatApi = {
  sendTurn: async (
    message: string,
    sessionId?: string | null
  ): Promise<{ session_id: string; reply: string }> => {
    const body: { message: string; session_id?: string } = { message }
    if (sessionId) body.session_id = sessionId
    const response = await api.post('/api/v1/cli-chat/turn', body)
    return response.data
  },

  listSessions: async (): Promise<CliChatSession[]> => {
    const response = await api.get<{ sessions: CliChatSession[] }>('/api/v1/cli-chat/sessions')
    return response.data.sessions ?? []
  },

  getHistory: async (sessionId: string): Promise<CliChatMessage[]> => {
    const response = await api.get<{ messages: CliChatMessage[] }>(
      `/api/v1/cli-chat/sessions/${sessionId}/messages`
    )
    return response.data.messages ?? []
  },
}

export const trackingScannerApi = {
  listHistory: async (): Promise<TrackingHistorySummary[]> => {
    const response = await api.get<TrackingHistorySummary[]>('/api/v1/tracking-scanner/history')
    return response.data
  },
  getHistory: async (historyId: string): Promise<TrackingHistoryDetail> => {
    const response = await api.get<TrackingHistoryDetail>(`/api/v1/tracking-scanner/history/${historyId}`)
    return response.data
  },
  saveHistory: async (payload: {
    name?: string
    source_count: number
    file_count: number
    pair_count: number
    matched_count: number
    needs_review_count: number
    rows: TrackingScannerRow[]
  }): Promise<TrackingHistorySummary> => {
    const response = await api.post<TrackingHistorySummary>('/api/v1/tracking-scanner/history', payload)
    return response.data
  },
  deleteHistory: async (historyId: string): Promise<void> => {
    await api.delete(`/api/v1/tracking-scanner/history/${historyId}`)
  },
  clearAllHistory: async (): Promise<void> => {
    await api.delete('/api/v1/tracking-scanner/history/all')
  },
}

export const warehouseProductsApi = {
  lookup: async (upc: string): Promise<WarehouseProductLookup> => {
    const response = await api.get<WarehouseProductLookup>('/api/v1/warehouse-products/lookup', {
      params: { upc: upc.trim() },
    })
    return response.data
  },
  getCount: async (): Promise<{ count: number }> => {
    const response = await api.get<{ count: number }>('/api/v1/warehouse-products/count')
    return response.data
  },
  list: async (
    limit = 50,
    offset = 0,
    search?: string
  ): Promise<{ items: WarehouseProduct[]; total: number; limit: number; offset: number }> => {
    const response = await api.get('/api/v1/warehouse-products', {
      params: { limit, offset, search: search || undefined },
    })
    return response.data
  },
  importFile: async (file: File): Promise<WarehouseProductImportResult> => {
    const form = new FormData()
    form.append('file', file)
    const response = await api.post<WarehouseProductImportResult>(
      '/api/v1/warehouse-products/import',
      form,
      { timeout: 120_000 }
    )
    return response.data
  },
  delete: async (upc: string): Promise<void> => {
    await api.delete(`/api/v1/warehouse-products/${encodeURIComponent(upc.trim())}`)
  },
}

export const systemApi = {
  getMaintenanceStatus: async (): Promise<{
    maintenance_mode: boolean
    message: string
    effective_message?: string
    duration_hours?: number | null
    expected_end_at?: string | null
  }> => {
    const response = await api.get('/api/v1/system/maintenance-status')
    return response.data
  },
}

export default api

