/**
 * Format elapsed duration between two timestamps.
 */
export function formatRunDuration(createdAt?: string, completedAt?: string): string {
  if (!createdAt) return '-'

  const startMs = new Date(createdAt).getTime()
  if (Number.isNaN(startMs)) return '-'

  const endMs = completedAt ? new Date(completedAt).getTime() : Date.now()
  if (Number.isNaN(endMs) || endMs < startMs) return '-'

  const totalSeconds = Math.floor((endMs - startMs) / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

