/**
 * Note utility functions
 */

export type Importance = 'low' | 'normal' | 'high' | 'urgent'

export const importanceOptions: { value: Importance; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-700' },
  { value: 'normal', label: 'Normal', color: 'bg-blue-100 text-blue-700' },
  { value: 'high', label: 'High', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-100 text-red-700' },
]

export const noteColors = [
  { value: 'yellow', label: 'Yellow', border: 'border-yellow-400' },
  { value: 'pink', label: 'Pink', border: 'border-pink-400' },
  { value: 'blue', label: 'Blue', border: 'border-blue-400' },
  { value: 'green', label: 'Green', border: 'border-green-400' },
  { value: 'orange', label: 'Orange', border: 'border-orange-400' },
  { value: 'red', label: 'Red', border: 'border-red-400' },
  { value: 'teal', label: 'Teal', border: 'border-teal-400' },
  { value: 'gray', label: 'Gray', border: 'border-gray-400' },
  { value: 'indigo', label: 'Indigo', border: 'border-indigo-400' },
]

export const getNoteColor = (colorName: string = 'yellow') => {
  return noteColors.find((c) => c.value === colorName) || noteColors[0]
}

export const getImportanceOption = (importance: string) => {
  return importanceOptions.find((opt) => opt.value === importance) || importanceOptions[1]
}

export const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export interface NoteFormData {
  title: string
  content: string
  category: string
  color: string
  importance: Importance
  is_protected: boolean
  password: string
  use_password: boolean
  require_password_always: boolean
}

export const initialNoteFormData: NoteFormData = {
  title: '',
  content: '',
  category: '',
  color: 'yellow',
  importance: 'normal',
  is_protected: false,
  password: '',
  use_password: false,
  require_password_always: false,
}

export const generateStrongPassword = (): string => {
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

  // Shuffle using Fisher-Yates algorithm
  const passwordArray = password.split('')
  for (let i = passwordArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[passwordArray[i], passwordArray[j]] = [passwordArray[j], passwordArray[i]]
  }

  return passwordArray.join('')
}

// Quill editor configuration
export const quillModules = {
  toolbar: {
    container: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ script: 'sub' }, { script: 'super' }],
      [{ indent: '-1' }, { indent: '+1' }],
      ['link'],
      [{ color: [] }, { background: [] }],
      ['clean'],
    ],
  },
}

export const quillFormats = [
  'header',
  'bold',
  'italic',
  'underline',
  'strike',
  'list',
  'bullet',
  'script',
  'indent',
  'link',
  'color',
  'background',
]
