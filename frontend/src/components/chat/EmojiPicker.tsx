import { useEffect, useRef } from 'react'

/** Compact built-in picker — no third-party emoji package. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Smileys',
    emojis: [
      '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😴', '😭', '😡', '🤯', '🥳', '😇', '🤩',
      '😅', '😆', '😉', '😋', '😜', '🤪', '🤨', '😐', '😑', '😶', '🙄', '😏', '😣', '😥', '😮', '😯',
    ],
  },
  {
    label: 'Gestures',
    emojis: [
      '👍', '👎', '👏', '🙌', '🙏', '👌', '✌️', '🤞', '🤝', '💪', '👋', '🫶', '❤️', '🔥', '✨', '⭐',
      '💯', '🎉', '🎊', '✅', '❌', '⚠️', '📌', '📎',
    ],
  },
  {
    label: 'Work',
    emojis: [
      '📦', '🚚', '📋', '📝', '📊', '📈', '💻', '🖥️', '📱', '☎️', '📧', '🗓️', '⏰', '🏢', '🛒', '🏷️',
    ],
  },
]

type Props = {
  open: boolean
  onClose: () => void
  onPick: (emoji: string) => void
  /** Anchor the panel above the trigger (composer) or below (message hover). */
  placement?: 'above' | 'below'
  className?: string
}

export default function EmojiPicker({
  open,
  onClose,
  onPick,
  placement = 'above',
  className = '',
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Emoji picker"
      className={`absolute z-30 w-[min(100vw-2rem,18.5rem)] rounded-2xl border border-gray-200 bg-white p-2 shadow-xl dark:border-border dark:bg-surface ${
        placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'
      } ${className}`}
    >
      <div className="max-h-56 space-y-2 overflow-y-auto pr-0.5">
        {EMOJI_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
              {group.label}
            </p>
            <div className="grid grid-cols-8 gap-0.5">
              {group.emojis.map((emoji) => (
                <button
                  key={`${group.label}-${emoji}`}
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-gray-100 dark:hover:bg-surface-hover"
                  onClick={() => {
                    onPick(emoji)
                    onClose()
                  }}
                  aria-label={`Insert ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
