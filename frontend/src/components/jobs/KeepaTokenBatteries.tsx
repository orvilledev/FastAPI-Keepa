import { useEffect, useRef, useState } from 'react'
import { jobsApi } from '../../services/api'

const POLL_MS = 8000

type TokenKeyMeter = {
  index: number
  label: string
  fingerprint: string
  ok: boolean
  tokens_left: number | null
  refill_rate: number | null
  refill_in_ms: number | null
  bucket_max: number | null
}

function useAnimatedNumber(target: number | null, durationMs = 700): number | null {
  const [display, setDisplay] = useState<number | null>(target)
  const displayRef = useRef<number | null>(target)

  useEffect(() => {
    if (target === null || !Number.isFinite(target)) {
      displayRef.current = null
      setDisplay(null)
      return
    }
    const from = displayRef.current
    if (from === null || !Number.isFinite(from)) {
      displayRef.current = target
      setDisplay(target)
      return
    }
    const start = from
    const delta = target - start
    if (delta === 0) return
    let frame = 0
    const startedAt = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs)
      const eased = 1 - (1 - t) * (1 - t)
      const next = Math.round(start + delta * eased)
      displayRef.current = next
      setDisplay(next)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs])

  return display
}

function fillClass(percent: number): string {
  if (percent <= 12) return 'bg-red-500'
  if (percent <= 35) return 'bg-amber-400'
  return 'bg-[#81B81D]'
}

function TokenBattery({ meter }: { meter: TokenKeyMeter }) {
  const tokens = meter.ok ? meter.tokens_left : null
  const animated = useAnimatedNumber(tokens)
  const bucketMax = Math.max(1, meter.bucket_max || 300)
  const shown = animated ?? 0
  const percent = meter.ok
    ? Math.max(0, Math.min(100, Math.round((Math.max(0, shown) / bucketMax) * 100)))
    : 0

  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-slate-600 dark:bg-surface">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-slate-200">{meter.label}</span>
        <span className="truncate font-mono text-[10px] text-gray-400 dark:text-slate-500" title={meter.fingerprint}>
          {meter.fingerprint}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div
          className="relative h-7 w-[4.75rem] shrink-0 rounded-md border-2 border-gray-400 bg-gray-100 p-[2px] dark:border-slate-500 dark:bg-slate-800"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={bucketMax}
          aria-valuenow={meter.ok ? Math.max(0, shown) : 0}
          aria-label={`${meter.label} tokens remaining`}
        >
          <div
            className="absolute -right-[5px] top-1/2 h-3 w-[5px] -translate-y-1/2 rounded-r-sm bg-gray-400 dark:bg-slate-500"
            aria-hidden
          />
          <div className="h-full w-full overflow-hidden rounded-[3px] bg-gray-200 dark:bg-slate-700">
            <div
              className={`h-full ${fillClass(percent)} transition-[width] duration-700 ease-out`}
              style={{ width: meter.ok ? `${percent}%` : '0%' }}
            />
          </div>
        </div>
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold tabular-nums text-gray-900 dark:text-slate-100">
            {meter.ok && animated !== null ? animated.toLocaleString() : '—'}
          </div>
          <div className="text-[10px] leading-tight text-gray-500 dark:text-slate-400">
            {meter.ok && meter.refill_rate
              ? `+${meter.refill_rate}/min`
              : meter.ok
                ? 'tokens'
                : 'offline'}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function KeepaTokenBatteries() {
  const [meters, setMeters] = useState<TokenKeyMeter[]>([])
  const [error, setError] = useState('')
  const inFlightRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (document.visibilityState === 'hidden') return
      if (inFlightRef.current) return
      inFlightRef.current = true
      try {
        const data = await jobsApi.getKeepaTokenMeters()
        if (cancelled) return
        setMeters(Array.isArray(data.keys) ? data.keys : [])
        setError('')
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.response?.data?.detail || 'Could not load Keepa token meters')
        }
      } finally {
        inFlightRef.current = false
      }
    }

    void load()
    const id = window.setInterval(() => {
      void load()
    }, POLL_MS)
    const onVis = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  if (error && meters.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
        Keepa token meters unavailable. Express Jobs still run as usual.
      </div>
    )
  }

  if (meters.length === 0) return null

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-gray-500 dark:text-slate-400">
        Express Keepa keys — live tokens remaining
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {meters.map((meter) => (
          <TokenBattery key={meter.index} meter={meter} />
        ))}
      </div>
    </div>
  )
}
