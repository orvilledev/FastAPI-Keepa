/**
 * NoteCard - Individual note card component
 */

import React from 'react'
import type { Note } from '../../types'
import { getNoteColor, getImportanceOption, formatDate } from '../../utils/noteUtils'

interface NoteCardProps {
  note: Note
  index: number
  // Protection state
  isPasswordLocked: boolean
  isSessionUnlocked: boolean
  isRevealed: boolean
  displayContent: string
  blurFilter: string
  // Actions
  onEdit: (note: Note) => void
  onDelete: (noteId: string) => void
  onToggleReveal: (noteId: string) => void
  onShowPasswordPrompt: (noteId: string, action: 'view' | 'edit') => void
  onHideSession: (noteId: string) => void
}

export default function NoteCard({
  note,
  index,
  isPasswordLocked,
  isSessionUnlocked,
  isRevealed,
  displayContent,
  blurFilter,
  onEdit,
  onDelete,
  onToggleReveal,
  onShowPasswordPrompt,
  onHideSession,
}: NoteCardProps) {
  const importance = (note as any).importance || 'normal'
  const color = getNoteColor(note.color)
  const importanceOption = getImportanceOption(importance)

  return (
    <div
      draggable
      onDragStart={(e) => {
        const target = e.target as HTMLElement
        const contentArea = e.currentTarget.querySelector('.note-content')
        const headerArea = e.currentTarget.querySelector('.note-header')
        const isInContent = contentArea && (contentArea.contains(target) || contentArea === target)
        const isInHeader = headerArea && (headerArea.contains(target) || headerArea === target)

        if (isInContent || !isInHeader) {
          e.preventDefault()
          return
        }

        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', note.id)
        e.currentTarget.style.opacity = '0.5'
      }}
      onDragEnd={(e) => {
        e.currentTarget.style.opacity = '1'
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        e.preventDefault()
        const draggedNoteId = e.dataTransfer.getData('text/plain')
        if (draggedNoteId !== note.id) {
          console.log('Note reorder:', draggedNoteId, 'to', note.id)
        }
      }}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement
        const contentArea = e.currentTarget.querySelector('.note-content')
        const isInContent = contentArea && (contentArea.contains(target) || contentArea === target)
        if (isInContent) {
          e.currentTarget.setAttribute('draggable', 'false')
        }
      }}
      onMouseUp={(e) => {
        e.currentTarget.setAttribute('draggable', 'true')
      }}
      className={`bg-white ${color.border} border-4 rounded-lg shadow-sm hover:shadow-md transition-all duration-200 note-box`}
      style={{
        animation: 'fadeIn 0.3s ease-out',
        animationDelay: `${index * 0.05}s`,
        animationFillMode: 'both',
      }}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-100 cursor-move note-header">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-lg font-semibold text-gray-900 flex-1">{note.title}</h3>
          <div className="flex gap-2 ml-2">
            <button
              onClick={() => onEdit(note)}
              className="px-2 py-1 text-sm text-[#0B1020] hover:text-indigo-800 hover:bg-indigo-50 rounded transition-colors"
              title="Edit"
            >
              Edit
            </button>
            <button
              onClick={() => onDelete(note.id)}
              className="px-2 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
              title="Delete"
            >
              Delete
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {note.category && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">
              {note.category}
            </span>
          )}
          <span className={`px-2 py-1 rounded text-xs font-medium ${importanceOption.color}`}>
            {importanceOption.label}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {isPasswordLocked ? (
          <LockedContent
            requirePasswordAlways={note.require_password_always || false}
            onUnlock={() => onShowPasswordPrompt(note.id, 'view')}
          />
        ) : (
          <>
            {/* Protection indicator for non-password protected notes */}
            {note.is_protected && !note.has_password && (
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  🔒 Protected Content
                </span>
                <button
                  onClick={() => onToggleReveal(note.id)}
                  className="text-xs text-[#0B1020] hover:text-indigo-800 font-medium"
                >
                  {isRevealed ? '👁️ Hide' : '👁️‍🗨️ Reveal'}
                </button>
              </div>
            )}

            {/* Protection indicator for password-protected notes with require_password_always */}
            {note.is_protected && note.has_password && note.require_password_always && (
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  🔐 Password Required (Always)
                </span>
                {isSessionUnlocked ? (
                  <button
                    onClick={() => onHideSession(note.id)}
                    className="text-xs text-[#0B1020] hover:text-indigo-800 font-medium"
                  >
                    👁️ Hide
                  </button>
                ) : (
                  <button
                    onClick={() => onShowPasswordPrompt(note.id, 'view')}
                    className="text-xs text-[#0B1020] hover:text-indigo-800 font-medium"
                  >
                    👁️ Reveal
                  </button>
                )}
              </div>
            )}

            {/* Note content */}
            <div
              className="text-gray-700 note-content select-text"
              style={{
                minHeight: '100px',
                maxHeight: '300px',
                overflowY: 'auto',
                lineHeight: '1.6',
                userSelect: 'text',
                WebkitUserSelect: 'text',
                MozUserSelect: 'text',
                msUserSelect: 'text',
                cursor: 'text',
                filter: blurFilter,
                transition: 'filter 0.3s ease',
              }}
              dangerouslySetInnerHTML={{ __html: displayContent }}
            />
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 rounded-b-lg">
        <div className="text-xs text-gray-500">
          Created: {formatDate(note.created_at)}
          {note.updated_at !== note.created_at && <> • Updated: {formatDate(note.updated_at)}</>}
        </div>
      </div>
    </div>
  )
}

interface LockedContentProps {
  requirePasswordAlways: boolean
  onUnlock: () => void
}

function LockedContent({ requirePasswordAlways, onUnlock }: LockedContentProps) {
  return (
    <div className="text-center py-8">
      <div className="text-4xl mb-4">🔐</div>
      <p className="text-gray-600 mb-4">This note is password protected</p>
      {requirePasswordAlways && (
        <p className="text-xs text-gray-500 mb-2">Password required even for owner</p>
      )}
      <button
        onClick={onUnlock}
        className="px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors font-medium"
      >
        Enter Password to View
      </button>
    </div>
  )
}
