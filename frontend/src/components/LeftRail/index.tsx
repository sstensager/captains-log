import { useEffect, useRef, useState } from 'react'
import LogListItem from './LogListItem'
import type { LogSummary } from '../../types'
import { searchLogs, fetchLogs } from '../../api'

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

export default function LeftRail({
  logs, loading, selectedLogId, onSelectLog, onNewLog, onLogsChange, activeTag, onTagClick,
}: Props) {
  const [query, setQuery] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (query.trim()) {
        searchLogs(query).then(onLogsChange)
      } else {
        fetchLogs().then(onLogsChange)
      }
    }, 300)
  }, [query])

  const displayedLogs = activeTag
    ? logs.filter(l => l.tags.includes(activeTag))
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

      {/* Search */}
      <div className="px-3 py-2 border-b border-gray-200">
        <input
          type="text"
          placeholder="Search..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full text-sm bg-white border border-gray-200 rounded-md px-3 py-1.5 outline-none focus:border-gray-400 placeholder-gray-400"
        />
      </div>

      {/* Active tag filter */}
      {activeTag && (
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

      {/* Log list */}
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
    </div>
  )
}
