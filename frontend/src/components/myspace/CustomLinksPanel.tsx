import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { quickAccessApi } from '../../services/api'
import type { QuickAccessGroup, QuickAccessLink, QuickAccessPerson } from '../../types'
import { getApiErrorDetail } from '../../utils/apiErrorMessage'
import { CUSTOM_LINK_ICON, normalizeExternalUrl } from './toolCatalog'

const TILES = [
  'bg-lime-300 text-[#1c3308]',
  'bg-sky-300 text-[#082033]',
  'bg-amber-300 text-[#3d2a08]',
  'bg-fuchsia-300 text-[#3a1030]',
  'bg-teal-300 text-[#08332c]',
  'bg-orange-300 text-[#3d1a08]',
  'bg-indigo-300 text-[#15103a]',
  'bg-rose-300 text-[#3a1018]',
]

function toolMark(label: string): { initials: string; tile: string } {
  const words = label.trim().split(/\s+/).filter(Boolean)
  const initials = (
    words.length <= 1 ? (words[0] || '?').slice(0, 2) : words.slice(0, 2).map((word) => word[0]).join('')
  ).toUpperCase()
  let hash = 0
  for (const char of label) hash = (hash + char.charCodeAt(0)) % TILES.length
  return { initials, tile: TILES[hash] }
}

const fieldClass =
  'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none ring-[#81B81D]/30 placeholder:text-gray-400 focus:ring-2 dark:border-border dark:bg-surface dark:text-slate-100'

type Props = {
  personalLinks: QuickAccessLink[]
  onPersonalLinksChange: (links: QuickAccessLink[]) => void
  onGroupedLinkCountChange?: (count: number) => void
}

