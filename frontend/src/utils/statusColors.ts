/**
 * Get CSS classes for status badges.
 * @param status - The status string
 * @returns CSS classes for the status badge
 */
export const getStatusColor = (status: string): string => {
  const colors: Record<string, string> = {
    completed: 'bg-green-100 text-green-800',
    processing: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-yellow-100 text-yellow-800',
    pending: 'bg-gray-100 text-gray-800',
  }
  return colors[status] || 'bg-gray-100 text-gray-800'
}

