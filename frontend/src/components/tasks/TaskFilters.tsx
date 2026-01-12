/**
 * TaskFilters - Filter tabs for task list
 */

import React from 'react'

interface TaskFiltersProps {
  filterView: 'all' | 'my-tasks'
  filterStatus: string
  onFilterViewChange: (view: 'all' | 'my-tasks') => void
  onFilterStatusChange: (status: string) => void
  counts: {
    total: number
    pending: number
    inProgress: number
    completed: number
    myTasks: number
  }
  currentUserId: string
  hasUrgentTasks: boolean
}

export default function TaskFilters({
  filterView,
  filterStatus,
  onFilterViewChange,
  onFilterStatusChange,
  counts,
  hasUrgentTasks,
}: TaskFiltersProps) {
  return (
    <>
      {/* View Filter Tabs (All Tasks vs My Tasks) */}
      <div className="flex space-x-2 border-b border-gray-200 mb-4">
        <button
          onClick={() => {
            onFilterViewChange('all')
            onFilterStatusChange('all')
          }}
          className={`px-4 py-2 font-medium text-sm ${
            filterView === 'all'
              ? 'border-b-2 border-[#0B1020] text-[#0B1020]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          All Tasks ({counts.total})
        </button>
        <button
          onClick={() => {
            onFilterViewChange('my-tasks')
            onFilterStatusChange('all')
          }}
          className={`px-4 py-2 font-medium text-sm flex items-center space-x-2 ${
            filterView === 'my-tasks'
              ? 'border-b-2 border-[#0B1020] text-[#0B1020]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span>My Tasks ({counts.myTasks})</span>
          {hasUrgentTasks && (
            <span className="text-red-600 text-lg animate-pulse" title="You have urgent tasks">
              🔔
            </span>
          )}
        </button>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex space-x-2 border-b border-gray-200">
        <StatusTab
          label="All"
          count={filterView === 'my-tasks' ? counts.myTasks : counts.total}
          active={filterStatus === 'all'}
          onClick={() => onFilterStatusChange('all')}
        />
        <StatusTab
          label="Pending"
          count={counts.pending}
          active={filterStatus === 'pending'}
          onClick={() => onFilterStatusChange('pending')}
        />
        <StatusTab
          label="In Progress"
          count={counts.inProgress}
          active={filterStatus === 'in_progress'}
          onClick={() => onFilterStatusChange('in_progress')}
        />
        <StatusTab
          label="Completed"
          count={counts.completed}
          active={filterStatus === 'completed'}
          onClick={() => onFilterStatusChange('completed')}
        />
      </div>
    </>
  )
}

interface StatusTabProps {
  label: string
  count: number
  active: boolean
  onClick: () => void
}

function StatusTab({ label, count, active, onClick }: StatusTabProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 font-medium text-sm ${
        active
          ? 'border-b-2 border-[#0B1020] text-[#0B1020]'
          : 'text-gray-600 hover:text-gray-900'
      }`}
    >
      {label} ({count})
    </button>
  )
}
