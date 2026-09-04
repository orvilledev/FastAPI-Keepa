import axios from 'axios'
import { supabase } from '../lib/supabase'
import { isMfaAuthRoute, redirectForIncompleteMfa } from '../lib/mfa'
import { isElectronDesktop } from '../lib/privatePath'
import type {
  MapVendorType, BatchJob, JobStatus, PriceAlert, UPC, MAP, SchedulerStatus, SchedulerSettings, PublicTool, QuickAccessLink, DashboardWidget, UserTool, MicroToolRecord, JobAid, Notification, ComprehensiveReportRow, SellerName, CliChatSession, CliChatMessage, TrackingHistorySummary, TrackingHistoryDetail, TrackingScannerRow,
  ManualEmailDraft,
  ManualEmailDraftOpenResult,
  WarehouseProductLookup, WarehouseProductImportResult, WarehouseProduct,
  CatalogImportResult, CatalogUpcListResponse, CatalogDimsListResponse } from '../types'

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

export interface AuditLogEntry {
  id: string | null
  action: string
  category: string
  label: string | null
  user_id: string | null
  user_display_name: string | null
  user_email: string | null
  client_type: string
  ip_address: string | null
  method: string | null
  path: string | null
  status_code: number | null
  detail: string | null
  metadata: Record<string, unknown>
  created_at: string | null
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

  // Distinguish web vs Electron for presence and audit.
  if (config.headers) {
    config.headers['X-Client-Type'] = isElectronDesktop() ? 'electron' : 'web'
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
  getEmailTransport: async () => {
    const response = await api.get<{
      transport: 'auto' | 'graph' | 'smtp'
      effective_transport: 'graph' | 'smtp'
      env_transport: 'auto' | 'graph' | 'smtp'
      smtp_configured: boolean
      graph_configured: boolean
      email_from: string
      smtp_host: string
    }>('/api/v1/auth/email-transport')
    return response.data
  },
  updateEmailTransport: async (transport: 'auto' | 'graph' | 'smtp') => {
    const response = await api.put<{
      transport: 'auto' | 'graph' | 'smtp'
      effective_transport: 'graph' | 'smtp'
      env_transport: 'auto' | 'graph' | 'smtp'
      smtp_configured: boolean
      graph_configured: boolean
      email_from: string
      smtp_host: string
    }>('/api/v1/auth/email-transport', { transport })
    return response.data
  },
  getUpcDnkPrintIdAllowlist: async () => {
    const response = await api.get<{ emails: string[] }>('/api/v1/auth/upc-dnk-print-id-allowlist')
    return response.data
  },
  getUpcDnkPrintIdAccess: async () => {
    const response = await api.get<{ allowed: boolean }>('/api/v1/auth/upc-dnk-print-id-access')
    return response.data
  },
  updateUpcDnkPrintIdAllowlist: async (emails: string[]) => {
    const response = await api.put<{ emails: string[] }>(
      '/api/v1/auth/upc-dnk-print-id-allowlist',
      { emails },
    )
    return response.data
  },
  presenceHeartbeat: async (payload: {
    session_id: string
    client_type: 'web' | 'electron'
    is_active: boolean
    path?: string
  }) => {
    const response = await api.post<{ ok: boolean; session_id: string; status: string }>(
      '/api/v1/auth/presence/heartbeat',
      payload,
    )
    return response.data
  },
  presenceLeave: async (session_id: string) => {
    const response = await api.post<{ ok: boolean; deleted: boolean }>(
      '/api/v1/auth/presence/leave',
      { session_id },
    )
    return response.data
  },
  getPresenceSessions: async () => {
    const response = await api.get<{
      as_of: string
      online_total: number
      web_count: number
      electron_count: number
      active_count: number
      idle_count: number
      online_grace_seconds: number
      active_seconds: number
      sessions: Array<{
        session_id: string
        user_id: string
        email: string | null
        display_name: string | null
        client_type: 'web' | 'electron' | string
        ip_address: string | null
        path: string | null
        status: 'active' | 'idle' | string
        last_heartbeat_at: string
        last_activity_at: string
        created_at: string
      }>
    }>('/api/v1/auth/presence/sessions')
    return response.data
  },
  recordAuditEvent: async (
    action: string,
    detail?: string,
    metadata?: Record<string, unknown>,
  ) => {
    const response = await api.post<{ ok: boolean; recorded: boolean }>(
      '/api/v1/audit/events',
      { action, detail, metadata },
    )
    return response.data
  },
  listAuditEvents: async (params?: {
    limit?: number
    action?: string
    category?: string
    search?: string
  }) => {
    const response = await api.get<{
      logs: AuditLogEntry[]
      available: boolean
      categories: string[]
      detail?: string
    }>('/api/v1/audit/events', {
      params: {
        limit: params?.limit ?? 200,
        ...(params?.action ? { action: params.action } : {}),
        ...(params?.category ? { category: params.category } : {}),
        ...(params?.search ? { search: params.search } : {}),
      },
    })
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
    upcs?: string[]
    use_managed_upcs?: boolean
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
      express_completed?: number
      failed: number
    }>('/api/v1/jobs/stats')
    return response.data
  },

