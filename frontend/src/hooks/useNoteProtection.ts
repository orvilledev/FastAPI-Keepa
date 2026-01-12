/**
 * useNoteProtection - Custom hook for note password protection and content masking
 */

import { useState, useCallback, useMemo } from 'react'
import { notesApi } from '../services/api'
import type { Note } from '../types'

// Move maskContent outside to prevent recreation on every render
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
      Array.from(node.childNodes).forEach((child) => maskNode(child))
    }
  }

  Array.from(tempDiv.childNodes).forEach((child) => maskNode(child))
  return tempDiv.innerHTML
}

interface PasswordPromptState {
  noteId: string
  show: boolean
  action?: 'view' | 'edit'
}

export function useNoteProtection(notes: Note[]) {
  // Revealed notes (for protected notes without password)
  const [revealedNotes, setRevealedNotes] = useState<Set<string>>(new Set())
  
  // Unlocked notes via password (persistent during session for non-require-always)
  const [unlockedNotes, setUnlockedNotes] = useState<Set<string>>(new Set())
  
  // Session-unlocked notes (temporary, for require_password_always notes)
  const [sessionUnlockedNotes, setSessionUnlockedNotes] = useState<Set<string>>(new Set())
  
  // Password prompt state
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPromptState | null>(null)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Memoize masked content to avoid expensive recomputation
  const maskedContentCache = useMemo(() => {
    const cache: Record<string, string> = {}
    notes.forEach((note) => {
      if (note.is_protected) {
        cache[note.id] = maskContent(note.content)
      }
    })
    return cache
  }, [notes])

  // Check if a note is unlocked
  const isNoteUnlocked = useCallback(
    (note: Note): boolean => {
      if (!note.has_password) return true
      return note.require_password_always
        ? sessionUnlockedNotes.has(note.id)
        : unlockedNotes.has(note.id)
    },
    [sessionUnlockedNotes, unlockedNotes]
  )

  // Get display content for a note
  const getNoteDisplayContent = useCallback(
    (note: Note): string => {
      // For password-protected notes
      if (note.has_password) {
        const isUnlocked = isNoteUnlocked(note)
        if (!isUnlocked) {
          return maskedContentCache[note.id] || note.content
        }
        return note.content
      }

      // For protected notes without password
      if (note.is_protected && !revealedNotes.has(note.id)) {
        return maskedContentCache[note.id] || note.content
      }

      return note.content
    },
    [maskedContentCache, revealedNotes, isNoteUnlocked]
  )

  // Get blur filter for a note
  const getNoteBlurFilter = useCallback(
    (note: Note): string => {
      // For password-protected notes
      if (note.has_password) {
        const isUnlocked = isNoteUnlocked(note)
        return isUnlocked ? 'none' : 'blur(4px)'
      }

      // For protected notes without password
      if (note.is_protected && !revealedNotes.has(note.id)) {
        return 'blur(4px)'
      }

      return 'none'
    },
    [revealedNotes, isNoteUnlocked]
  )

  // Toggle reveal for non-password protected notes
  const toggleReveal = useCallback((noteId: string) => {
    setRevealedNotes((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(noteId)) {
        newSet.delete(noteId)
      } else {
        newSet.add(noteId)
      }
      return newSet
    })
  }, [])

  // Hide a session-unlocked note
  const hideSessionNote = useCallback((noteId: string) => {
    setSessionUnlockedNotes((prev) => {
      const newSet = new Set(prev)
      newSet.delete(noteId)
      return newSet
    })
  }, [])

  // Show password prompt
  const showPasswordPrompt = useCallback((noteId: string, action: 'view' | 'edit' = 'view') => {
    setPasswordPrompt({ noteId, show: true, action })
    setPasswordInput('')
    setPasswordError(null)
  }, [])

  // Cancel password prompt
  const cancelPasswordPrompt = useCallback(() => {
    setPasswordPrompt(null)
    setPasswordInput('')
    setPasswordError(null)
  }, [])

  // Submit password
  const submitPassword = useCallback(
    async (onSuccess?: (note: Note, action?: 'view' | 'edit') => void) => {
      if (!passwordPrompt) return

      const noteId = passwordPrompt.noteId
      const action = passwordPrompt.action
      const note = notes.find((n) => n.id === noteId)

      try {
        setPasswordError(null)
        await notesApi.verifyNotePassword(noteId, passwordInput)

        // Close modal first
        setPasswordPrompt(null)
        setPasswordInput('')

        // Add to appropriate unlocked set
        if (note) {
          if (note.require_password_always) {
            setSessionUnlockedNotes((prev) => {
              const newSet = new Set(prev)
              newSet.add(noteId)
              return newSet
            })
          } else {
            setUnlockedNotes((prev) => {
              const newSet = new Set(prev)
              newSet.add(noteId)
              return newSet
            })
          }

          // Call success callback if provided
          if (onSuccess) {
            onSuccess(note, action)
          }
        }
      } catch (err: any) {
        setPasswordError(err?.response?.data?.detail || 'Invalid password')
        setPasswordInput('')
      }
    },
    [passwordPrompt, passwordInput, notes]
  )

  // Check if password is required to access a note
  const requiresPassword = useCallback(
    (note: Note): boolean => {
      if (!note.has_password) return false
      return note.require_password_always
        ? !sessionUnlockedNotes.has(note.id)
        : !unlockedNotes.has(note.id)
    },
    [sessionUnlockedNotes, unlockedNotes]
  )

  return {
    // State
    revealedNotes,
    unlockedNotes,
    sessionUnlockedNotes,
    passwordPrompt,
    passwordInput,
    passwordError,
    maskedContentCache,

    // Setters
    setPasswordInput,
    setPasswordError,

    // Computed
    isNoteUnlocked,
    getNoteDisplayContent,
    getNoteBlurFilter,
    requiresPassword,

    // Actions
    toggleReveal,
    hideSessionNote,
    showPasswordPrompt,
    cancelPasswordPrompt,
    submitPassword,
  }
}