export default function CustomLinksPanel({
  personalLinks,
  onPersonalLinksChange,
  onGroupedLinkCountChange,
}: Props) {
  const [groups, setGroups] = useState<QuickAccessGroup[]>([])
  const [groupsLoaded, setGroupsLoaded] = useState(false)
  const [groupsError, setGroupsError] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupTitle, setGroupTitle] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const [showLinkForm, setShowLinkForm] = useState(false)
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkGroupId, setLinkGroupId] = useState('')
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null)
  const [linkFormError, setLinkFormError] = useState('')

  const [shareGroupId, setShareGroupId] = useState<string | null>(null)
  const [shareQuery, setShareQuery] = useState('')
  const [shareResults, setShareResults] = useState<QuickAccessPerson[]>([])
  const [selectedEmails, setSelectedEmails] = useState<string[]>([])
  const [shareError, setShareError] = useState('')

  const refreshPersonal = async () => {
    const rows = await quickAccessApi.getLinks()
    onPersonalLinksChange(rows)
  }

  const refreshGroups = async () => {
    const rows = await quickAccessApi.getGroups()
    setGroups(rows)
    setGroupsError('')
    setGroupsLoaded(true)
  }

  useEffect(() => {
    void refreshGroups().catch((err) => {
      setGroupsError(getApiErrorDetail(err) || 'Could not load categories.')
    })
  }, [])

  useEffect(() => {
    if (!shareGroupId) return
    const handle = window.setTimeout(() => {
      void quickAccessApi
        .searchPeople(shareQuery.trim())
        .then((rows) => {
          const chosen = new Set(selectedEmails.map((email) => email.toLowerCase()))
          setShareResults(rows.filter((person) => !chosen.has(person.email.toLowerCase())))
        })
        .catch((err) => setShareError(getApiErrorDetail(err) || 'Could not load registered emails.'))
    }, 200)
    return () => window.clearTimeout(handle)
  }, [shareQuery, shareGroupId, selectedEmails])

  const categoryOptions = useMemo(
    () => groups.map((group) => ({ id: group.id, title: group.title })),
    [groups],
  )
  const groupedLinkCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.links.length, 0),
    [groups],
  )

  useEffect(() => {
    if (!groupsLoaded) return
    onGroupedLinkCountChange?.(groupedLinkCount)
  }, [groupedLinkCount, groupsLoaded, onGroupedLinkCountChange])

  const resetLinkForm = () => {
    setLinkTitle('')
    setLinkUrl('')
    setLinkGroupId('')
    setEditingLinkId(null)
    setLinkFormError('')
    setShowLinkForm(false)
  }

  const openShare = (group: QuickAccessGroup) => {
    setShareGroupId(group.id)
    setSelectedEmails(group.members.map((member) => member.email))
    setShareQuery('')
    setShareResults([])
    setShareError('')
  }

  const saveCategory = async (event: FormEvent) => {
    event.preventDefault()
    const title = groupTitle.trim()
    if (!title) return
    setBusyKey('group-create')
    setGroupsError('')
    try {
      await quickAccessApi.createGroup(title)
      setGroupTitle('')
      setShowGroupForm(false)
      await refreshGroups()
    } catch (err) {
      setGroupsError(getApiErrorDetail(err) || 'Could not create category.')
    } finally {
      setBusyKey(null)
    }
  }

  const saveRename = async (groupId: string) => {
    const title = renameValue.trim()
    if (!title) return
    setBusyKey(`rename:${groupId}`)
    try {
      const updated = await quickAccessApi.renameGroup(groupId, title)
      setGroups((prev) => prev.map((group) => (group.id === groupId ? updated : group)))
      setRenamingId(null)
    } catch (err) {
      setGroupsError(getApiErrorDetail(err) || 'Could not rename category.')
    } finally {
      setBusyKey(null)
    }
  }

  const removeCategory = async (group: QuickAccessGroup) => {
    if (!confirm(`Delete “${group.title}” and every link in it?`)) return
    setBusyKey(`group:${group.id}`)
    try {
      await quickAccessApi.deleteGroup(group.id)
      setGroups((prev) => prev.filter((item) => item.id !== group.id))
      if (shareGroupId === group.id) setShareGroupId(null)
    } catch (err) {
      setGroupsError(getApiErrorDetail(err) || 'Could not delete category.')
    } finally {
      setBusyKey(null)
    }
  }

  const saveShares = async (groupId: string) => {
    setBusyKey(`share:${groupId}`)
    setShareError('')
    try {
      const updated = await quickAccessApi.shareGroup(groupId, selectedEmails)
      setGroups((prev) => prev.map((group) => (group.id === groupId ? updated : group)))
      setShareGroupId(null)
    } catch (err) {
      setShareError(getApiErrorDetail(err) || 'Could not update sharing.')
    } finally {
      setBusyKey(null)
    }
  }

  const saveLink = async (event: FormEvent) => {
    event.preventDefault()
    const title = linkTitle.trim()
    const url = normalizeExternalUrl(linkUrl)
    if (!title) {
      setLinkFormError('Title is required.')
      return
    }
    if (!url || (!url.startsWith('/') && !/^https?:\/\//i.test(url))) {
      setLinkFormError('Enter a valid URL.')
      return
    }
    setBusyKey('link-save')
    setLinkFormError('')
    try {
      if (editingLinkId) {
        await quickAccessApi.updateLink(editingLinkId, {
          title,
          url,
          icon: CUSTOM_LINK_ICON,
          group_id: linkGroupId || null,
          place_in_group: true,
        })
      } else {
        await quickAccessApi.createLink({
          title,
          url,
          icon: CUSTOM_LINK_ICON,
          group_id: linkGroupId || null,
        })
      }
      resetLinkForm()
      await Promise.all([refreshPersonal(), refreshGroups()])
    } catch (err) {
      setLinkFormError(getApiErrorDetail(err) || 'Could not save link.')
    } finally {
      setBusyKey(null)
    }
  }

  const removeLink = async (link: QuickAccessLink) => {
    if (!confirm('Remove this link?')) return
    setBusyKey(`link:${link.id}`)
    try {
      await quickAccessApi.deleteLink(link.id)
      await Promise.all([refreshPersonal(), refreshGroups()])
    } catch (err) {
      setGroupsError(getApiErrorDetail(err) || 'Could not delete link.')
    } finally {
      setBusyKey(null)
    }
  }

  const startEdit = (link: QuickAccessLink) => {
    setEditingLinkId(link.id)
    setLinkTitle(link.title)
    setLinkUrl(link.url)
    setLinkGroupId(link.group_id || '')
    setLinkFormError('')
    setShowLinkForm(true)
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setShowGroupForm((open) => !open)
            setGroupTitle('')
          }}
          className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#404040] shadow-sm ring-1 ring-gray-200 hover:bg-gray-50 dark:bg-surface dark:text-slate-100 dark:ring-border"
        >
          New category
        </button>
        <button
          type="button"
          onClick={() => {
            resetLinkForm()
            setShowLinkForm(true)
          }}
          className="rounded-full bg-[#81B81D] px-4 py-2 text-xs font-semibold text-[#1c3308] shadow-sm hover:bg-[#6fa018]"
        >
          Add link
        </button>
      </div>

      {groupsError && (
        <p role="alert" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {groupsError}
        </p>
      )}

      {showGroupForm && (
        <form onSubmit={saveCategory} className="flex flex-wrap items-center gap-2 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-gray-200/80 dark:bg-surface dark:ring-border">
          <input
            value={groupTitle}
            onChange={(event) => setGroupTitle(event.target.value)}
            className={`${fieldClass} min-w-[16rem] flex-1`}
            placeholder="Category title, e.g. Ledger"
            autoFocus
          />
          <button
            type="submit"
            disabled={busyKey === 'group-create'}
            className="rounded-full bg-[#81B81D] px-4 py-2 text-xs font-semibold text-[#1c3308] disabled:opacity-60"
          >
            Create
          </button>
        </form>
      )}

      {showLinkForm && (
        <form onSubmit={saveLink} className="space-y-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-gray-200/80 dark:bg-surface dark:ring-border">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Title</label>
            <input value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} className={fieldClass} placeholder="e.g. Seller Central" autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">URL</label>
            <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} className={fieldClass} placeholder="https://…" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Category</label>
            <select
              value={linkGroupId}
              onChange={(event) => setLinkGroupId(event.target.value)}
              className={fieldClass}
            >
              <option value="">Personal — only you</option>
              {categoryOptions.map((group) => (
                <option key={group.id} value={group.id}>{group.title}</option>
              ))}
            </select>
          </div>
          {linkFormError && <p className="text-sm text-red-600">{linkFormError}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busyKey === 'link-save'} className="rounded-full bg-[#81B81D] px-4 py-1.5 text-xs font-semibold text-[#1c3308] disabled:opacity-60">
              {editingLinkId ? 'Save' : 'Add'}
            </button>
            <button type="button" onClick={resetLinkForm} className="rounded-md px-3 py-1.5 text-xs text-gray-500">
              Cancel
            </button>
          </div>
        </form>
      )}

      {personalLinks.length === 0 && groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#81B81D]/40 bg-[#81B81D]/5 px-4 py-8 text-center">
          <p className="text-sm font-medium text-[#404040] dark:text-slate-100">No custom links yet.</p>
          <p className="mt-1 text-sm text-gray-500">Add a link, or make a category and share it with registered accounts.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {personalLinks.length > 0 && (
            <CategoryBlock title="Personal" subtitle="Only you can see these">
              <LinkGrid links={personalLinks} busyKey={busyKey} onEdit={startEdit} onRemove={removeLink} />
            </CategoryBlock>
          )}

          {groups.map((group) => (
            <CategoryBlock
              key={group.id}
              title={group.title}
              subtitle={
                group.is_owner
                  ? group.members.length
                    ? `Shared with ${group.members.length}`
                    : 'Not shared yet'
                  : `Shared by ${group.owner_name || group.owner_email}`
              }
              actions={
                group.is_owner ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => openShare(group)} className="rounded-full bg-[#404040] px-3 py-1 text-[11px] font-semibold text-white">
                      Share
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(group.id)
                        setRenameValue(group.title)
                      }}
                      className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-medium text-gray-600"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === `group:${group.id}`}
                      onClick={() => void removeCategory(group)}
                      className="rounded-full px-3 py-1 text-[11px] font-medium text-gray-400 hover:text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      resetLinkForm()
                      setLinkGroupId(group.id)
                      setShowLinkForm(true)
                    }}
                    className="rounded-full bg-[#81B81D] px-3 py-1 text-[11px] font-semibold text-[#1c3308]"
                  >
                    Add a link
                  </button>
                )
              }
            >
              {renamingId === group.id && (
                <form
                  className="mb-3 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void saveRename(group.id)
                  }}
                >
                  <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className={fieldClass} />
                  <button type="submit" className="rounded-full bg-[#81B81D] px-3 text-xs font-semibold text-[#1c3308]">Save</button>
                </form>
              )}

              {group.members.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {group.members.map((member) => (
                    <span key={member.user_id} className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-gray-600 dark:bg-surface-muted">
                      {member.display_name || member.email}
                    </span>
                  ))}
                </div>
              )}

              {shareGroupId === group.id && (
                <div className="mb-4 space-y-3 rounded-2xl bg-gray-50 p-3 dark:bg-surface-muted">
                  <p className="text-xs text-gray-500">Choose registered accounts. They can add links to this category.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedEmails.map((email) => (
                      <button
                        key={email}
                        type="button"
                        onClick={() => setSelectedEmails((prev) => prev.filter((item) => item !== email))}
                        className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#404040] ring-1 ring-gray-200"
                      >
                        {email} ×
                      </button>
                    ))}
                  </div>
                  <input
                    value={shareQuery}
                    onChange={(event) => setShareQuery(event.target.value)}
                    className={fieldClass}
                    placeholder="Search registered emails"
                  />
                  {shareResults.length > 0 && (
                    <ul className="max-h-48 overflow-auto rounded-xl bg-white ring-1 ring-gray-200 dark:bg-surface dark:ring-border">
                      {shareResults.map((person) => (
                        <li key={person.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedEmails((prev) =>
                                prev.some((email) => email.toLowerCase() === person.email.toLowerCase())
                                  ? prev
                                  : [...prev, person.email],
                              )
                              setShareQuery('')
                            }}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[#81B81D]/10"
                          >
                            <span className="font-medium text-[#404040] dark:text-slate-100">{person.display_name || person.email}</span>
                            <span className="truncate text-xs text-gray-400">{person.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {shareError && <p className="text-sm text-red-600">{shareError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyKey === `share:${group.id}`}
                      onClick={() => void saveShares(group.id)}
                      className="rounded-full bg-[#81B81D] px-4 py-1.5 text-xs font-semibold text-[#1c3308] disabled:opacity-60"
                    >
                      Save sharing
                    </button>
                    <button type="button" onClick={() => setShareGroupId(null)} className="text-xs text-gray-500">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {group.links.length === 0 ? (
                <p className="text-sm text-gray-400">No links in this category yet.</p>
              ) : (
                <LinkGrid links={group.links} busyKey={busyKey} onEdit={startEdit} onRemove={removeLink} showAuthor />
              )}
            </CategoryBlock>
          ))}
        </div>
      )}
    </section>
  )
}

function CategoryBlock({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string
  subtitle: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-gray-200/80 dark:bg-surface dark:ring-border sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#404040] dark:text-slate-100">{title}</h2>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
        {actions}
      </div>
      {children}
    </div>
  )
}

function LinkGrid({
  links,
  busyKey,
  onEdit,
  onRemove,
  showAuthor = false,
}: {
  links: QuickAccessLink[]
  busyKey: string | null
  onEdit: (link: QuickAccessLink) => void
  onRemove: (link: QuickAccessLink) => void
  showAuthor?: boolean
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {links.map((link) => {
        const mark = toolMark(link.title)
        const canEdit = link.can_edit !== false
        return (
          <li key={link.id} className="rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-100 dark:bg-surface-muted dark:ring-border">
            <div className="flex items-start gap-3">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${mark.tile}`}>
                {mark.initials}
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={normalizeExternalUrl(link.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-sm font-semibold text-[#404040] hover:text-[#5a8a12] dark:text-slate-100"
                >
                  {link.title}
                </a>
                <p className="mt-0.5 truncate font-mono text-[11px] text-gray-400">{link.url}</p>
                {showAuthor && (link.added_by_name || link.added_by_email) && (
                  <p className="mt-1 text-[11px] text-gray-400">Added by {link.added_by_name || link.added_by_email}</p>
                )}
                {canEdit && (
                  <div className="mt-3 flex gap-2 text-xs">
                    <button type="button" onClick={() => onEdit(link)} className="rounded-full bg-white px-2.5 py-1 font-medium text-gray-600 ring-1 ring-gray-200">
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === `link:${link.id}`}
                      onClick={() => onRemove(link)}
                      className="rounded-full px-2.5 py-1 font-medium text-gray-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
