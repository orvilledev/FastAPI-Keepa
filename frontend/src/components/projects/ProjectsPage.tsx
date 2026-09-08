import { useCallback, useEffect, useMemo, useState } from 'react'
import { projectsApi, getApiBaseUrl } from '../../services/api'
import type { ProjectRecord, ProjectStatus } from '../../types'
import { getApiErrorDetail } from '../../utils/apiErrorMessage'

export const PROJECT_STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'complete', label: 'Complete' },
  { value: 'deployed', label: 'Deployed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const FILTERS: { value: 'all' | ProjectStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  ...PROJECT_STATUS_OPTIONS,
]

function statusLabel(status: ProjectStatus): string {
  return PROJECT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
}

function statusBadgeClass(status: ProjectStatus): string {
  switch (status) {
    case 'planning':
      return 'bg-slate-100 text-slate-700 border-slate-200'
    case 'in_progress':
      return 'bg-sky-50 text-sky-800 border-sky-200'
    case 'on_hold':
      return 'bg-amber-50 text-amber-800 border-amber-200'
    case 'complete':
      return 'bg-green-50 text-green-800 border-green-200'
    case 'deployed':
      return 'bg-[#81B81D]/15 text-[#3f6a0e] border-[#81B81D]/40'
    case 'cancelled':
      return 'bg-red-50 text-red-700 border-red-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function loadErrorMessage(err: unknown): string {
  const detail = getApiErrorDetail(err)
  if (detail) {
    if (/relation.*does not exist|create_projects|migration/i.test(detail)) {
      return `${detail} Run backend/database/migrations/create_projects.sql in the Supabase SQL Editor.`
    }
    return detail
  }
  return `Could not load projects. Check your connection (API: ${getApiBaseUrl()}).`
}

type FormState = {
  name: string
  notes: string
  status: ProjectStatus
}

const emptyForm = (): FormState => ({
  name: '',
  notes: '',
  status: 'in_progress',
})

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [filter, setFilter] = useState<'all' | ProjectStatus>('all')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadProjects = useCallback(async () => {
    setListError('')
    try {
      const rows = await projectsApi.list()
      setProjects(rows)
    } catch (err) {
      setListError(loadErrorMessage(err))
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  const closeForm = useCallback(() => {
    if (saving) return
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm())
    setFormError('')
  }, [saving])

  useEffect(() => {
    if (!showForm) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) closeForm()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [showForm, saving, closeForm])

  const counts = useMemo(() => {
    const byStatus = Object.fromEntries(PROJECT_STATUS_OPTIONS.map((option) => [option.value, 0])) as Record<
      ProjectStatus,
      number
    >
    for (const project of projects) {
      byStatus[project.status] += 1
    }
    return byStatus
  }, [projects])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return projects.filter((project) => {
      if (filter !== 'all' && project.status !== filter) return false
      if (!query) return true
      const haystack = `${project.name} ${project.notes ?? ''}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [projects, filter, search])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setFormError('')
    setShowForm(true)
  }

  const openEdit = (project: ProjectRecord) => {
    setEditingId(project.id)
    setForm({
      name: project.name,
      notes: project.notes ?? '',
      status: project.status,
    })
    setFormError('')
    setShowForm(true)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const name = form.name.trim()
    if (!name) {
      setFormError('Name is required.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      if (editingId) {
        const updated = await projectsApi.update(editingId, {
          name,
          notes: form.notes.trim(),
          status: form.status,
        })
        setProjects((prev) => [updated, ...prev.filter((item) => item.id !== updated.id)])
      } else {
        const created = await projectsApi.create({
          name,
          notes: form.notes.trim() || undefined,
          status: form.status,
        })
        setProjects((prev) => [created, ...prev])
      }
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm())
    } catch (err) {
      setFormError(getApiErrorDetail(err) || 'Save failed. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleStatusChange = async (project: ProjectRecord, nextStatus: ProjectStatus) => {
    if (project.status === nextStatus) return
    setBusyId(project.id)
    setListError('')
    try {
      const updated = await projectsApi.update(project.id, { status: nextStatus })
      setProjects((prev) => [updated, ...prev.filter((item) => item.id !== updated.id)])
    } catch (err) {
      setListError(getApiErrorDetail(err) || 'Could not update status.')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (project: ProjectRecord) => {
    if (!window.confirm(`Delete “${project.name}”? This cannot be undone.`)) return
    setBusyId(project.id)
    setListError('')
    try {
      await projectsApi.delete(project.id)
      setProjects((prev) => prev.filter((item) => item.id !== project.id))
      if (editingId === project.id) closeForm()
    } catch (err) {
      setListError(getApiErrorDetail(err) || 'Could not delete this project.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Projects</h1>
          <p className="mt-1 text-sm text-gray-500">
            Log work you are currently doing, keep notes, and mark items complete, deployed, or on hold.
          </p>
        </div>
        <button type="button" onClick={openCreate} className="btn-primary w-full shrink-0 sm:w-auto">
          Add project
        </button>
      </div>

      {listError && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">{listError}</div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => {
            const count = item.value === 'all' ? projects.length : counts[item.value]
            const active = filter === item.value
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-[#404040] bg-[#404040] text-white'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {item.label}
                <span className={`ml-1.5 ${active ? 'text-white/80' : 'text-gray-400'}`}>{count}</span>
              </button>
            )
          })}
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or notes…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#404040] focus:ring-2 focus:ring-[#404040]/20 lg:w-72"
          aria-label="Search projects"
        />
      </div>

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#404040] border-t-transparent" />
        </div>
      ) : visible.length === 0 ? (
        <div className="card px-4 py-12 text-center text-sm text-gray-500">
          {projects.length === 0
            ? 'No projects yet. Click Add project to log the first one.'
            : 'No projects match this filter or search.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visible.map((project) => {
            const busy = busyId === project.id
            return (
              <article key={project.id} className="card flex h-full flex-col border border-gray-200/80 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 text-lg font-semibold text-gray-900">{project.name}</h2>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(project.status)}`}
                  >
                    {statusLabel(project.status)}
                  </span>
                </div>
                {project.notes ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-600">{project.notes}</p>
                ) : (
                  <p className="mt-3 text-sm italic text-gray-400">No notes yet.</p>
                )}
                <p className="mt-4 text-xs text-gray-400">
                  Updated {formatWhen(project.updated_at)}
                  {project.completed_at ? ` · Closed ${formatWhen(project.completed_at)}` : ''}
                </p>
                <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-gray-600">
                    <span className="shrink-0">Status</span>
                    <select
                      value={project.status}
                      disabled={busy}
                      onChange={(event) => void handleStatusChange(project, event.target.value as ProjectStatus)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-[#404040] focus:ring-2 focus:ring-[#404040]/20 disabled:opacity-50"
                      aria-label={`Status for ${project.name}`}
                    >
                      {PROJECT_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex shrink-0 gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openEdit(project)}
                      className="text-sm font-medium text-[#404040] hover:underline disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDelete(project)}
                      className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                    >
                      {busy ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-form-title"
            className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl sm:p-6"
          >
            <h2 id="project-form-title" className="text-lg font-semibold text-gray-900">
              {editingId ? 'Edit project' : 'Add project'}
            </h2>
            <form className="mt-4 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Name</span>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#404040] focus:ring-2 focus:ring-[#404040]/20"
                  maxLength={200}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Status</span>
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, status: event.target.value as ProjectStatus }))
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-[#404040] focus:ring-2 focus:ring-[#404040]/20"
                >
                  {PROJECT_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  rows={6}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#404040] focus:ring-2 focus:ring-[#404040]/20"
                  placeholder="What you are working on, blockers, next steps…"
                  maxLength={10000}
                />
              </label>
              {formError && (
                <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</p>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={saving}
                  onClick={closeForm}
                  className="btn-secondary w-full sm:w-auto"
                >
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn-primary w-full sm:w-auto">
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