  getKeepaTokenMeters: async () => {
    const response = await api.get<{
      pool_size: number
      keys: Array<{
        index: number
        label: string
        fingerprint: string
        ok: boolean
        tokens_left: number | null
        refill_rate: number | null
        refill_in_ms: number | null
        bucket_max: number | null
      }>
    }>('/api/v1/jobs/keepa-tokens')
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
export type EmailGroupMemberRole = 'to' | 'bcc'
export type EmailGroupMember = { email: string; role: EmailGroupMemberRole }
export type EmailSavedList = {
  id: string
  name: string
  members: EmailGroupMember[]
  emails: string[]
}

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
    return response.data.map(normalizeEmailGroup)
  },
  createList: async (name: string, members: EmailGroupMember[]): Promise<EmailSavedList> => {
    const response = await api.post<EmailSavedList>('/api/v1/email-recipients/lists', { name, members })
    return normalizeEmailGroup(response.data)
  },
  updateList: async (
    listId: string,
    updates: { name?: string; members?: EmailGroupMember[] }
  ): Promise<EmailSavedList> => {
    const response = await api.patch<EmailSavedList>(`/api/v1/email-recipients/lists/${listId}`, updates)
    return normalizeEmailGroup(response.data)
  },
  deleteList: async (listId: string): Promise<void> => {
    await api.delete(`/api/v1/email-recipients/lists/${listId}`)
  },
}

