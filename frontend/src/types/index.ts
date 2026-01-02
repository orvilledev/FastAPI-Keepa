export interface User {
  id: string
  email?: string
  user_metadata?: Record<string, any>
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

