import type { PlaygroundToolDef } from '../../lib/playground/catalog'

type Props = {
  tool: PlaygroundToolDef
  onRemoveTool: (toolId: string) => void
}

/** Placeholder card for sidebar tools that do not have a sandbox runner yet. */
export default function PendingToolCard({ tool, onRemoveTool }: Props) {
  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-content-primary">
            {tool.label}
          </h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-content-muted">
            From Tools → {tool.label} ({tool.path})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Runner coming soon
          </span>
          <button
            type="button"
            onClick={() => onRemoveTool(tool.id)}
            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-border dark:text-content-secondary dark:hover:bg-surface-hover"
          >
            Remove from playground
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-600 dark:text-content-secondary">
        This tool is listed so you can add it to your test set. Upload / Run / Download will appear
        here once a sandbox runner is wired — the live tool at{' '}
        <span className="font-mono text-xs">{tool.path}</span> is unchanged.
      </p>
    </section>
  )
}
