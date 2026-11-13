import { avatarColor, initials } from './chatUtils'

const SIZES = {
  xs: 'h-4 w-4 text-[8px]',
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
} as const

const DOT_SIZES = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
  lg: 'h-3.5 w-3.5',
} as const

interface ChatAvatarProps {
  id: string
  name: string
  size?: keyof typeof SIZES
  online?: boolean
  title?: string
}

export default function ChatAvatar({ id, name, size = 'md', online, title }: ChatAvatarProps) {
  return (
    <span className="relative inline-flex shrink-0" title={title ?? name}>
      <span
        className={`inline-flex items-center justify-center rounded-full font-semibold text-white ${SIZES[size]} ${avatarColor(id)}`}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      {online !== undefined && size !== 'xs' && (
        <span
          className={`absolute bottom-0 right-0 rounded-full ring-2 ring-white dark:ring-slate-800 ${DOT_SIZES[size]} ${
            online ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-slate-500'
          }`}
          aria-label={online ? 'Online' : 'Offline'}
        />
      )}
    </span>
  )
}

interface GroupAvatarProps {
  members: Array<{ id: string; name: string }>
  size?: 'md' | 'lg'
}

/** Two overlapping initials for group chats. */
export function GroupAvatar({ members, size = 'md' }: GroupAvatarProps) {
  const box = size === 'lg' ? 'h-12 w-12' : 'h-10 w-10'
  const chip = size === 'lg' ? 'h-8 w-8 text-xs' : 'h-7 w-7 text-[11px]'
  const [first, second] = members
  return (
    <span className={`relative inline-flex shrink-0 ${box}`} aria-hidden="true">
      {second && (
        <span
          className={`absolute right-0 top-0 inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-white dark:ring-slate-800 ${chip} ${avatarColor(second.id)}`}
        >
          {initials(second.name)}
        </span>
      )}
      <span
        className={`absolute bottom-0 left-0 inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-white dark:ring-slate-800 ${chip} ${
          first ? avatarColor(first.id) : 'bg-gray-400'
        }`}
      >
        {first ? initials(first.name) : '?'}
      </span>
    </span>
  )
}
