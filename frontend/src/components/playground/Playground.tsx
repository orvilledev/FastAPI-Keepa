import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useUser } from '../../contexts/UserContext'
import { canAccessPlayground } from '../../lib/playground/access'
import {
  getPlaygroundTool,
  listPlaygroundToolsForUser,
  loadSelectedPlaygroundToolIds,
  saveSelectedPlaygroundToolIds,
} from '../../lib/playground/catalog'
import { getPlaygroundRunner } from '../../lib/playground/runners'
import {
  clearLegacyPlaygroundIndexedDb,
  isValidPlaygroundUserScope,
  normalizePlaygroundUserScope,
} from '../../lib/playground/storage'
import PendingToolCard from './PendingToolCard'
import PlaygroundFileToolCard from './PlaygroundFileToolCard'

/**
 * Personal Testing Playground — each allowed user has an independent view.
 * Tools with runners: upload same inputs as the live app → run → report → typed downloads.
 */
export default function Playground() {
  const { userInfo, authUser, isSuperadmin, hasKeepaAccess, userInfoLoading } = useUser()
  const email = userInfo?.email || authUser?.email || null
  const displayName = (userInfo?.display_name || '').trim()
  const allowed = canAccessPlayground(email, isSuperadmin)
  const userScope = useMemo(() => normalizePlaygroundUserScope(email), [email])
  const scopeReady = isValidPlaygroundUserScope(userScope)

  const availableTools = useMemo(
    () => listPlaygroundToolsForUser(hasKeepaAccess),
    [hasKeepaAccess],
  )

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pickerId, setPickerId] = useState('')
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    clearLegacyPlaygroundIndexedDb()
  }, [])

  useEffect(() => {
    if (!allowed || !scopeReady) {
      setSelectedIds([])
      setHydrated(false)
      return
    }
    setHydrated(false)
    setSelectedIds([])
    const loaded = loadSelectedPlaygroundToolIds(userScope).filter((id) =>
      availableTools.some((t) => t.id === id),
    )
    setSelectedIds(loaded)
    setHydrated(true)
  }, [allowed, scopeReady, userScope, availableTools])

  const persistSelected = useCallback(
    (ids: string[]) => {
      if (!scopeReady) return
      setSelectedIds(ids)
      saveSelectedPlaygroundToolIds(userScope, ids)
    },
    [scopeReady, userScope],
  )

  const addableTools = useMemo(
    () => availableTools.filter((t) => !selectedIds.includes(t.id)),
    [availableTools, selectedIds],
  )

  useEffect(() => {
    if (addableTools.length === 0) {
      setPickerId('')
      return
    }
    if (!pickerId || !addableTools.some((t) => t.id === pickerId)) {
      setPickerId(addableTools[0].id)
    }
  }, [addableTools, pickerId])

  const handleAddTool = () => {
    setPickerError(null)
    if (!scopeReady) {
      setPickerError('Sign in with your email to use your personal playground.')
      return
    }
    if (!pickerId) {
      setPickerError('Choose a tool from the dropdown.')
      return
    }
    if (selectedIds.includes(pickerId)) {
      setPickerError('That tool is already in your test set.')
      return
    }
    if (!availableTools.some((t) => t.id === pickerId)) {
      setPickerError('That tool is not available for your account.')
      return
    }
    persistSelected([...selectedIds, pickerId])
  }

  const handleRemoveTool = (toolId: string) => {
    persistSelected(selectedIds.filter((id) => id !== toolId))
  }

  if (userInfoLoading || (allowed && scopeReady && !hydrated)) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#404040] border-t-transparent" />
      </div>
    )
  }

  if (!allowed) {
    return <Navigate to="/dashboard" replace />
  }

  if (!scopeReady) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100">
        Sign in with your email to open your personal Testing Playground. Each allowed user has a
        separate view and fixtures.
      </div>
    )
  }

  const ownerLabel = displayName || email || userScope

  return (
    <div className="mx-auto max-w-3xl space-y-6" key={userScope}>
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-content-primary">
          Testing Playground
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-content-muted">
          Personal sandbox for{' '}
          <span className="font-medium text-gray-800 dark:text-content-primary">{ownerLabel}</span>
          {email && displayName ? (
            <span className="text-gray-500"> ({email})</span>
          ) : null}
          . Upload the same file types as the live tool, run a test, then download the expected
          output type(s). Independent from other testers.
        </p>
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-100">
        Individual view — each allowed user keeps their own playground data. New tools follow the
        same pattern: matching input → Run test → success report → download(s) for that tool’s
        expected file type(s).
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100">
        Uploaded files persist across refresh for you until replaced. Test outputs clear on refresh —
        re-run for a fresh snapshot of the app at that date and time.
      </div>

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-content-muted">
          Add a tool to test
        </h2>
        <p className="text-sm text-gray-600 dark:text-content-secondary">
          Available now: FNSKU Labels and Tracking Extractor.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={pickerId}
            onChange={(e) => {
              setPickerId(e.target.value)
              setPickerError(null)
            }}
            disabled={addableTools.length === 0}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-surface dark:text-content-primary sm:min-w-[14rem] sm:flex-1"
          >
            {addableTools.length === 0 ? (
              <option value="">All available tools are already added</option>
            ) : (
              addableTools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {getPlaygroundRunner(t) ? '' : ' (runner coming soon)'}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            disabled={addableTools.length === 0 || !pickerId}
            onClick={handleAddTool}
            className="rounded-lg bg-[#404040] px-4 py-2 text-sm font-medium text-white hover:bg-[#2e2e2e] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
          >
            Add tool
          </button>
        </div>
        {pickerError && (
          <p className="text-sm text-red-700 dark:text-red-300">{pickerError}</p>
        )}
      </section>

      {selectedIds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-border dark:text-content-muted">
          No tools in your test set yet. Pick one from the dropdown and click Add tool.
        </div>
      ) : (
        <div className="space-y-4">
          {selectedIds.map((id) => {
            const tool = getPlaygroundTool(id)
            if (!tool) return null
            if (getPlaygroundRunner(tool)) {
              return (
                <PlaygroundFileToolCard
                  key={`${userScope}::${tool.id}`}
                  tool={tool}
                  userScope={userScope}
                  onRemoveTool={handleRemoveTool}
                />
              )
            }
            return (
              <PendingToolCard
                key={`${userScope}::${tool.id}`}
                tool={tool}
                onRemoveTool={handleRemoveTool}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
