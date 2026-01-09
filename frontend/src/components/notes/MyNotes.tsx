import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { notesApi } from '../../services/api'
import type { Note } from '../../types'

// Lazy load ReactQuill - only loads when the editor is actually needed
const ReactQuill = lazy(() => import('react-quill'))

// Editor loading placeholder
const EditorLoading = () => (
  <div className="border border-gray-300 rounded-lg p-4 min-h-[200px] flex items-center justify-center bg-gray-50">
    <div className="flex flex-col items-center space-y-2">
      <div className="w-8 h-8 border-4 border-[#0B1020] border-t-transparent rounded-full animate-spin"></div>
      <span className="text-gray-500 text-sm">Loading editor...</span>
    </div>
  </div>
)

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

// Move maskContent outside component to prevent recreation on every render
const maskContent = (content: string): string => {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = content
  
  const maskText = (text: string): string => {
    if (!text || text.trim().length === 0) return text
    return text.replace(/([A-Za-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]{6,})/g, (match) => {
      if (
        match.includes('http') || 
        match.includes('www.') || 
        match.includes('://') ||
        match.length < 6 ||
        /^[A-Za-z\s]+$/.test(match)
      ) {
        return match
      }
      if (match.length > 4) {
        const maskedLength = Math.min(match.length - 4, 12)
        return match.substring(0, 2) + '*'.repeat(maskedLength) + match.substring(match.length - 2)
      }
      if (match.length > 2) {
        return match[0] + '*'.repeat(match.length - 2) + match[match.length - 1]
      }
      return '*'.repeat(match.length)
    })
  }
  
  const maskNode = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text
      if (textNode.textContent) {
        textNode.textContent = maskText(textNode.textContent)
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element
      const tagName = element.tagName.toLowerCase()
      if (tagName === 'a' || tagName === 'code' || tagName === 'pre') {
        return
      }
      Array.from(node.childNodes).forEach(child => maskNode(child))
    }
  }
  
  Array.from(tempDiv.childNodes).forEach(child => maskNode(child))
  return tempDiv.innerHTML
}

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
    importance: 'normal' as Importance,
    is_protected: false,
    password: '',
    use_password: false,
    require_password_always: false
  })
  const [revealedNotes, setRevealedNotes] = useState<Set<string>>(new Set())
  const [unlockedNotes, setUnlockedNotes] = useState<Set<string>>(new Set())
  const [sessionUnlockedNotes, setSessionUnlockedNotes] = useState<Set<string>>(new Set()) // Temporary unlock for require_password_always notes
  const [passwordPrompt, setPasswordPrompt] = useState<{ noteId: string; show: boolean; action?: 'view' | 'edit' } | null>(null)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [availableCategories, setAvailableCategories] = useState<string[]>([])

  // Available colors for note borders
  const noteColors = [
    { value: 'yellow', label: 'Yellow', border: 'border-yellow-400' },
    { value: 'pink', label: 'Pink', border: 'border-pink-400' },
    { value: 'blue', label: 'Blue', border: 'border-blue-400' },
    { value: 'green', label: 'Green', border: 'border-green-400' },
    { value: 'orange', label: 'Orange', border: 'border-orange-400' },
    { value: 'orange', label: 'Orange', border: 'border-orange-400' },
    { value: 'red', label: 'Red', border: 'border-red-400' },
    { value: 'teal', label: 'Teal', border: 'border-teal-400' },
    { value: 'gray', label: 'Gray', border: 'border-gray-400' },
    { value: 'indigo', label: 'Indigo', border: 'border-indigo-400' },
  ]
  const [submitting, setSubmitting] = useState(false)
  const [quillCssLoaded, setQuillCssLoaded] = useState(false)
  const quillRef = useRef<ReactQuill>(null)

  const pageSize = 20

  // Dynamically load Quill CSS only when the editor is needed
  useEffect(() => {
    if (showAddForm && !quillCssLoaded) {
      import('react-quill/dist/quill.snow.css').then(() => {
        setQuillCssLoaded(true)
      }).catch(() => {
        // Fallback: add link tag manually
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/react-quill@2.0.0/dist/quill.snow.css'
        document.head.appendChild(link)
        setQuillCssLoaded(true)
      })
    }
  }, [showAddForm, quillCssLoaded])

  const getNoteColor = (colorName: string = 'yellow') => {
    return noteColors.find(c => c.value === colorName) || noteColors[0]
  }

  // Load categories only once on mount (separate from pagination)
  const loadCategories = useCallback(async () => {
    if (availableCategories.length > 0) return // Already loaded
    
    try {
      // Fetch a larger set of notes just once to extract categories
      const response = await notesApi.listNotes(0, 100, undefined, undefined)
      const categories = Array.from(new Set(
        response.notes
          .map(note => note.category)
          .filter((cat): cat is string => !!cat && cat.trim() !== '')
      )).sort()
      setAvailableCategories(categories)
    } catch (err) {
      console.warn('Failed to load categories:', err)
    }
  }, [availableCategories.length])

  // Load categories only once on mount
  useEffect(() => {
    loadCategories()
  }, []) // Empty dependency - only run once

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
      
      setNotes(response.notes || [])
      setTotalNotes(response.total || 0)
      setTotalPages(response.total_pages || 0)
      
      // Update categories from current response (adds any new categories)
      if (response.notes && response.notes.length > 0) {
        const newCategories = response.notes
          .map(note => note.category)
          .filter((cat): cat is string => !!cat && cat.trim() !== '')
        
        if (newCategories.length > 0) {
          setAvailableCategories(prev => {
            const combined = new Set([...prev, ...newCategories])
            return Array.from(combined).sort()
          })
        }
      }
    } catch (err: any) {
      console.error('Failed to load notes:', err)
      console.error('Error details:', {
        message: err?.message,
        response: err?.response,
        status: err?.response?.status,
        data: err?.response?.data
      })
      
      const errorDetail = err?.response?.data?.detail
      let errorMessage = 'Failed to load notes'
      
      // Handle validation errors from FastAPI
      if (Array.isArray(errorDetail)) {
        errorMessage = errorDetail.map((e: any) => e.msg || e.message || String(e)).join(', ')
      } else if (typeof errorDetail === 'string') {
        errorMessage = errorDetail
      } else if (err?.message) {
        errorMessage = err.message
      } else if (err?.response?.status === 401) {
        errorMessage = 'Authentication failed. Please sign in again.'
      } else if (err?.response?.status === 500) {
        errorMessage = 'Server error. Please try again later.'
      } else if (!err?.response) {
        errorMessage = 'Network error. Please check your connection and ensure the backend is running.'
      }
      
      setError(errorMessage)
      setNotes([])
      setTotalNotes(0)
      setTotalPages(0)
    } finally {
      setLoading(false)
    }
  }, [currentPage, searchTerm, categoryFilter, pageSize])

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

    // Validate password if password protection is enabled
    if (formData.use_password) {
      if (!formData.password || formData.password.length < 7) {
        setError('Password must be at least 7 characters long')
        return
      }
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
        is_protected: formData.is_protected,
        password: formData.use_password && formData.password ? formData.password : undefined,
        require_password_always: formData.require_password_always
      })
      setFormData({ title: '', content: '', category: '', color: 'yellow', importance: 'normal', is_protected: false, password: '', use_password: false, require_password_always: false })
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

    // Validate password if password protection is being enabled or updated
    if (formData.use_password) {
      // Only validate if setting a new password (not just keeping existing)
      if (formData.password && formData.password.length > 0 && formData.password.length < 7) {
        setError('Password must be at least 7 characters long')
        return
      }
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
        is_protected: formData.is_protected,
        password: formData.use_password && formData.password ? formData.password : undefined,
        remove_password: !formData.use_password && editingNote.has_password,
        require_password_always: formData.require_password_always
      })
      setEditingNote(null)
      setFormData({ title: '', content: '', category: '', color: 'yellow', importance: 'normal', is_protected: false, password: '', use_password: false, require_password_always: false })
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

  const handleEditClick = async (note: Note) => {
    // Check if note has password protection and requires password always
    const isUnlocked = note.require_password_always 
      ? sessionUnlockedNotes.has(note.id)
      : unlockedNotes.has(note.id)
    
    if (note.has_password && !isUnlocked) {
      setPasswordPrompt({ noteId: note.id, show: true, action: 'edit' })
      setPasswordInput('')
      setPasswordError(null)
      return
    }
    
    setEditingNote(note)
    setFormData({ 
      title: note.title, 
      content: note.content,
      category: note.category || '',
      color: note.color || 'yellow',
      importance: (note as any).importance || 'normal',
      is_protected: note.is_protected || false,
      password: '',
      use_password: note.has_password || false,
      require_password_always: note.require_password_always || false
    })
    setShowAddForm(true)
  }

  const handlePasswordSubmit = async () => {
    if (!passwordPrompt) return

    // Capture values before any state changes to avoid closure issues
    const noteId = passwordPrompt.noteId
    const action = passwordPrompt.action
    const note = notes.find(n => n.id === noteId)

    try {
      setPasswordError(null)
      await notesApi.verifyNotePassword(noteId, passwordInput)

      // Close the modal first
      setPasswordPrompt(null)
      setPasswordInput('')

      // If require_password_always is true, add to sessionUnlockedNotes (temporary)
      // Otherwise, add to unlockedNotes (persistent)
      if (note) {
        if (note.require_password_always) {
          setSessionUnlockedNotes(prev => {
            const newSet = new Set(prev)
            newSet.add(noteId)
            return newSet
          })
        } else {
          setUnlockedNotes(prev => {
            const newSet = new Set(prev)
            newSet.add(noteId)
            return newSet
          })
        }

        // Only open edit form if the password prompt was triggered from edit action
        if (action === 'edit') {
          setEditingNote(note)
          setFormData({
            title: note.title,
            content: note.content,
            category: note.category || '',
            color: note.color || 'yellow',
            importance: (note as any).importance || 'normal',
            is_protected: note.is_protected || false,
            password: '',
            use_password: note.has_password || false,
            require_password_always: note.require_password_always || false
          })
          setShowAddForm(true)
        }
      }
      // If action was 'view' or undefined, just unlock the note (contents will be shown automatically)
    } catch (err: any) {
      setPasswordError(err?.response?.data?.detail || 'Invalid password')
      setPasswordInput('')
    }
  }

  const handlePasswordCancel = () => {
    setPasswordPrompt(null)
    setPasswordInput('')
    setPasswordError(null)
  }

  const handleCancel = () => {
    setShowAddForm(false)
    setEditingNote(null)
    setFormData({ title: '', content: '', category: '', color: 'yellow', importance: 'normal', is_protected: false, password: '', use_password: false, require_password_always: false })
    setError(null)
    setSuccess(null)
  }

  // Memoize masked content to avoid expensive recomputation on every render
  const maskedContentCache = useMemo(() => {
    const cache: Record<string, string> = {}
    notes.forEach(note => {
      if (note.is_protected) {
        cache[note.id] = maskContent(note.content)
      }
    })
    return cache
  }, [notes])

  // Helper function to check if a note is unlocked
  const isNoteUnlocked = useCallback((note: Note): boolean => {
    if (!note.has_password) return true
    return note.require_password_always 
      ? sessionUnlockedNotes.has(note.id)
      : unlockedNotes.has(note.id)
  }, [sessionUnlockedNotes, unlockedNotes])

  // Helper function to get display content for a note
  const getNoteDisplayContent = useCallback((note: Note): string => {
    // For password-protected notes, check if unlocked via password
    if (note.has_password) {
      const isUnlocked = isNoteUnlocked(note)
      if (!isUnlocked) {
        // Note is locked, show masked content
        return maskedContentCache[note.id] || note.content
      }
      // Note is unlocked via password, show full content
      return note.content
    }
    
    // For protected notes without password, use revealedNotes state
    if (note.is_protected && !revealedNotes.has(note.id)) {
      return maskedContentCache[note.id] || note.content
    }
    
    return note.content
  }, [maskedContentCache, revealedNotes, isNoteUnlocked])

  // Helper function to get blur filter for a note
  const getNoteBlurFilter = useCallback((note: Note): string => {
    // For password-protected notes, check if unlocked via password
    if (note.has_password) {
      const isUnlocked = isNoteUnlocked(note)
      return isUnlocked ? 'none' : 'blur(4px)'
    }
    
    // For protected notes without password, use revealedNotes state
    if (note.is_protected && !revealedNotes.has(note.id)) {
      return 'blur(4px)'
    }
    
    return 'none'
  }, [revealedNotes, isNoteUnlocked])

  const toggleReveal = (noteId: string) => {
    setRevealedNotes(prev => {
      const newSet = new Set(prev)
      if (newSet.has(noteId)) {
        newSet.delete(noteId)
      } else {
        newSet.add(noteId)
      }
      return newSet
    })
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
      {/* Password Prompt Modal */}
      {passwordPrompt && passwordPrompt.show && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">🔐 Password Required</h3>
            <p className="text-sm text-gray-600 mb-4">
              This note is password protected. Please enter the password to view or edit it.
            </p>
            {passwordError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-4 text-sm">
                {passwordError}
              </div>
            )}
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value)
                setPasswordError(null)
              }}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handlePasswordSubmit()
                }
              }}
              placeholder="Enter password..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={handlePasswordSubmit}
                className="flex-1 px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors font-medium"
              >
                Unlock
              </button>
              <button
                onClick={handlePasswordCancel}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My Notes</h1>
          <p className="mt-1 text-sm text-gray-500">Create and manage your personal notes with rich text formatting</p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors font-medium"
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
            <div className="space-y-3">
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_protected}
                    onChange={(e) => setFormData({ ...formData, is_protected: e.target.checked })}
                    className="w-4 h-4 text-[#0B1020] border-gray-300 rounded focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    🔒 Enable Content Masking (mask sensitive content)
                  </span>
                </label>
                <p className="text-xs text-gray-500 mt-1 ml-6">
                  When enabled, passwords and sensitive data will be masked with asterisks when viewing
                </p>
              </div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.use_password}
                    onChange={(e) => {
                      const newUsePassword = e.target.checked
                      setFormData({ 
                        ...formData, 
                        use_password: newUsePassword,
                        require_password_always: newUsePassword ? formData.require_password_always : false
                      })
                    }}
                    className="w-4 h-4 text-[#0B1020] border-gray-300 rounded focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    🔐 Enable Password Protection
                  </span>
                </label>
                <p className="text-xs text-gray-500 mt-1 ml-6">
                  When enabled, a password will be required to view or edit this note
                </p>
              </div>
              {formData.use_password && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className={`w-full px-3 py-2 pr-10 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                          formData.password && formData.password.length > 0 && formData.password.length < 7
                            ? 'border-red-300 bg-red-50'
                            : 'border-gray-300'
                        }`}
                        placeholder="Enter password for this note (minimum 7 characters)..."
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                        title={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? "👁️" : "👁️‍🗨️"}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        // Generate a strong password: 16 characters with mix of uppercase, lowercase, numbers, and safe symbols
                        // Using only safe symbols that won't cause issues with validation or encoding
                        const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
                        const lowercase = 'abcdefghijklmnopqrstuvwxyz'
                        const numbers = '0123456789'
                        const symbols = '!@#$%&*+-=?'
                        const allChars = uppercase + lowercase + numbers + symbols
                        
                        let password = ''
                        // Ensure at least one of each type
                        password += uppercase[Math.floor(Math.random() * uppercase.length)]
                        password += lowercase[Math.floor(Math.random() * lowercase.length)]
                        password += numbers[Math.floor(Math.random() * numbers.length)]
                        password += symbols[Math.floor(Math.random() * symbols.length)]
                        
                        // Fill the rest randomly (total 16 characters)
                        for (let i = password.length; i < 16; i++) {
                          password += allChars[Math.floor(Math.random() * allChars.length)]
                        }
                        
                        // Shuffle the password using Fisher-Yates algorithm for better randomness
                        const passwordArray = password.split('')
                        for (let i = passwordArray.length - 1; i > 0; i--) {
                          const j = Math.floor(Math.random() * (i + 1));
                          [passwordArray[i], passwordArray[j]] = [passwordArray[j], passwordArray[i]]
                        }
                        password = passwordArray.join('')
                        
                        // Ensure the password is valid (at least 7 characters, which it always will be)
                        if (password.length >= 7) {
                          setFormData({ ...formData, password })
                          setShowPassword(true) // Show the generated password
                        }
                      }}
                      className="px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors font-medium text-sm whitespace-nowrap"
                      title="Generate a strong password"
                    >
                      🔐 Generate
                    </button>
                  </div>
                  {formData.password && formData.password.length > 0 && formData.password.length < 7 && (
                    <p className="text-xs text-red-600 mt-1">
                      Password must be at least 7 characters long
                    </p>
                  )}
                  {formData.password && formData.password.length >= 7 && (
                    <p className="text-xs text-green-600 mt-1">
                      ✓ Password meets requirements
                    </p>
                  )}
                </div>
              )}
              {formData.use_password && (
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.require_password_always}
                      onChange={(e) => setFormData({ ...formData, require_password_always: e.target.checked })}
                      className="w-4 h-4 text-[#0B1020] border-gray-300 rounded focus:ring-indigo-500"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      🔐 Require Password Even for Owner (Optional)
                    </span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1 ml-6">
                    When enabled, you will need to enter the password every time you view this note, even if you created it
                  </p>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Content
              </label>
              <div className="border border-gray-300 rounded-lg overflow-hidden">
                <Suspense fallback={<EditorLoading />}>
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
                </Suspense>
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
                className="px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="mt-4 px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors font-medium"
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
                  draggable
                  onDragStart={(e) => {
                    // Only allow dragging from the header area, not from content
                    const target = e.target as HTMLElement
                    const contentArea = e.currentTarget.querySelector('.note-content')
                    const headerArea = e.currentTarget.querySelector('.note-header')
                    const isInContent = contentArea && (contentArea.contains(target) || contentArea === target)
                    const isInHeader = headerArea && (headerArea.contains(target) || headerArea === target)
                    
                    // Only allow dragging if clicking in header, not in content
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
                    const targetNoteId = note.id
                    
                    if (draggedNoteId !== targetNoteId) {
                      // Note reordering functionality - can be implemented later if needed
                      console.log('Note reorder:', draggedNoteId, 'to', targetNoteId)
                    }
                  }}
                  onMouseDown={(e) => {
                    // Prevent card dragging when clicking in content area
                    const target = e.target as HTMLElement
                    const contentArea = e.currentTarget.querySelector('.note-content')
                    const isInContent = contentArea && (contentArea.contains(target) || contentArea === target)
                    
                    if (isInContent) {
                      // Disable dragging for the card when interacting with content
                      e.currentTarget.setAttribute('draggable', 'false')
                    }
                  }}
                  onMouseUp={(e) => {
                    // Re-enable dragging when mouse is released
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
                          onClick={() => handleEditClick(note)}
                          className="px-2 py-1 text-sm text-[#0B1020] hover:text-indigo-800 hover:bg-indigo-50 rounded transition-colors"
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
                  <div className="p-4">
                    {note.has_password && (note.require_password_always ? !sessionUnlockedNotes.has(note.id) : !unlockedNotes.has(note.id)) ? (
                      <div className="text-center py-8">
                        <div className="text-4xl mb-4">🔐</div>
                        <p className="text-gray-600 mb-4">This note is password protected</p>
                        {note.require_password_always && (
                          <p className="text-xs text-gray-500 mb-2">Password required even for owner</p>
                        )}
                        <button
                          onClick={() => {
                            setPasswordPrompt({ noteId: note.id, show: true, action: 'view' })
                            setPasswordInput('')
                            setPasswordError(null)
                          }}
                          className="px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors font-medium"
                        >
                          Enter Password to View
                        </button>
                      </div>
                    ) : (
                      <>
                        {note.is_protected && !note.has_password && (
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              🔒 Protected Content
                            </span>
                            <button
                              onClick={() => toggleReveal(note.id)}
                              className="text-xs text-[#0B1020] hover:text-indigo-800 font-medium"
                            >
                              {revealedNotes.has(note.id) ? '👁️ Hide' : '👁️‍🗨️ Reveal'}
                            </button>
                          </div>
                        )}
                        {note.is_protected && note.has_password && note.require_password_always && (
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              🔐 Password Required (Always)
                            </span>
                            {sessionUnlockedNotes.has(note.id) ? (
                              <button
                                onClick={() => {
                                  // Hide without requiring password
                                  setSessionUnlockedNotes(prev => {
                                    const newSet = new Set(prev)
                                    newSet.delete(note.id)
                                    return newSet
                                  })
                                }}
                                className="text-xs text-[#0B1020] hover:text-indigo-800 font-medium"
                              >
                                👁️ Hide
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setPasswordPrompt({ noteId: note.id, show: true, action: 'view' })
                                  setPasswordInput('')
                                  setPasswordError(null)
                                }}
                                className="text-xs text-[#0B1020] hover:text-indigo-800 font-medium"
                              >
                                👁️ Reveal
                              </button>
                            )}
                          </div>
                        )}
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
                            filter: getNoteBlurFilter(note),
                            transition: 'filter 0.3s ease',
                          }}
                          dangerouslySetInnerHTML={{ __html: getNoteDisplayContent(note) }}
                        />
                      </>
                    )}
                  </div>
                  
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
