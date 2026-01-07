import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { notesApi } from '../../services/api'
import type { Note } from '../../types'
import ReactQuill from 'react-quill'
import 'react-quill/dist/quill.snow.css'

// Custom toolbar with all requested features
const modules = {
  toolbar: {
    container: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'list': 'ordered'}, { 'list': 'bullet' }],
      [{ 'script': 'sub'}, { 'script': 'super' }],
      [{ 'indent': '-1'}, { 'indent': '+1' }],
      ['link'],
      [{ 'color': [] }, { 'background': [] }],
      ['clean'],
    ],
  },
}

const formats = [
  'header',
  'bold', 'italic', 'underline', 'strike',
  'list', 'bullet',
  'script',
  'indent',
  'link',
  'color', 'background',
]

type Importance = 'low' | 'normal' | 'high' | 'urgent'

const importanceOptions: { value: Importance; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-700' },
  { value: 'normal', label: 'Normal', color: 'bg-blue-100 text-blue-700' },
  { value: 'high', label: 'High', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-100 text-red-700' },
]

export default function MyNotes() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [totalNotes, setTotalNotes] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingNote, setEditingNote] = useState<Note | null>(null)
  const [formData, setFormData] = useState({ 
    title: '', 
    content: '',
    category: '',
    color: 'yellow',
    importance: 'normal' as Importance
  })
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [availableCategories, setAvailableCategories] = useState<string[]>([])

  // Available colors for note borders
  const noteColors = [
    { value: 'yellow', label: 'Yellow', border: 'border-yellow-400' },
    { value: 'pink', label: 'Pink', border: 'border-pink-400' },
    { value: 'blue', label: 'Blue', border: 'border-blue-400' },
    { value: 'green', label: 'Green', border: 'border-green-400' },
    { value: 'purple', label: 'Purple', border: 'border-purple-400' },
    { value: 'orange', label: 'Orange', border: 'border-orange-400' },
    { value: 'red', label: 'Red', border: 'border-red-400' },
    { value: 'teal', label: 'Teal', border: 'border-teal-400' },
    { value: 'gray', label: 'Gray', border: 'border-gray-400' },
    { value: 'indigo', label: 'Indigo', border: 'border-indigo-400' },
  ]
  const [submitting, setSubmitting] = useState(false)
  const quillRef = useRef<ReactQuill>(null)

  const pageSize = 20

  const getNoteColor = (colorName: string = 'yellow') => {
    return noteColors.find(c => c.value === colorName) || noteColors[0]
  }

  const loadNotes = useCallback(async () => {
    try {
      setError(null)
      setLoading(true)
      
      // Get notes with pagination and filters
      const response = await notesApi.listNotes(
        currentPage, 
        pageSize, 
        searchTerm || undefined,
        categoryFilter || undefined
      )
      
      setNotes(response.notes)
      setTotalNotes(response.total)
      setTotalPages(response.total_pages)
      
      // To get all categories, we need to fetch all notes (without pagination)
      // This is a one-time call to extract categories
      if (availableCategories.length === 0) {
        try {
          const allNotesResponse = await notesApi.listNotes(0, 100, undefined, undefined)
          const categories = Array.from(new Set(
            allNotesResponse.notes
              .map(note => note.category)
              .filter((cat): cat is string => !!cat && cat.trim() !== '')
          )).sort()
          setAvailableCategories(categories)
        } catch (err) {
          // If this fails, we'll just use empty categories
          console.warn('Failed to load categories:', err)
        }
      }
    } catch (err: any) {
      console.error('Failed to load notes:', err)
      const errorDetail = err?.response?.data?.detail
      let errorMessage = 'Failed to load notes'
      
      // Handle validation errors from FastAPI
      if (Array.isArray(errorDetail)) {
        errorMessage = errorDetail.map((e: any) => e.msg || e.message || String(e)).join(', ')
      } else if (typeof errorDetail === 'string') {
        errorMessage = errorDetail
      } else if (err?.message) {
        errorMessage = err.message
      }
      
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }, [currentPage, searchTerm, categoryFilter, pageSize, availableCategories.length])

  useEffect(() => {
    loadNotes()
  }, [loadNotes])

  // Reset to first page when search term or category filter changes
  useEffect(() => {
    if (searchTerm !== '' || categoryFilter !== '') {
      setCurrentPage(0)
    }
  }, [searchTerm, categoryFilter])

  const handleAddNote = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      setError('Title and content are required')
      return
    }

    // Check if content has actual text (not just HTML tags)
    const textContent = formData.content.replace(/<[^>]*>/g, '').trim()
    if (!textContent) {
      setError('Note content cannot be empty')
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      await notesApi.createNote({
        title: formData.title.trim(),
        content: formData.content,
        category: formData.category.trim() || undefined,
        color: formData.color,
        importance: formData.importance,
      })
      setFormData({ title: '', content: '', category: '', color: 'yellow', importance: 'normal' })
      setShowAddForm(false)
      await loadNotes()
    } catch (err: any) {
      console.error('Failed to create note:', err)
      setError(err?.response?.data?.detail || err?.message || 'Failed to create note')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateNote = async () => {
    if (!editingNote) return
    if (!formData.title.trim() || !formData.content.trim()) {
      setError('Title and content are required')
      return
    }

    // Check if content has actual text (not just HTML tags)
    const textContent = formData.content.replace(/<[^>]*>/g, '').trim()
    if (!textContent) {
      setError('Note content cannot be empty')
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      setSuccess(null)
      await notesApi.updateNote(editingNote.id, {
        title: formData.title.trim(),
        content: formData.content,
        category: formData.category.trim() || undefined,
        color: formData.color,
        importance: formData.importance,
      })
      setEditingNote(null)
      setFormData({ title: '', content: '', category: '', color: 'yellow', importance: 'normal' })
      setShowAddForm(false)
      setSuccess('Note updated!')
      await loadNotes()
    } catch (err: any) {
      console.error('Failed to update note:', err)
      setError(err?.response?.data?.detail || err?.message || 'Failed to update note')
      setSuccess(null)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Are you sure you want to delete this note?')) return

    try {
      setError(null)
      await notesApi.deleteNote(noteId)
      await loadNotes()
    } catch (err: any) {
      console.error('Failed to delete note:', err)
      setError(err?.response?.data?.detail || err?.message || 'Failed to delete note')
    }
  }

  const handleEditClick = (note: Note) => {
    setEditingNote(note)
    setFormData({ 
      title: note.title, 
      content: note.content,
      category: note.category || '',
      color: note.color || 'yellow',
      importance: (note as any).importance || 'normal'
    })
    setShowAddForm(true)
  }

  const handleCancel = () => {
    setShowAddForm(false)
    setEditingNote(null)
    setFormData({ title: '', content: '', category: '', color: 'yellow', importance: 'normal' })
    setError(null)
    setSuccess(null)
  }

  const handleBackToNotes = () => {
    setSuccess(null)
    setShowAddForm(false)
    setEditingNote(null)
    setFormData({ title: '', content: '', importance: 'normal' })
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getImportanceBadge = (importance: string) => {
    const option = importanceOptions.find(opt => opt.value === importance) || importanceOptions[1]
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${option.color}`}>
        {option.label}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My Notes</h1>
          <p className="mt-1 text-sm text-gray-500">Create and manage your personal notes with rich text formatting</p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
          >
            + Add Note
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
          {success}{' '}
          <Link
            to="/my-space/notes"
            onClick={handleBackToNotes}
            className="text-green-800 font-medium underline hover:text-green-900"
          >
            Back to My Notes
          </Link>
        </div>
      )}

      {/* Add/Edit Form */}
      {showAddForm && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            {editingNote ? 'Edit Note' : 'Add New Note'}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Enter note title..."
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <input
                  type="text"
                  list="categories"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter or select category..."
                />
                <datalist id="categories">
                  {availableCategories.map(cat => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Color
                </label>
                <select
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {noteColors.map(color => (
                    <option key={color.value} value={color.value}>
                      {color.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Importance
                </label>
                <select
                  value={formData.importance}
                  onChange={(e) => setFormData({ ...formData, importance: e.target.value as Importance })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {importanceOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Content
              </label>
              <div className="border border-gray-300 rounded-lg overflow-hidden">
                <ReactQuill
                  ref={quillRef}
                  theme="snow"
                  value={formData.content}
                  onChange={(value) => setFormData({ ...formData, content: value })}
                  modules={modules}
                  formats={formats}
                  placeholder="Enter note content... Use the toolbar to format your text, add bullets, links, etc. You can type emojis directly (😀 🎉 ✅) or copy-paste them."
                  style={{ minHeight: '200px' }}
                />
              </div>
              <style>{`
                .ql-editor {
                  min-height: 200px;
                }
                .ql-container {
                  font-size: 14px;
                }
              `}</style>
            </div>
            <div className="flex gap-3">
              <button
                onClick={editingNote ? handleUpdateNote : handleAddNote}
                disabled={submitting}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Saving...' : editingNote ? 'Update Note' : 'Create Note'}
              </button>
              <button
                onClick={handleCancel}
                disabled={submitting}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search and Filter */}
      <div className="card p-4 space-y-3">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search notes by title or content..."
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
            Filter by Category:
          </label>
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value)
              setCurrentPage(0)
            }}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">All Categories</option>
            {availableCategories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          {categoryFilter && (
            <button
              onClick={() => {
                setCategoryFilter('')
                setCurrentPage(0)
              }}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Notes List */}
      {loading ? (
        <div className="text-center py-12">
          <div className="text-gray-500">Loading notes...</div>
        </div>
      ) : notes.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-gray-500 text-lg mb-2">
            {searchTerm ? 'No notes found matching your search' : 'No notes yet'}
          </div>
          {!searchTerm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
            >
              Create your first note
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {notes.map((note, index) => {
              const importance = (note as any).importance || 'normal'
              const color = getNoteColor(note.color)

              return (
                <div
                  key={note.id}
                  className={`bg-white ${color.border} border-2 rounded-lg shadow-sm hover:shadow-md transition-all duration-200 note-box`}
                  style={{
                    animation: 'fadeIn 0.3s ease-out',
                    animationDelay: `${index * 0.05}s`,
                    animationFillMode: 'both',
                  }}
                >
                  {/* Header */}
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 flex-1">{note.title}</h3>
                      <div className="flex gap-2 ml-2">
                        <button
                          onClick={() => handleEditClick(note)}
                          className="px-2 py-1 text-sm text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded transition-colors"
                          title="Edit"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteNote(note.id)}
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
                      {getImportanceBadge(importance)}
                    </div>
                  </div>
                  
                  {/* Content */}
                  <div 
                    className="p-4 text-gray-700 note-content"
                    style={{
                      minHeight: '100px',
                      maxHeight: '300px',
                      overflowY: 'auto',
                      lineHeight: '1.6',
                    }}
                    dangerouslySetInnerHTML={{ __html: note.content }}
                  />
                  
                  {/* Footer */}
                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 rounded-b-lg">
                    <div className="text-xs text-gray-500">
                      Created: {formatDate(note.created_at)}
                      {note.updated_at !== note.created_at && (
                        <> • Updated: {formatDate(note.updated_at)}</>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-4">
              <button
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {currentPage + 1} of {totalPages} ({totalNotes} total)
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
