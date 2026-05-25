import { useEffect, useRef, useState } from 'react'
import LogListItem from './LogListItem'
import type { LogSummary, QueryResponse } from '../../types'
import { searchLogs, fetchLogs, naturalLanguageQuery } from '../../api'
import { relativeDate, shortTime } from '../../utils/time'

interface Props {
  logs: LogSummary[]
  loading: boolean
  selectedLogId: number | null
  onSelectLog: (id: number) => void
  onNewLog: () => void
  onLogsChange: (logs: LogSummary[]) => void
  activeTag: string | null
  onTagClick: (tag: string | null) => void
}

function Skeleton() {
  return (
    <div className="px-3 py-3 space-y-2">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-2.5 bg-gray-200 rounded animate-pulse w-16" />
          <div className="h-3 bg-gray-200 rounded animate-pulse w-full" />
          <div className="h-3 bg-gray-200 rounded animate-pulse w-4/5" />
        </div>
      ))}
    </div>
  )
}

function NlqResultItem({
  log,
  active,
  onClick,
}: {
  log: { log_id: number; raw_text: string; created_at: string }
  active: boolean
  onClick: () => void
}) {
  const preview = log.raw_text.slice(0, 120).replace(/\n/g, ' ')
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
        active ? 'bg-gray-200' : 'hover:bg-gray-100'
      }`}
    >
      <div className="text-[11px] text-gray-400 mb-0.5">
        {relativeDate(log.created_at)} · {shortTime(log.created_at)}
      </div>
      <div className="text-xs text-gray-700 leading-snug line-clamp-2">{preview}</div>
    </button>
  )
}

export default function LeftRail({
  logs, loading, selectedLogId, onSelectLog, onNewLog, onLogsChange, activeTag, onTagClick,
}: Props) {
  const [query, setQuery] = useState('')
  const [nlqResult, setNlqResult] = useState<QueryResponse | null>(null)
  const [nlqLoading, setNlqLoading] = useState(false)
  const [nlqError, setNlqError] = useState<string | null>(null)
  const [answerExpanded, setAnswerExpanded] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isNlqMode = nlqResult !== null || nlqLoading

  useEffect(() => {
    // In NLQ mode don't run the normal search debounce
    if (isNlqMode) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (query.trim()) {
        searchLogs(query).then(onLogsChange)
      } else {
        fetchLogs().then(onLogsChange)
      }
    }, 300)
  }, [query, isNlqMode])

  const runNlq = async () => {
    const q = query.trim()
    if (!q) return
    setNlqLoading(true)
    setNlqError(null)
    setNlqResult(null)
    setAnswerExpanded(true)
    try {
      const result = await naturalLanguageQuery(q)
      setNlqResult(result)
    } catch {
      setNlqError('Something went wrong. Try again.')
    } finally {
      setNlqLoading(false)
    }
  }

  const clearNlq = () => {
    setNlqResult(null)
    setNlqError(null)
    setNlqLoading(false)
    fetchLogs().then(onLogsChange)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      runNlq()
    } else if (e.key === 'Escape' && isNlqMode) {
      clearNlq()
    }
  }

  const displayedLogs = activeTag
    ? logs.filter(l => l.tags.includes(activeTag) || l.user_tags.includes(activeTag))
    : logs

  return (
    <div className="w-full md:w-[220px] shrink-0 flex flex-col h-full bg-gray-50 border-r border-gray-200">
      {/* Brand header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
        <div>
          <div className="text-sm font-semibold text-gray-900">Captain's Log</div>
          <div className="text-xs text-gray-400">personal knowledge</div>
        </div>
        <button
          onClick={onNewLog}
          className="w-7 h-7 bg-gray-900 text-white rounded-full flex items-center justify-center text-lg leading-none hover:bg-gray-700 transition-colors"
          title="New log"
        >
          +
        </button>
      </div>

      {/* Search / Ask */}
      <div className="px-3 py-2 border-b border-gray-200">
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search or ask a question…"
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              // Clear NLQ mode if user edits back to a new query
              if (nlqResult || nlqError) {
                setNlqResult(null)
                setNlqError(null)
              }
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 text-sm bg-white border border-gray-200 rounded-md px-3 py-1.5 outline-none focus:border-gray-400 placeholder-gray-400"
          />
          <button
            onClick={isNlqMode ? clearNlq : runNlq}
            disabled={nlqLoading || (!isNlqMode && !query.trim())}
            title={isNlqMode ? 'Clear' : 'Ask'}
            className={`shrink-0 px-2 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-40 ${
              isNlqMode
                ? 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                : 'bg-gray-900 text-white hover:bg-gray-700'
            }`}
          >
            {isNlqMode ? '✕' : '✦'}
          </button>
        </div>
        {!isNlqMode && (
          <p className="text-[10px] text-gray-400 mt-1 px-0.5">↵ to ask · type to search</p>
        )}
      </div>

      {/* Active tag filter */}
      {activeTag && !isNlqMode && (
        <div className="px-3 py-2 border-b border-gray-200">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Filtered by</span>
            <span className="flex items-center gap-1 text-xs bg-gray-900 text-white px-2 py-0.5 rounded">
              {activeTag}
              <button
                onClick={() => onTagClick(null)}
                className="hover:text-gray-300 leading-none ml-0.5"
              >
                ×
              </button>
            </span>
          </div>
        </div>
      )}

      {/* NLQ results */}
      {isNlqMode ? (
        <div className="flex-1 overflow-y-auto">
          {nlqLoading && (
            <div className="px-4 py-6 text-center">
              <div className="text-xs text-gray-400 animate-pulse">Thinking…</div>
            </div>
          )}
          {nlqError && (
            <div className="px-4 py-4 text-xs text-red-500">{nlqError}</div>
          )}
          {nlqResult && (
            <>
              {/* Answer panel */}
              {nlqResult.answer && (
                <div className="mx-2 mt-2 rounded-lg border border-indigo-100 bg-indigo-50 overflow-hidden">
                  <button
                    onClick={() => setAnswerExpanded(e => !e)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left"
                  >
                    <span className="text-[10px] font-medium text-indigo-400 uppercase tracking-wide">Answer</span>
                    <span className="text-indigo-300 text-xs">{answerExpanded ? '▲' : '▼'}</span>
                  </button>
                  {answerExpanded && (
                    <div className="px-3 pb-3 text-xs text-gray-700 leading-relaxed">
                      {nlqResult.answer}
                    </div>
                  )}
                </div>
              )}

              {/* Source logs */}
              {nlqResult.logs.length > 0 ? (
                <div className="px-2 py-2 space-y-1">
                  <div className="px-1 text-[10px] text-gray-400 uppercase tracking-wide mb-1">
                    {nlqResult.logs.length} source {nlqResult.logs.length === 1 ? 'log' : 'logs'}
                  </div>
                  {nlqResult.logs.map(log => (
                    <NlqResultItem
                      key={log.log_id}
                      log={log}
                      active={log.log_id === selectedLogId}
                      onClick={() => onSelectLog(log.log_id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="px-4 py-4 text-xs text-gray-400 italic">No matching logs found.</div>
              )}
            </>
          )}
        </div>
      ) : (
        /* Normal log list */
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1.5">
          {loading ? (
            <Skeleton />
          ) : displayedLogs.length === 0 ? (
            <p className="text-xs text-gray-400 text-center mt-8 px-4">
              {activeTag ? `No logs tagged "${activeTag}"` : query ? 'No results' : 'No logs yet'}
            </p>
          ) : (
            displayedLogs.map(log => (
              <LogListItem
                key={log.id}
                log={log}
                active={log.id === selectedLogId}
                activeTag={activeTag}
                onClick={() => onSelectLog(log.id)}
                onTagClick={onTagClick}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
