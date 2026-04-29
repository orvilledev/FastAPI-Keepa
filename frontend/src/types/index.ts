export interface User {
  id: string
  email?: string
  role?: string
  display_name?: string
  has_keepa_access?: boolean
  can_manage_tools?: boolean
  user_metadata?: Record<string, any>
}

export interface Profile {
  id: string
  email?: string
  role?: string
  full_name?: string
  company_name?: string
  phone?: string
  address?: string
  city?: string
  state?: string
  zip_code?: string
  country?: string
  created_at?: string
  updated_at?: string
}

export interface PublicTool {
  id: string
  name: string
  description?: string
  url: string
  video_url?: string
  category?: string
  icon?: string
  developer?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface JobAid {
  id: string
  name: string
  description?: string
  url: string
  video_url?: string
  category?: string
  icon?: string
  developer?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface UserTool {
  id: string
  user_id: string
  name: string
  description?: string
  url: string
  category?: string
  icon?: string
  developer?: string
  created_at: string
  updated_at: string
}

export interface BatchJob {
  id: string
  job_name: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  total_batches: number
  completed_batches: number
  total_upcs: number
  created_by?: string
  initiated_by?: string
  created_at: string
  completed_at?: string
  error_message?: string
  description?: string
  email_recipients?: string
  keepa_offers_limit?: number
  off_price_scope?: 'buybox_only' | 'buybox_and_non_buybox_below_map'
  /** MAP vendor (map_prices.vendor_type) used for off-price detection for this job */
  map_vendor_type?: MapVendorType
}

export interface UPCBatch {
  id: string
  batch_job_id: string
  batch_number: number
  status: string
  upc_count: number
  processed_count: number
  created_at: string
  completed_at?: string
  error_message?: string
}

export interface PriceAlert {
  id: string
  batch_job_id: string
  upc: string
  seller_name?: string
  current_price?: number
  historical_price?: number
  price_change_percent?: number
  keepa_data?: any
  detected_at: string
}

export interface ComprehensiveReportRow {
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

export interface JobStatus {
  job_id: string
  status: string
  total_batches: number
  completed_batches: number
  progress_percent: number
  batches: UPCBatch[]
}

export interface UPC {
  id: string
  upc: string
  category: string
  created_at: string
}

/** MAP vendor / UPC category code (lowercase; server validates 1–32 chars). */
export type MapVendorType = string

/** Row from `seller_names` — maps Keepa seller IDs to display names for reports. */
export interface SellerName {
  id: string
  seller_id: string
  seller_name: string
  created_at?: string
  updated_at?: string
}

export interface MAP {
  id: string
  upc: string
  map_price: number
  vendor_type: MapVendorType
  created_at: string
  updated_at: string
}

export interface SchedulerStatus {
  next_run_time: string | null
  next_run_time_taipei: string | null
  scheduled_time: string
  timezone: string
  run_mode?: 'daily' | 'every_other_day' | 'custom_days'
  custom_days?: string[]
  seconds_until: number | null
  is_running: boolean
  message?: string
}

export interface SchedulerSettings {
  timezone: string
  hour: number
  minute: number
  enabled: boolean
  run_mode: 'daily' | 'every_other_day' | 'custom_days'
  input_mode?: 'api' | 'uploaded'
  custom_days: string[]
  anchor_date?: string | null
  email_recipients?: string | null
  category: string
}

export interface QuickAccessLink {
  id: string
  user_id: string
  title: string
  url: string
  icon?: string
  display_order: number
  created_at: string
  updated_at: string
}

export interface DashboardWidget {
  id: string
  user_id: string
  widget_id: string
  display_order: number
  is_visible: boolean
  created_at: string
  updated_at: string
}

export interface Note {
  id: string
  user_id: string
  title: string
  content: string
  category?: string
  color?: string
  importance?: 'low' | 'normal' | 'high' | 'urgent'
  is_protected?: boolean
  has_password?: boolean
  require_password_always?: boolean
  position?: number
  created_at: string
  updated_at: string
}

export interface Notification {
  id: string
  user_id: string
  type: string
  title: string
  message: string
  priority?: 'critical' | 'warning' | 'info' | string
  related_id?: string
  related_type?: string
  is_read: boolean
  read_at?: string
  metadata?: Record<string, any>
  action_label?: string
  action_url?: string
  expires_at?: string
  created_at: string
}

