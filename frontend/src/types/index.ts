export interface User {
  id: string
  email?: string
  role?: string
  display_name?: string
  has_keepa_access?: boolean
  can_manage_tools?: boolean
  can_assign_tasks?: boolean
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
  status: 'pending' | 'processing' | 'completed' | 'failed'
  total_batches: number
  completed_batches: number
  created_by?: string
  created_at: string
  completed_at?: string
  error_message?: string
  description?: string
  email_recipients?: string
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
  created_at: string
}

export interface MAP {
  id: string
  upc: string
  map_price: number
  created_at: string
  updated_at: string
}

export interface SchedulerStatus {
  next_run_time: string | null
  next_run_time_taipei: string | null
  scheduled_time: string
  timezone: string
  seconds_until: number | null
  is_running: boolean
  message?: string
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

export interface Task {
  id: string
  user_id: string
  title: string
  link?: string
  purpose?: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high'
  due_date?: string
  assigned_to?: string
  assignment_purpose?: string
  is_urgent?: boolean
  created_at: string
  updated_at: string
}

export interface Subtask {
  id: string
  task_id: string
  title: string
  description?: string
  status: 'pending' | 'completed'
  display_order: number
  assigned_to?: string
  created_at: string
  updated_at: string
}

export interface TaskValidation {
  id: string
  task_id: string
  submitted_by: string
  validation_type: 'file' | 'text'
  file_name?: string
  file_url?: string
  file_size?: number
  text_content?: string
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by?: string
  review_notes?: string
  reviewed_at?: string
  created_at: string
  updated_at: string
}

export interface TaskAttachment {
  id: string
  task_id: string
  uploaded_by: string
  file_name: string
  file_url: string
  file_size: number
  file_type: string
  file_category: 'image' | 'pdf' | 'excel' | 'csv' | 'powerpoint' | 'word' | 'other'
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
  related_id?: string
  related_type?: string
  is_read: boolean
  read_at?: string
  metadata?: Record<string, any>
  created_at: string
}