function normalizeEmailGroup(raw: EmailSavedList | (Omit<EmailSavedList, 'members'> & { members?: EmailGroupMember[] })): EmailSavedList {
  const members: EmailGroupMember[] = Array.isArray(raw.members)
    ? raw.members.map((m) => ({
        email: String(m.email || '').trim().toLowerCase(),
        role: m.role === 'bcc' ? 'bcc' : 'to',
      })).filter((m) => m.email)
    : (raw.emails || []).map((email) => ({ email: String(email).trim().toLowerCase(), role: 'to' as const }))
  return {
    id: raw.id,
    name: raw.name,
    members,
    emails: members.map((m) => m.email),
  }
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

  getEmailDraft: async (jobId: string) => {
    const response = await api.get<ManualEmailDraft>(`/api/v1/reports/${jobId}/email-draft`)
    return response.data
  },

  openEmailDraft: async (jobId: string) => {
    const response = await api.post<ManualEmailDraftOpenResult>(
      `/api/v1/reports/${jobId}/email-draft/open`
    )
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

  /** Download UPCs CSV. Pass categories for a subset; omit/empty for all vendors. */
  exportUPCs: async (categories?: string[]) => {
    const params: Record<string, string> = {}
    if (categories?.length) {
      params.categories = categories.join(',')
    }
    const response = await api.get('/api/v1/upcs/export', {
      params,
      responseType: 'blob',
      timeout: 5 * 60 * 1000,
    })
    return response
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

  /** Download MAP CSV. Pass vendorTypes for a subset; omit/empty for all vendors. */
  exportMAPs: async (vendorTypes?: string[]) => {
    const params: Record<string, string> = {}
    if (vendorTypes?.length) {
      params.vendor_types = vendorTypes.join(',')
    }
    const response = await api.get('/api/v1/map/export', {
      params,
      responseType: 'blob',
      timeout: 5 * 60 * 1000,
    })
    return response
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
  getNextRun: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' | 'jfs') => {
    const response = await api.get<SchedulerStatus>(`/api/v1/scheduler/next-run?category=${category}`)
    return response.data
  },
  getSettings: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' | 'jfs') => {
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
    category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' | 'jfs'
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
        same_day_run_at?: string | null
        same_day_run_at_local?: string | null
        same_day_seconds_until?: number | null
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
  uploadReport: async (file: File, category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' | 'jfs') => {
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
  getLatestUploadedReport: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' | 'jfs') => {
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
  getLatestUploadedReportStatus: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' | 'jfs') => {
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
    category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' | 'jfs'
  ) => {
    const response = await api.delete(`/api/v1/scheduler/uploaded-report/${reportId}?category=${category}`)
    return response.data as { message: string; id: string; category: string }
  },
  rerunUploadedReport: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' | 'jfs') => {
    const response = await api.post(`/api/v1/scheduler/uploaded-report/rerun?category=${category}`)
    return response.data as { message: string }
  },
  getSameDayRun: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' | 'jfs') => {
    const response = await api.get<{
      category: string
      pending: null | {
        category: string
        job_id: string
        run_at: string
        run_at_local: string
        timezone: string
        seconds_until: number
      }
    }>(`/api/v1/scheduler/same-day-run?category=${category}`)
    return response.data
  },
  scheduleSameDayRun: async (
    category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' | 'jfs',
    delay: { delay_hours: number; delay_minutes: number },
  ) => {
    const response = await api.post<{
      category: string
      job_id: string
      run_at: string
      run_at_local: string
      timezone: string
      seconds_until: number
      delay_hours: number
      delay_minutes: number
      message: string
    }>(`/api/v1/scheduler/same-day-run?category=${category}`, delay)
    return response.data
  },
  cancelSameDayRun: async (category: 'dnk' | 'clk' | 'obz' | 'ref' | 'bor' | 'sff' | 'tev' | 'cha' | 'jfs') => {
    const response = await api.delete<{ message: string; category: string; cancelled: boolean }>(
      `/api/v1/scheduler/same-day-run?category=${category}`,
    )
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

export interface OffPriceLiveBootstrapResponse {
  periods: Record<'daily' | 'weekly' | 'monthly' | 'yearly', OffPriceAnalyticsResponse>
  yearly_archives: OffPriceAnalyticsResponse[]
  monthly_archives: OffPriceAnalyticsArchiveMeta[]
  tracking_settings?: Array<{
    vendor_code: string
    vendor_name: string
    tracking_enabled: boolean
  }>
  hit_alerts?: Array<{
    vendor_code: string
    vendor_name: string
    today_hits: number
    yesterday_hits: number
    last_run_hits?: number
    last_run_period_key?: string | null
    last_run_label?: string | null
    delta: number
  }>
  hit_alert_threshold?: number
}

export interface DailyKeepaOffPriceListingRow {
  Vendor: string
  Job: string
  UPC: string
  ASIN: string
  'Product Title': string
  Brand: string
  'Off Price Listing': string
  MSRP: string
  'Current Amazon Price': string
  'Price Difference': string
  'Seller Offer Price': string
  Seller: string
  'Discount %': string
  'Amazon URL': string
}

export interface DailyKeepaOffPriceListings {
  day: string
  period_label: string
  has_daily_runs: boolean
  empty_message: string | null
  runs: Array<{
    vendor_code: string
    vendor_name: string
    job_id: string
    job_name?: string | null
    completed_at?: string | null
    row_count: number
    error?: string
  }>
  rows: DailyKeepaOffPriceListingRow[]
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
      timeout: 60_000,
    })
    return response.data
  },

  getLiveBootstrap: async () => {
    const response = await api.get<OffPriceLiveBootstrapResponse>(
      '/api/v1/analytics/off-price/live-bootstrap',
      { timeout: 30_000 },
    )
    return response.data
  },

  getDailyKeepaOffPriceListings: async (vendorCodes?: string[]) => {
    const response = await api.get<DailyKeepaOffPriceListings>(
      '/api/v1/analytics/off-price/daily-listings',
      {
        params: {
          vendor_codes: vendorCodes?.length ? vendorCodes.join(',') : undefined,
        },
        timeout: 90_000,
      },
    )
    return response.data
  },

  listArchives: async (params?: {
    period_type?: 'daily' | 'weekly' | 'monthly' | 'yearly'
    limit?: number
    exclude_demo?: boolean
  }) => {
    const response = await api.get<{ archives: OffPriceAnalyticsArchiveMeta[]; available: boolean }>(
      '/api/v1/analytics/off-price/archives',
      {
        params: {
          period_type: params?.period_type,
          limit: params?.limit,
          exclude_demo: params?.exclude_demo ?? true,
        },
      },
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

  deleteDemoSnapshots: async () => {
    const response = await api.delete<{ deleted: number; available: boolean; detail?: string }>(
      '/api/v1/analytics/off-price/demo-snapshots',
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

  runMismatchTest: async (offset = 0) => {
    const response = await api.post<OffPriceMismatchTestResult>(
      '/api/v1/analytics/off-price/mismatch-test',
      null,
      { params: { offset }, timeout: 90_000 },
    )
    return response.data
  },

  fixMismatch: async (offset = 0) => {
    const response = await api.post<OffPriceMismatchFixResult>(
      '/api/v1/analytics/off-price/mismatch-fix',
      null,
      { params: { offset }, timeout: 120_000 },
    )
    return response.data
  },
}

export interface OffPriceMismatchRow {
  vendor_code: string
  vendor_name: string
  actual_counted: number
  analytics_counted: number
  discrepancy: number
  run_count: number
}

export interface OffPriceMismatchTestResult {
  period: string
  period_key: string
  period_label: string
  offset: number
  start: string
  end: string
  has_mismatch: boolean
  analytics_source: string
  actual_total: number
  analytics_total: number
  actual_run_count: number
  analytics_run_count: number
  jobs_checked: number
  mismatches: OffPriceMismatchRow[]
  message: string
}

export interface OffPriceMismatchFixResult {
  fixed: boolean
  refreshed: string[]
  before: OffPriceMismatchTestResult
  after: OffPriceMismatchTestResult
  daily: {
    period_key?: string
    period_label?: string
    total_off_price_count?: number
    total_run_count?: number
  }
  message: string
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

export type ManifestGeneratorResult = {
  blob: Blob
  filename: string
  fileCount: number
  primaryVendor: string
  skuCount: number
  totalUnits: number
}

export const manifestGeneratorApi = {
  generate: async (file: File): Promise<ManifestGeneratorResult> => {
    const form = new FormData()
    form.append('file', file)
    try {
      const response = await api.post<Blob>('/api/v1/manifest-generator/generate', form, {
        responseType: 'blob',
        timeout: 120_000,
      })
      const headers = response.headers || {}
      const filenameHeader = headers['x-manifest-zip-filename']
      const disposition = headers['content-disposition'] as string | undefined
      let filename =
        (typeof filenameHeader === 'string' && filenameHeader.trim()) || 'FBA Manifests.zip'
      if ((!filenameHeader || !String(filenameHeader).trim()) && disposition) {
        const match = /filename="?([^";]+)"?/i.exec(disposition)
        if (match?.[1]) filename = match[1]
      }
      return {
        blob: response.data,
        filename,
        fileCount: Number(headers['x-manifest-file-count'] || 0),
        primaryVendor: String(headers['x-manifest-primary-vendor'] || ''),
        skuCount: Number(headers['x-manifest-sku-count'] || 0),
        totalUnits: Number(headers['x-manifest-total-units'] || 0),
      }
    } catch (err: unknown) {
      const ax = err as {
        response?: { data?: Blob | { detail?: string }; status?: number }
        message?: string
      }
      const data = ax.response?.data
      if (data instanceof Blob) {
        try {
          const text = await data.text()
          const parsed = JSON.parse(text) as { detail?: string }
          if (parsed?.detail) {
            throw Object.assign(new Error(parsed.detail), {
              response: { data: { detail: parsed.detail }, status: ax.response?.status },
            })
          }
        } catch (inner) {
          if (inner instanceof Error && (inner as { response?: unknown }).response) {
            throw inner
          }
        }
      }
      throw err
    }
  },
}

export type DnkAllInventoryResult = {
  blob: Blob
  filename: string
  rowCount: number
  poCount: number
  availableLines: number
  dateStamp: string
}

export const dnkAllInventoryApi = {
  generate: async (file: File): Promise<DnkAllInventoryResult> => {
    const form = new FormData()
    form.append('file', file)
    try {
      const response = await api.post<Blob>('/api/v1/dnk-all-inventory/generate', form, {
        responseType: 'blob',
        timeout: 180_000,
      })
      const headers = response.headers || {}
      const filenameHeader = headers['x-dnk-filename']
      const disposition = headers['content-disposition'] as string | undefined
      let filename =
        (typeof filenameHeader === 'string' && filenameHeader.trim()) ||
        'PMSH01-AvailInventory AllInventory.xlsx'
      if ((!filenameHeader || !String(filenameHeader).trim()) && disposition) {
        const match = /filename="?([^";]+)"?/i.exec(disposition)
        if (match?.[1]) filename = match[1]
      }
      return {
        blob: response.data,
        filename,
        rowCount: Number(headers['x-dnk-row-count'] || 0),
        poCount: Number(headers['x-dnk-po-count'] || 0),
        availableLines: Number(headers['x-dnk-available-lines'] || 0),
        dateStamp: String(headers['x-dnk-date-stamp'] || ''),
      }
    } catch (err: unknown) {
      const ax = err as {
        response?: { data?: Blob | { detail?: string }; status?: number }
        message?: string
      }
      const data = ax.response?.data
      if (data instanceof Blob) {
        try {
          const text = await data.text()
          const parsed = JSON.parse(text) as { detail?: string }
          if (parsed?.detail) {
            throw Object.assign(new Error(parsed.detail), {
              response: { data: { detail: parsed.detail }, status: ax.response?.status },
            })
          }
        } catch (inner) {
          if (inner instanceof Error && (inner as { response?: unknown }).response) {
            throw inner
          }
        }
      }
      throw err
    }
  },
}

