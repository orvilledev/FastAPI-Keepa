import { useCallback, useEffect, useState } from 'react'
import { schedulerApi } from '../../services/api'
import type { SchedulerStatus } from '../../types'

/** Vendor slug passed to scheduler API routes. */
export type VendorSchedulerCode =
  | 'dnk'
  | 'clk'
  | 'obz'
  | 'ref'
  | 'bor'
  | 'sff'
  | 'tev'
  | 'cha'

export interface VendorSchedulerCountdownProps {
  vendor: VendorSchedulerCode
  /** Heading text shown in loading, stopped, and active states */
  title: string
}

export default function VendorSchedulerCountdown({
  vendor,
  title,
}: VendorSchedulerCountdownProps) {
  const label = vendor.toUpperCase()

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
      if (import.meta.env.DEV) {
        console.log(`Loading ${label} scheduler status...`)
      }

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), 10_000),
      )

      const [data, settings] = await Promise.all([
        Promise.race([
          schedulerApi.getNextRun(vendor),
          timeoutPromise,
        ]) as Promise<SchedulerStatus>,
        schedulerApi.getSettings(vendor).catch(() => ({ enabled: true })),
      ])

      if (import.meta.env.DEV) {
        console.log(`${label} scheduler status loaded`, data)
      }

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
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { detail?: string } }; message?: string }
      console.error(`Failed to load ${label} scheduler status:`, err)
      const errorMessage =
        anyErr?.response?.data?.detail ||
        anyErr?.message ||
        'Failed to load scheduler status'
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
  }, [vendor, label])

  useEffect(() => {
    loadStatus()
    const interval = setInterval(loadStatus, 60_000)
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
        <div className="text-center text-gray-500">
          Loading {label} scheduler status...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-6">
        <div className="text-center">
          <div className="text-red-600 font-medium mb-2">
            Error loading {label} scheduler status
          </div>
          <div className="text-sm text-gray-500">{error}</div>
        </div>
      </div>
    )
  }

  if (!enabled) {
    return (
      <div className="bg-gray-100 rounded-xl shadow p-6 border border-gray-300">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold mb-2 text-gray-900">{title}</h3>
            <p className="text-gray-500 text-sm">Daily run is currently stopped.</p>
            <div className="mt-2">
              <span
                className={`inline-flex w-fit items-center rounded-md px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide ring-2 sm:px-3 sm:py-1.5 sm:text-sm ${
                  inputMode === 'uploaded'
                    ? 'bg-[#81B81D]/20 text-[#DDF5B0] ring-[#81B81D]/80'
                    : 'bg-[#F97316]/20 text-[#FFD8B0] ring-[#F97316]/80'
                }`}
              >
                {inputMode === 'uploaded' ? 'Import Mode' : 'API Mode'}
              </span>
            </div>
          </div>
          <div className="shrink-0 sm:text-right">
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
          {status?.message ?? `${label} Scheduler not configured`}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`rounded-xl shadow-xl p-4 text-white border sm:p-6 ${
        inputMode === 'uploaded'
          ? 'bg-[#404040] border-white/20'
          : 'bg-[#404040] border-white/20'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold mb-2">{title}</h3>
          <div className="mb-4 space-y-2">
            <p className="text-sm leading-relaxed text-white/70 break-words">
              Scheduled for {status.scheduled_time} ({status.timezone})
            </p>
            <span
              className={`inline-flex w-fit items-center rounded-md px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide ring-2 sm:px-3 sm:py-1.5 sm:text-sm ${
                inputMode === 'uploaded'
                  ? 'bg-[#81B81D]/30 text-[#E8F8C8] ring-[#81B81D]/85'
                  : 'bg-[#F97316]/30 text-[#FFE7CC] ring-[#F97316]/85'
              }`}
            >
              {inputMode === 'uploaded' ? 'Import Mode' : 'API Mode'}
            </span>
          </div>
          {timeLeft && status.seconds_until !== null && status.seconds_until > 0 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="text-center">
                <div
                  className={`text-2xl font-bold sm:text-4xl ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}
                >
                  {String(timeLeft.hours).padStart(2, '0')}
                </div>
                <div className="text-xs text-white/70 mt-1">Hours</div>
              </div>
              <div
                className={`text-xl font-bold sm:text-3xl ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}
              >
                :
              </div>
              <div className="text-center">
                <div
                  className={`text-2xl font-bold sm:text-4xl ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}
                >
                  {String(timeLeft.minutes).padStart(2, '0')}
                </div>
                <div className="text-xs text-white/70 mt-1">Minutes</div>
              </div>
              <div
                className={`text-xl font-bold sm:text-3xl ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}
              >
                :
              </div>
              <div className="text-center">
                <div
                  className={`text-2xl font-bold sm:text-4xl ${inputMode === 'uploaded' ? 'text-[#81B81D]' : 'text-[#F97316]'}`}
                >
                  {String(timeLeft.seconds).padStart(2, '0')}
                </div>
                <div className="text-xs text-white/70 mt-1">Seconds</div>
              </div>
            </div>
          ) : (
            <div className="text-base font-semibold sm:text-lg">Email will be sent soon...</div>
          )}
        </div>
        <div className="shrink-0 sm:text-right">
          <div className="text-sm text-white/70 mb-1">Next Run</div>
          <div className="text-lg font-semibold">{status.next_run_time_taipei}</div>
          <div className="mt-2">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                status.is_running ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}
            >
              {status.is_running ? '● Running' : '○ Stopped'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
