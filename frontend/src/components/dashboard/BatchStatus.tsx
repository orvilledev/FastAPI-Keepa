interface BatchStatusProps {
  completed: number
  total: number
}

export default function BatchStatus({ completed, total }: BatchStatusProps) {
  const percentage = total > 0 ? (completed / total) * 100 : 0

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm text-gray-600">
        <span>Batches Completed</span>
        <span>
          {completed} / {total}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="text-xs text-gray-500 text-right">{percentage.toFixed(1)}%</div>
    </div>
  )
}

