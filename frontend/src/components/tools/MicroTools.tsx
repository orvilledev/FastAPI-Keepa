import { useCallback, useEffect, useState } from 'react'
import { toolsApi } from '../../services/api'
import type { MicroToolRecord } from '../../types'
import {
  MICRO_TOOLS,
  TESTING_MATERIALS_SECTION_LABEL,
  WORK_SHEET_TEMPLATE_SECTION_LABEL,
  isTestingMaterialTool,
  isWorkSheetTemplateTool,
} from '../../constants/microTools'
import type { MicroTool as StaticMicroTool } from '../../constants/microTools'
import { useUser } from '../../contexts/UserContext'
import { downloadBlob, parseMicroToolDownloadResponse } from '../../utils/downloadLinkedFile'

const DEFAULT_ACTION = 'Open tool'

type ExtraLinkRow = { label: string; url: string }

const emptyForm = () => ({
  name: '',
  description: '',
  url: '',
  actionLabel: '',
  tagsStr: '',
  extraLinks: [] as ExtraLinkRow[],
})

export default function MicroTools() {
  const { userInfo } = useUser()
  const currentUserId = userInfo?.id ?? null
  const [apiTools, setApiTools] = useState<MicroToolRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const loadTools = useCallback(async () => {
    setLoadError(null)
    try {
      const data = await toolsApi.getMicroTools()
      setApiTools(data)
    } catch (e: unknown) {
      console.error(e)
      setLoadError('Could not load Micro Tools. If this persists, confirm the database migration has been applied.')
      setApiTools([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTools()
  }, [loadTools])

  const resetForm = () => {
    setForm(emptyForm())
    setEditingId(null)
    setFormError(null)
    setShowForm(false)
  }

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setFormError(null)
    setShowForm(true)
  }

  const openEdit = (t: MicroToolRecord) => {
    setEditingId(t.id)
    setForm({
      name: t.name,
      description: t.description ?? '',
      url: t.url,
      actionLabel: t.action_label ?? '',
      tagsStr: (t.tags ?? []).join(', '),
      extraLinks:
        t.extra_links && t.extra_links.length > 0
          ? t.extra_links.map((l) => ({ label: l.label, url: l.url }))
          : [],
    })
    setFormError(null)
    setShowForm(true)
  }

  const parsePayload = () => {
    const tags = form.tagsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const extra_links = form.extraLinks
      .map((r) => ({
        label: r.label.trim(),
        url: r.url.trim(),
      }))
      .filter((r) => r.label && r.url)
    return {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      url: form.url.trim(),
      action_label: form.actionLabel.trim() || undefined,
      tags,
      extra_links,
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const payload = parsePayload()
    if (!payload.name) {
      setFormError('Name is required.')
      return
    }
    if (!payload.url) {
      setFormError('Link URL is required.')
      return
    }

    setSaving(true)
    try {
      if (editingId) {
        await toolsApi.updateMicroTool(editingId, payload)
      } else {
        await toolsApi.createMicroTool(payload)
      }
      await loadTools()
      resetForm()
    } catch (err: unknown) {
      console.error(err)
      setFormError('Save failed. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this Micro Tool?')) return
    try {
      await toolsApi.deleteMicroTool(id)
      if (editingId === id) resetForm()
      await loadTools()
    } catch (err) {
      console.error(err)
      window.alert('Could not delete this tool.')
    }
  }

  const addLinkRow = () => {
    setForm((f) => ({ ...f, extraLinks: [...f.extraLinks, { label: '', url: '' }] }))
  }

  const updateLinkRow = (index: number, field: keyof ExtraLinkRow, value: string) => {
    setForm((f) => {
      const next = [...f.extraLinks]
      next[index] = { ...next[index], [field]: value }
      return { ...f, extraLinks: next }
    })
  }

  const removeLinkRow = (index: number) => {
    setForm((f) => ({
      ...f,
      extraLinks: f.extraLinks.filter((_, i) => i !== index),
    }))
  }

  const handleDownloadTemplate = async (tool: MicroToolRecord) => {
    setDownloadingId(tool.id)
    try {
      const response = await toolsApi.downloadMicroToolFile(tool.id)
      const { blob, filename } = parseMicroToolDownloadResponse(
        response.data as Blob,
        response.headers as Record<string, string | undefined>,
        tool.name,
      )
      downloadBlob(blob, filename)
    } catch (err) {
      console.error(err)
      window.alert('Could not download this file. Try again or contact an admin.')
    } finally {
      setDownloadingId(null)
    }
  }

  const renderCard = (tool: StaticMicroTool) => (
    <article
      key={`static-${tool.id}`}
      className="card p-6 flex flex-col h-full border border-gray-200/80 shadow-sm"
    >
      <div className="flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Built-in</p>
        <h2 className="text-xl font-semibold text-gray-900 mt-1">{tool.name}</h2>
        <p className="mt-2 text-sm text-gray-600 leading-relaxed">{tool.description}</p>
        {tool.tags && tool.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {tool.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <a
          href={tool.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex justify-center items-center rounded-lg bg-[#404040] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#2d2d2d] transition-colors"
        >
          {tool.actionLabel ?? DEFAULT_ACTION}
        </a>
        {tool.links && tool.links.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {tool.links.map((link) => (
              <a
                key={link.url + link.label}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#81B81D] font-medium hover:underline"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </article>
  )

  const renderApiCard = (
    t: MicroToolRecord,
    variant: 'default' | 'testingMaterial' | 'workSheetTemplate' = 'default',
  ) => {
    const tags = t.tags ?? []
    const links = t.extra_links ?? []
    const isOwner = currentUserId !== null && t.user_id === currentUserId
    const isTestingMaterial = variant === 'testingMaterial'
    const isWorkSheetTemplate = variant === 'workSheetTemplate'
    const isDarkCard = isTestingMaterial || isWorkSheetTemplate

    return (
      <article
        key={t.id}
        className={
          isWorkSheetTemplate
            ? 'flex h-full flex-col rounded-xl border border-blue-400/40 bg-blue-600 p-6 text-white shadow-xl'
            : isTestingMaterial
              ? 'flex h-full flex-col rounded-xl border border-white/20 bg-[#404040] p-6 text-white shadow-xl'
              : 'card flex h-full flex-col border border-gray-200/80 p-6 shadow-sm'
        }
      >
        <div className="flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className={`text-xl font-semibold ${isDarkCard ? 'text-white' : 'text-gray-900'}`}>
                {t.name}
              </h2>
              {!isOwner && (
                <p className={`mt-1 text-xs ${isDarkCard ? 'text-white/70' : 'text-gray-500'}`}>
                  Added by a teammate
                </p>
              )}
            </div>
            {isOwner && (
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(t)}
                  className="text-sm font-medium text-[#81B81D] hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(t.id)}
                  className={`text-sm font-medium hover:underline ${
                    isDarkCard ? 'text-red-400' : 'text-red-600'
                  }`}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
          {t.description && (
            <p
              className={`mt-2 text-sm leading-relaxed ${
                isDarkCard ? 'text-white/70' : 'text-gray-600'
              }`}
            >
              {t.description}
            </p>
          )}
          {tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className={
                    isWorkSheetTemplate
                      ? 'inline-flex items-center rounded-md bg-white/20 px-2.5 py-0.5 text-xs font-medium text-white ring-1 ring-white/40'
                      : isTestingMaterial
                        ? 'inline-flex items-center rounded-md bg-[#81B81D]/30 px-2.5 py-0.5 text-xs font-medium text-[#E8F8C8] ring-1 ring-[#81B81D]/85'
                        : 'inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700'
                  }
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {isWorkSheetTemplate ? (
            <button
              type="button"
              onClick={() => void handleDownloadTemplate(t)}
              disabled={downloadingId === t.id}
              className="inline-flex items-center justify-center rounded-lg bg-white/20 px-4 py-2.5 text-sm font-semibold text-white shadow-sm ring-2 ring-white/50 transition-colors hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {downloadingId === t.id ? 'Downloading…' : t.action_label ?? 'Download File'}
            </button>
          ) : (
            <a
              href={t.url}
              target="_blank"
              rel="noopener noreferrer"
              className={
                isTestingMaterial
                  ? 'inline-flex items-center justify-center rounded-lg bg-[#81B81D]/30 px-4 py-2.5 text-sm font-semibold text-[#E8F8C8] shadow-sm ring-2 ring-[#81B81D]/85 transition-colors hover:bg-[#81B81D]/40'
                  : 'inline-flex items-center justify-center rounded-lg bg-[#404040] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2d2d2d]'
              }
            >
              {t.action_label ?? DEFAULT_ACTION}
            </a>
          )}
          {links.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {links.map((link) => (
                <a
                  key={link.url + link.label}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[#81B81D] hover:underline"
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </article>
    )
  }

  const mainTools = apiTools.filter((t) => !isTestingMaterialTool(t) && !isWorkSheetTemplateTool(t))
  const testingMaterialTools = apiTools.filter((t) => isTestingMaterialTool(t))
  const workSheetTemplateTools = apiTools.filter((t) => isWorkSheetTemplateTool(t))
  const hasStatic = MICRO_TOOLS.length > 0
  const hasApi = apiTools.length > 0
  const showEmpty = !loading && !hasStatic && !hasApi && !loadError

  return (
    <div className="space-y-6">
      <div className="card p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Micro Tools</h1>
          </div>
          <button
            type="button"
            onClick={() => (showForm ? resetForm() : openCreate())}
            className="shrink-0 rounded-lg bg-[#404040] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#2d2d2d] transition-colors"
          >
            {showForm ? 'Cancel' : 'Add tool'}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{loadError}</div>
      )}

      {showForm && (
        <form onSubmit={(e) => void handleSubmit(e)} className="card p-6 border border-[#81B81D]/40 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">{editingId ? 'Edit tool' : 'New tool'}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-gray-700">Name *</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-[#81B81D] focus:outline-none focus:ring-1 focus:ring-[#81B81D]"
                placeholder="e.g. Price checker"
                required
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-gray-700">Description</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-[#81B81D] focus:outline-none focus:ring-1 focus:ring-[#81B81D]"
                placeholder="Short summary shown on the card"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-gray-700">Tool URL *</span>
              <input
                type="text"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-[#81B81D] focus:outline-none focus:ring-1 focus:ring-[#81B81D]"
                placeholder="https://..."
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Button label</span>
              <input
                type="text"
                value={form.actionLabel}
                onChange={(e) => setForm((f) => ({ ...f, actionLabel: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-[#81B81D] focus:outline-none focus:ring-1 focus:ring-[#81B81D]"
                placeholder={`Default: ${DEFAULT_ACTION}`}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Tags</span>
              <input
                type="text"
                value={form.tagsStr}
                onChange={(e) => setForm((f) => ({ ...f, tagsStr: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-[#81B81D] focus:outline-none focus:ring-1 focus:ring-[#81B81D]"
                placeholder="Comma-separated, e.g. pricing, internal"
              />
            </label>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-700">Extra links</span>
              <button
                type="button"
                onClick={addLinkRow}
                className="text-sm font-medium text-[#81B81D] hover:underline"
              >
                + Add link
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">Optional documentation or repo links next to the main button.</p>
            <div className="mt-3 space-y-3">
              {form.extraLinks.map((row, index) => (
                <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex-1">
                    <span className="text-xs text-gray-600">Label</span>
                    <input
                      type="text"
                      value={row.label}
                      onChange={(e) => updateLinkRow(index, 'label', e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                      placeholder="Documentation"
                    />
                  </label>
                  <label className="flex-[2]">
                    <span className="text-xs text-gray-600">URL</span>
                    <input
                      type="url"
                      value={row.url}
                      onChange={(e) => updateLinkRow(index, 'url', e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                      placeholder="https://..."
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeLinkRow(index)}
                    className="text-sm text-red-600 hover:underline sm:mb-2"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          {formError && <p className="mt-4 text-sm text-red-600">{formError}</p>}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#81B81D] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-95 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create tool'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Discard
            </button>
          </div>
        </form>
      )}

      {loading && (
        <div className="text-center py-12 text-gray-500">Loading tools…</div>
      )}

      {!loading && mainTools.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">{mainTools.map((t) => renderApiCard(t))}</div>
      )}

      {!loading && testingMaterialTools.length > 0 && (
        <div>
          <h2 className="mb-4 mt-8 text-lg font-semibold text-[#404040]">{TESTING_MATERIALS_SECTION_LABEL}</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {testingMaterialTools.map((t) => renderApiCard(t, 'testingMaterial'))}
          </div>
        </div>
      )}

      {!loading && workSheetTemplateTools.length > 0 && (
        <div>
          <h2 className="mb-4 mt-8 text-lg font-semibold text-[#404040]">{WORK_SHEET_TEMPLATE_SECTION_LABEL}</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {workSheetTemplateTools.map((t) => renderApiCard(t, 'workSheetTemplate'))}
          </div>
        </div>
      )}

      {!loading && hasStatic && (
        <div>
          {hasApi && <h2 className="text-lg font-semibold text-gray-900 mb-4 mt-8">Built-in shortcuts</h2>}
          {!hasApi && <h2 className="text-lg font-semibold text-gray-900 mb-4">Built-in shortcuts</h2>}
          <div className="grid gap-6 md:grid-cols-2">
            {MICRO_TOOLS.map((tool) => renderCard(tool))}
          </div>
        </div>
      )}

      {showEmpty && (
        <div className="card p-8 border border-dashed border-gray-300 bg-gray-50/80">
          <h2 className="text-lg font-semibold text-gray-900">No tools yet</h2>
          <p className="mt-2 text-gray-600">
            Click <strong>Add tool</strong> to add the first team shortcut, or ask your team about optional built-in
            entries in the codebase constants file.
          </p>
        </div>
      )}
    </div>
  )
}
