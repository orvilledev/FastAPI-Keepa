type BatteryProgressProps = {
  percent: number
}

/** Full-width horizontal progress bar (Keepa Import File and similar tools). */
export function BatteryProgress({ percent }: BatteryProgressProps) {
  const safePercent = Math.max(0, Math.min(100, percent))

  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200"
      role="progressbar"
      aria-valuenow={safePercent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${safePercent}% complete`}
    >
      <div
        className="h-full rounded-full bg-[#81B81D] transition-all duration-300"
        style={{ width: `${safePercent}%` }}
      />
    </div>
  )
}
