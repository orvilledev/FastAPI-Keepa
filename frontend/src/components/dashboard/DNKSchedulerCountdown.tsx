import { useState, useEffect, useCallback } from 'react'
import { schedulerApi } from '../../services/api'
import type { SchedulerStatus } from '../../types'

export default function DNKSchedulerCountdown() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null)
  const [timeLeft, setTimeLeft] = useState<{
    hours: number
    minutes: number
    seconds: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      setError(null)
      console.log('Loading DNK scheduler status...')
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 10000)
      )
      
      const data = await Promise.race([
        schedulerApi.getNextRun('dnk'),
        timeoutPromise
      ]) as SchedulerStatus
      
      console.log('DNK Scheduler status loaded:', data)
      setStatus(data)
      
      if (data.seconds_until !== null && data.seconds_until > 0) {
        setTimeLeft({
          hours: Math.floor(data.seconds_until / 3600),
          minutes: Math.floor((data.seconds_until % 3600) / 60),
          seconds: data.seconds_until % 60,
        })
      } else {
        setTimeLeft(null)
      }
    } catch (error: any) {
      console.error('Failed to load DNK scheduler status:', error)
      const errorMessage = error?.response?.data?.detail || error?.message || 'Failed to load scheduler status'
      setError(errorMessage)
      // Set a default status so it doesn't stay in loading state
      setStatus({
        next_run_time: null,
        next_run_time_taipei: null,
        scheduled_time: "8:00 PM Taipei time",
        timezone: "Asia/Taipei (UTC+8)",
        message: errorMessage,
        seconds_until: null,
        is_running: false
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
    // Refresh status every minute
    const interval = setInterval(loadStatus, 60000)
    return () => clearInterval(interval)
  }, [loadStatus])

  useEffect(() => {
    if (status?.seconds_until !== undefined && status.seconds_until !== null && status.seconds_until > 0) {
      // Update countdown every second
      const interval = setInterval(() => {
        setStatus((prevStatus) => {
          if (!prevStatus || prevStatus.seconds_until === null || prevStatus.seconds_until <= 0) {
            return prevStatus
          }
          const seconds = prevStatus.seconds_until - 1
          setTimeLeft({
            hours: Math.floor(seconds / 3600),
            minutes: Math.floor((seconds % 3600) / 60),
            seconds: seconds % 60,
          })
          return { ...prevStatus, seconds_until: seconds }
        })
      }, 1000)

      return () => clearInterval(interval)
    }
  }, [status?.seconds_until])


  if (loading) {
    return (
      <div className="card p-6">
        <div className="text-center text-gray-500">Loading DNK scheduler status...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-6">
        <div className="text-center">
          <div className="text-red-600 font-medium mb-2">Error loading DNK scheduler status</div>
          <div className="text-sm text-gray-500">{error}</div>
        </div>
      </div>
    )
  }

  if (!status || !status.next_run_time) {
    return (
      <div className="card p-6">
        <div className="text-center text-gray-500">
          {status?.message || 'DNK Scheduler not configured'}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[#0B1020] rounded-xl shadow-xl p-6 text-white border border-white/20">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold mb-2">DNK Keepa Off Price Daily Run</h3>
          <p className="text-white/70 text-sm mb-4">
            Scheduled for {status.scheduled_time} ({status.timezone})
          </p>
          {timeLeft && status.seconds_until !== null && status.seconds_until > 0 ? (
            <div className="flex items-center space-x-4">
              <div className="text-center">
                <div className="text-4xl font-bold text-[#F97316]">{String(timeLeft.hours).padStart(2, '0')}</div>
                <div className="text-xs text-white/70 mt-1">Hours</div>
              </div>
              <div className="text-3xl font-bold text-[#F97316]">:</div>
              <div className="text-center">
                <div className="text-4xl font-bold text-[#F97316]">{String(timeLeft.minutes).padStart(2, '0')}</div>
                <div className="text-xs text-white/70 mt-1">Minutes</div>
              </div>
              <div className="text-3xl font-bold text-[#F97316]">:</div>
              <div className="text-center">
                <div className="text-4xl font-bold text-[#F97316]">{String(timeLeft.seconds).padStart(2, '0')}</div>
                <div className="text-xs text-white/70 mt-1">Seconds</div>
              </div>
            </div>
          ) : (
            <div className="text-lg font-semibold">Email will be sent soon...</div>
          )}
        </div>
        <div className="text-right ml-6">
          <div className="text-sm text-white/70 mb-1">Next Run</div>
          <div className="text-lg font-semibold">{status.next_run_time_taipei}</div>
          <div className="mt-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              status.is_running ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {status.is_running ? '● Running' : '○ Stopped'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
