/**
 * PasswordModal - Password prompt modal for protected notes
 */

import React from 'react'

interface PasswordModalProps {
  show: boolean
  passwordInput: string
  passwordError: string | null
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}

export default function PasswordModal({
  show,
  passwordInput,
  passwordError,
  onPasswordChange,
  onSubmit,
  onCancel,
}: PasswordModalProps) {
  if (!show) return null

  return (
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
          onChange={(e) => onPasswordChange(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              onSubmit()
            }
          }}
          placeholder="Enter password..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 mb-4"
          autoFocus
        />
        <div className="flex gap-3">
          <button
            onClick={onSubmit}
            className="flex-1 px-4 py-2 bg-[#0B1020] text-white rounded-lg hover:bg-[#1a2235] transition-colors font-medium"
          >
            Unlock
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
