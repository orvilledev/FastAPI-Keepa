import { MICRO_TOOLS } from '../../constants/microTools'

const DEFAULT_ACTION = 'Open tool'

export default function MicroTools() {
  return (
    <div className="space-y-6">
      <div className="card p-8">
        <h1 className="text-3xl font-bold text-gray-900">Micro Tools</h1>
        <p className="mt-2 text-gray-600 max-w-3xl">
          Shortcuts to external utilities you maintain—open in a new browser tab. Configure the list in{' '}
          <code className="rounded bg-gray-100 px-2 py-0.5 text-sm font-mono text-gray-800">
            frontend/src/constants/microTools.ts
          </code>
          .
        </p>
      </div>

      {MICRO_TOOLS.length === 0 ? (
        <div className="card p-8 border border-dashed border-gray-300 bg-gray-50/80">
          <h2 className="text-lg font-semibold text-gray-900">No tools configured yet</h2>
          <p className="mt-2 text-gray-600">
            Add objects to the <code className="font-mono text-sm">MICRO_TOOLS</code> array. See the commented example
            in the same file for all supported fields (name, description, URL, tags, extra links).
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {MICRO_TOOLS.map((tool) => (
            <article key={tool.id} className="card p-6 flex flex-col h-full border border-gray-200/80 shadow-sm">
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-gray-900">{tool.name}</h2>
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
          ))}
        </div>
      )}
    </div>
  )
}
