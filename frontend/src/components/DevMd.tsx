import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import devMarkdown from '../content/DEV.md?raw'

export default function DevMd() {
  return (
    <div className="card p-8">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-3xl font-bold text-gray-900 mb-4">{children}</h1>,
          h2: ({ children }) => <h2 className="text-2xl font-semibold text-gray-900 mt-8 mb-3">{children}</h2>,
          h3: ({ children }) => <h3 className="text-xl font-semibold text-gray-900 mt-6 mb-2">{children}</h3>,
          p: ({ children }) => <p className="text-gray-700 leading-7 mb-3">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-6 space-y-2 text-gray-700 mb-4">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          table: ({ children }) => (
            <div className="mb-4 overflow-x-auto">
              <table className="min-w-full border border-gray-200 text-left text-sm text-gray-700">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-gray-100 text-gray-900">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-t border-gray-200">{children}</tr>,
          th: ({ children }) => <th className="px-3 py-2 font-semibold">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 align-top">{children}</td>,
          input: ({ type, checked }) =>
            type === 'checkbox' ? (
              <input type="checkbox" checked={Boolean(checked)} readOnly className="mr-2 align-middle" />
            ) : null,
          code: ({ children }) => (
            <code className="rounded bg-gray-100 px-2 py-0.5 text-sm text-gray-800 font-mono">{children}</code>
          ),
        }}
      >
        {devMarkdown}
      </ReactMarkdown>
    </div>
  )
}
