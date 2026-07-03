/**
 * Get CSS classes for status badges.
 * @param status - The status string
 * @returns CSS classes for the status badge
 */
export const getStatusColor = (status: string): string => {
  const colors: Record<string, string> = {
    completed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
    processing: 'bg-blue-100 text-[#81B81D] dark:bg-blue-500/20 dark:text-accent-bright',
    failed: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
    cancelled: 'bg-[#81B81D]/20 text-[#111827] dark:text-green-200',
    pending: 'bg-gray-100 text-gray-800 dark:bg-slate-600/40 dark:text-slate-200',
  }
  return colors[status] || 'bg-gray-100 text-gray-800 dark:bg-slate-600/40 dark:text-slate-200'
}