export type FreightLineItem = {
  pallets: number
  weight_lbs: number
  length_in: number
  width_in: number
  height_in: number
  adjusted_height_in?: number | null
  height_rule_applied: boolean
  cubic_feet: number
}

export type FreightShipmentResult = {
  shipment_id: string
  line_items: FreightLineItem[]
  total_weight_lbs: number
  total_cubic_feet: number
  density_pcf: number
  freight_class: number
  height_rule_applied: boolean
}

export type FreightCalculationResult = {
  shipments: FreightShipmentResult[]
  summary: {
    shipment_count: number
    class_breakdown: Record<string, number>
  }
}

export type ManualFreightCalculatePayload = {
  shipment_id?: string
  skip_seventy_five_inch_rule?: boolean
  line_items: Array<{
    pallets: number
    weight: number
    length: number
    width: number
    height: number
  }>
}

export const freightClassCalculatorApi = {
  calculateManual: async (
    payload: ManualFreightCalculatePayload,
  ): Promise<FreightCalculationResult> => {
    const response = await api.post<FreightCalculationResult>(
      '/api/v1/freight-class-calculator/calculate-manual',
      payload,
    )
    return response.data
  },

  calculateFile: async (
    file: File,
    skipSeventyFiveInchRule = false,
  ): Promise<FreightCalculationResult> => {
    const form = new FormData()
    form.append('file', file)
    const response = await api.post<FreightCalculationResult>(
      `/api/v1/freight-class-calculator/calculate-file?skip_seventy_five_inch_rule=${skipSeventyFiveInchRule}`,
      form,
      { timeout: 120_000 },
    )
    return response.data
  },

  exportExcel: async (result: FreightCalculationResult): Promise<{ blob: Blob; filename: string }> => {
    const response = await api.post<Blob>(
      '/api/v1/freight-class-calculator/export',
      result,
      { responseType: 'blob', timeout: 120_000 },
    )
    const disposition = response.headers['content-disposition'] as string | undefined
    let filename = 'Freight Class Summary.xlsx'
    if (disposition) {
      const match = /filename="?([^";]+)"?/i.exec(disposition)
      if (match?.[1]) filename = match[1]
    }
    return { blob: response.data, filename }
  },

  downloadTemplate: async (): Promise<{ blob: Blob; filename: string }> => {
    const response = await api.get<Blob>('/api/v1/freight-class-calculator/template', {
      responseType: 'blob',
    })
    return {
      blob: response.data,
      filename: 'Freight Class Calculator Template.xlsx',
    }
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

export const catalogUpcApi = {
  list: async (
    limit = 50,
    offset = 0,
    search?: string
  ): Promise<CatalogUpcListResponse> => {
    const response = await api.get('/api/v1/catalog-upc', {
      params: { limit, offset, search: search || undefined },
    })
    return response.data
  },
  importFile: async (file: File): Promise<CatalogImportResult> => {
    const form = new FormData()
    form.append('file', file)
    const response = await api.post('/api/v1/catalog-upc/import', form, {
      timeout: 300_000,
    })
    return response.data
  },
  downloadTemplate: async (): Promise<Blob> => {
    const response = await api.get('/api/v1/catalog-upc/template', {
      responseType: 'blob',
    })
    return response.data
  },
}

export const catalogDimsApi = {
  list: async (
    limit = 50,
    offset = 0,
    search?: string
  ): Promise<CatalogDimsListResponse> => {
    const response = await api.get('/api/v1/catalog-dims', {
      params: { limit, offset, search: search || undefined },
    })
    return response.data
  },
  importFile: async (file: File): Promise<CatalogImportResult> => {
    const form = new FormData()
    form.append('file', file)
    const response = await api.post('/api/v1/catalog-dims/import', form, {
      timeout: 300_000,
    })
    return response.data
  },
  downloadTemplate: async (): Promise<Blob> => {
    const response = await api.get('/api/v1/catalog-dims/template', {
      responseType: 'blob',
    })
    return response.data
  },
}

export const masterSheetApi = {
  downloadTemplate: async (): Promise<Blob> => {
    const response = await api.get('/api/v1/master-sheet/template', {
      responseType: 'blob',
    })
    return response.data
  },
  generate: async (
    file: File
  ): Promise<{
    blob: Blob
    filename: string
    totalRows: number
    upcMatched: number
    upcMissing: number
    mcByUpc: number
    mcByDescSize: number
    mcMissing: number
  }> => {
    const form = new FormData()
    form.append('file', file)
    const response = await api.post('/api/v1/master-sheet/generate', form, {
      responseType: 'blob',
      timeout: 300_000,
    })
    const headers = response.headers || {}
    const disposition = String(headers['content-disposition'] || '')
    const match = /filename=\"?([^\";]+)\"?/i.exec(disposition)
    const filename = match?.[1] || 'Master_Sheet.xlsx'
    return {
      blob: response.data,
      filename,
      totalRows: Number(headers['x-master-total-rows'] || 0),
      upcMatched: Number(headers['x-master-upc-matched'] || 0),
      upcMissing: Number(headers['x-master-upc-missing'] || 0),
      mcByUpc: Number(headers['x-master-mc-by-upc'] || 0),
      mcByDescSize: Number(headers['x-master-mc-by-desc-size'] || 0),
      mcMissing: Number(headers['x-master-mc-missing'] || 0),
    }
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

