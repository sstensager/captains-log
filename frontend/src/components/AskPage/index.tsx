import { useEffect, useRef, useState } from 'react'
import type { QueryHistoryItem, QueryResponse } from '../../types'
import { fetchQueryHistory, naturalLanguageQuery } from '../../api'
import { relativeDate, shortTime } from '../../utils/time'

interface Props {
  onSelectLog: (id: number) => void
}

function SourceLogCard({
  log,
  onClick,
}: {
  log: { log_id: number; raw_text: string; created_at: string }
  onClick: () => void
}) {
  const preview = log.raw_text.slice(0, 200).replace(/\n/g, ' ')
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm transition-all"
    >
      <div className="text-[11px] text-gray-400 mb-1">
        {relativeDate(log.created_at)} · {shortTime(log.created_at)}
      </div>
      <div className="text-sm text-gray-700 leading-snug line-clamp-3">{preview}</div>
    </button>
  )
}

function HistoryItem({
  item,
  active,
  onClick,
}: {
  item: QueryHistoryItem
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
        active ? 'bg-indigo-50 text-indigo-800' : 'hover:bg-gray-100 text-gray-700'
      }`}
    >
      <div className="text-xs font-medium leading-snug line-clamp-2">{item.question}</div>
      <div className="text-[10px] text-gray-400 mt-0.5">{relativeDate(item.created_at)}</div>
    </button>
  )
}

export default function AskPage({ onSelectLog }: Props) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<QueryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<QueryHistoryItem[]>([])
  const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchQueryHistory().then(setHistory)
    inputRef.current?.focus()
  }, [])

  const runQuery = async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setResult(null)
    setActiveHistoryId(null)
    try {
      const res = await naturalLanguageQuery(trimmed)
      setResult(res)
      // Refresh history to include the new entry
      fetchQueryHistory().then(h => {
        setHistory(h)
        setActiveHistoryId(h[0]?.id ?? null)
      })
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const loadHistoryItem = (item: QueryHistoryItem) => {
    setQuery(item.question)
    setActiveHistoryId(item.id)
    setError(null)
    // Show the stored answer and reconstruct a minimal result for display
    setResult({
      answer: item.answer,
      logs: [],
      plan: {},
    })
    // We don't re-run the query; just show the cached answer.
    // To re-run, user can hit Enter.
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      runQuery(query)
    }
  }

  const clear = () => {
    setQuery('')
    setResult(null)
    setError(null)
    setActiveHistoryId(null)
    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* History sidebar — desktop only */}
      <div className="hidden md:flex flex-col w-56 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">History</div>
        </div>
        {history.length === 0 ? (
          <p className="px-4 py-4 text-xs text-gray-400 italic">No queries yet</p>
        ) : (
          <div className="py-2 px-2 space-y-0.5">
            {history.map(item => (
              <HistoryItem
                key={item.id}
                item={item}
                active={item.id === activeHistoryId}
                onClick={() => loadHistoryItem(item)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl w-full mx-auto px-4 py-8 flex flex-col gap-6">

          {/* Query input */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                placeholder="Ask anything about your logs…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 text-base bg-white border border-gray-300 rounded-xl px-4 py-3 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 placeholder-gray-400 shadow-sm"
              />
              {result || error ? (
                <button
                  onClick={clear}
                  className="px-4 py-3 rounded-xl bg-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-300 transition-colors shrink-0"
                >
                  ✕
                </button>
              ) : (
                <button
                  onClick={() => runQuery(query)}
                  disabled={loading || !query.trim()}
                  className="px-4 py-3 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-40 transition-colors shrink-0"
                >
                  {loading ? '…' : 'Ask'}
                </button>
              )}
            </div>
            {!result && !loading && !error && (
              <p className="text-xs text-gray-400 px-1">↵ to ask</p>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div className="text-sm text-gray-400 animate-pulse px-1">Thinking…</div>
          )}

          {/* Error */}
          {error && (
            <div className="text-sm text-red-500 px-1">{error}</div>
          )}

          {/* Result */}
          {result && !loading && (
            <div className="flex flex-col gap-4">
              {/* Answer */}
              {result.answer && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4">
                  <div className="text-[10px] font-semibold text-indigo-400 uppercase tracking-widest mb-2">Answer</div>
                  <p className="text-sm text-gray-800 leading-relaxed">{result.answer}</p>
                </div>
              )}

              {/* Source logs */}
              {result.logs.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-1">
                    {result.logs.length} source {result.logs.length === 1 ? 'log' : 'logs'}
                  </div>
                  {result.logs.map(log => (
                    <SourceLogCard
                      key={log.log_id}
                      log={log}
                      onClick={() => onSelectLog(log.log_id)}
                    />
                  ))}
                </div>
              )}

              {result.answer && result.logs.length === 0 && (
                <p className="text-xs text-gray-400 italic px-1">No source logs found.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
