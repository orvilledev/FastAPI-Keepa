type BatteryProgressProps = {
  percent: number
}

export function BatteryProgress({ percent }: BatteryProgressProps) {
  const safePercent = Math.max(0, Math.min(100, percent))
  const tone =
    safePercent < 35
      ? 'bg-red-500'
      : safePercent < 75
        ? 'bg-amber-500'
        : 'bg-emerald-500'

  return (
    <div className="inline-flex items-center gap-1">
      <div className="h-6 w-full max-w-xs rounded-md border-2 border-gray-400 bg-white p-[2px]">
        <div
          className={`h-full rounded-sm transition-all duration-300 ${tone}`}
          style={{ width: `${safePercent}%` }}
        />
      </div>
      <div className="h-3 w-1.5 shrink-0 rounded-r-sm bg-gray-400" />
    </div>
  )
}
