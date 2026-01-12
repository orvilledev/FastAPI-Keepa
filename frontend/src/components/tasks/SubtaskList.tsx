/**
 * SubtaskList - Subtasks section for a task
 */

import React from 'react'
import type { Subtask } from '../../types'

interface SubtaskFormData {
  title: string
  description: string
}

interface SubtaskListProps {
  taskId: string
  subtasks: Subtask[]
  isExpanded: boolean
  showForm: boolean
  editingSubtask: { taskId: string; subtask: Subtask } | null
  formData: SubtaskFormData
  updatingSubtasks: Set<string>
  onToggle: () => void
  onShowForm: () => void
  onFormChange: (data: SubtaskFormData) => void
  onFormSubmit: (e: React.FormEvent, taskId: string) => void
  onFormCancel: () => void
  onStatusChange: (taskId: string, subtaskId: string, status: string) => void
  onEdit: (taskId: string, subtask: Subtask) => void
  onDelete: (taskId: string, subtaskId: string) => void
}

export default function SubtaskList({
  taskId,
  subtasks,
  isExpanded,
  showForm,
  editingSubtask,
  formData,
  updatingSubtasks,
  onToggle,
  onShowForm,
  onFormChange,
  onFormSubmit,
  onFormCancel,
  onStatusChange,
  onEdit,
  onDelete,
}: SubtaskListProps) {
  return (
    <div className="mt-4 pt-4 border-t border-gray-200 ml-8">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={onToggle}
          className="flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <span>{isExpanded ? '▼' : '▶'}</span>
          <span>Subtasks ({subtasks.length})</span>
        </button>
        {isExpanded && (
          <button
            onClick={onShowForm}
            className="text-xs px-2 py-1 text-[#0B1020] hover:bg-gray-100 rounded"
          >
            + Add Subtask
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="ml-6 space-y-2">
          {/* Subtask Form */}
          {showForm && (
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <form onSubmit={(e) => onFormSubmit(e, taskId)} className="space-y-2">
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => onFormChange({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  placeholder="Subtask title"
                />
                <textarea
                  value={formData.description}
                  onChange={(e) => onFormChange({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  rows={2}
                  placeholder="Description (optional)"
                />
                <div className="flex justify-end space-x-2">
                  <button
                    type="button"
                    onClick={onFormCancel}
                    className="px-3 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 text-xs bg-[#0B1020] text-white rounded hover:bg-[#1a2235]"
                  >
                    {editingSubtask ? 'Update' : 'Add'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Subtasks List */}
          {subtasks.length > 0 ? (
            <div className="space-y-2">
              {subtasks.map((subtask) => {
                const updateKey = `${taskId}-${subtask.id}`
                const isUpdating = updatingSubtasks.has(updateKey)

                return (
                  <div
                    key={subtask.id}
                    className="flex items-center space-x-2 p-2 bg-gray-50 rounded-lg hover:bg-gray-100"
                  >
                    <input
                      type="checkbox"
                      checked={subtask.status === 'completed'}
                      disabled={isUpdating}
                      onChange={(e) => {
                        e.stopPropagation()
                        if (!isUpdating) {
                          const newStatus = e.target.checked ? 'completed' : 'pending'
                          onStatusChange(taskId, subtask.id, newStatus)
                        }
                      }}
                      className="w-4 h-4 text-[#0B1020] rounded focus:ring-indigo-500 cursor-pointer flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <span
                      className={`flex-1 text-sm ${
                        subtask.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'
                      }`}
                    >
                      {subtask.title}
                    </span>
                    <button
                      onClick={() => onEdit(taskId, subtask)}
                      className="p-1 text-[#0B1020] hover:bg-gray-100 rounded text-xs"
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => onDelete(taskId, subtask.id)}
                      className="p-1 text-red-600 hover:bg-red-50 rounded text-xs"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            !showForm && (
              <div className="text-xs text-gray-500 py-2">
                No subtasks yet. Click "Add Subtask" to create one.
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
