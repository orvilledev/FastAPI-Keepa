import { useState, useEffect, useCallback } from 'react'
import { schedulerApi } from '../../services/api'
import type { SchedulerStatus } from '../../types'

export default function BORSchedulerCountdown() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null)
  const [timeLeft, setTimeLeft] = useState<{
    hours: number
    minutes: number
    seconds: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<boolean>(true)
  const [inputMode, setInputMode] = useState<'api' | 'uploaded'>('api')

  const loadStatus = useCallback(async () => {
    try {
      setError(null)

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), 10000),
      )

      const [data, settings] = await Promise.all([
        Promise.race([schedulerApi.getNextRun('bor'), timeoutPromise]) as Promise<SchedulerStatus>,
        schedulerApi.getSettings('bor').catch(() => ({ enabled: true })),
      ])

      setStatus(data)
      setEnabled(settings.enabled !== false)
      setInputMode((settings.input_mode || 'api') === 'uploaded' ? 'uploaded' : 'api')

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
      const errorMessage = error?.response?.data?.detail || error?.message || 'Failed to load scheduler status'
      setError(errorMessage)
      setStatus({
        next_run_time: null,
        next_run_time_taipei: null,
        scheduled_time: '8:00 PM Taipei time',
        timezone: 'Asia/Taipei (UTC+8)',
        message: errorMessage,
        seconds_until: null,
        is_running: false,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
    const interval = setInterval(loadStatus, 60000)
    return () => clearInterval(interval)
  }, [loadStatus])

  useEffect(() => {
    if (status?.seconds_until !== undefined && status.seconds_until !== null && status.seconds_until > 0) {
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
        <div className="text-center text-gray-500">Loading BOR scheduler status...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-6">
        <div className="text-center">
          <div className="text-red-600 font-medium mb-2">Error loading BOR scheduler status</div>
          <div className="text-sm text-gray-500">{error}</div>
        </div>
      </div>
    )
  }

  if (!enabled) {
    return (
      <div className="bg-gray-100 rounded-xl shadow p-6 border border-gray-300">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2 text-gray-900">BOR Keepa Off Price Daily Run</h3>
            <p className="text-gray-500 text-sm">Daily run is currently stopped.</p>
            <div className="mt-2">
              <span
                className={`inline-flex items-center rounded-md px-3 py-1.5 text-base font-extrabold uppercase tracking-wide ring-2 ${
                  inputMode === 'uploaded'
                    ? 'bg-[#81B81D]/20 text-[#DDF5B0] ring-[#81B81D]/80'
                    : 'bg-[#F97316]/20 text-[#FFD8B0] ring-[#F97316]/80'
                }`}
              >
                {inputMode === 'uploaded' ? 'Import Mode' : 'API Mode'}
              </span>
            </div>
          </div>
          <div className="text-right ml-6">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#81B81D]/20 text-[#111827]">
              Stopped
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (!status || !status.next_run_time) {
    return (
      <div className="card p-6">
        <div className="text-center text-gray-500">
          {status?.message || 'BOR Scheduler not configured'}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`rounded-xl shadow-xl p-6 text-white border ${
        inputMode === 'uploaded'
          ? 'bg-[#1F2937] border-gray-400'
          : 'bg-[#404040] border-white/20'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold mb-2 text-white">BOR Keepa Off Price Daily Run</h3>
          <p className="text-white/90 text-sm mb-4">
            Scheduled for {status.scheduled_time} ({status.timezone})
            <span
              className={`ml-2 inline-flex items-center rounded-md px-3 py-1.5 text-base font-extrabold uppercase tracking-wide ring-2 ${
                inputMode === 'uploaded'
                  ? 'bg-[#81B81D]/30 text-[#E8F8C8] ring-[#81B81D]/85'
                  : 'bg-[#F97316]/30 text-[#FFE7CC] ring-[#F97316]/85'
              }`}
            >
              {inputMode === 'uploaded' ? 'Import Mode' : 'API Mode'}
            </span>
          </p>
          {timeLeft && status.seconds_until !== null && status.seconds_until > 0 ? (
            <div className="flex items-center space-x-4">
              <div className="text-center">
                <div className={`text-4xl font-bold ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}>{String(timeLeft.hours).padStart(2, '0')}</div>
                <div className="text-xs text-white/90 mt-1">Hours</div>
              </div>
              <div className={`text-3xl font-bold ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}>:</div>
              <div className="text-center">
                <div className={`text-4xl font-bold ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}>{String(timeLeft.minutes).padStart(2, '0')}</div>
                <div className="text-xs text-white/90 mt-1">Minutes</div>
              </div>
              <div className={`text-3xl font-bold ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}>:</div>
              <div className="text-center">
                <div className={`text-4xl font-bold ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}>{String(timeLeft.seconds).padStart(2, '0')}</div>
                <div className="text-xs text-white/90 mt-1">Seconds</div>
              </div>
            </div>
          ) : (
            <div className="text-lg font-semibold text-white">Email will be sent soon...</div>
          )}
        </div>
        <div className="text-right ml-6">
          <div className="text-sm text-white/90 mb-1">Next Run</div>
          <div className="text-lg font-semibold text-white">{status.next_run_time_taipei}</div>
          <div className="mt-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              status.is_running ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'
            }`}>
              {status.is_running ? '● Running' : '○ Stopped'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
