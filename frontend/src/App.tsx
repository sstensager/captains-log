import { useEffect, useState } from 'react'
import LeftRail from './components/LeftRail'
import CenterPane from './components/CenterPane'
import RightRail from './components/RightRail'
import EntitiesPage from './components/EntitiesPage'
import TasksPage from './components/TasksPage'
import type { LogDetail, LogSummary } from './types'
import { fetchLogs } from './api'

type Page = 'logs' | 'entities' | 'tasks'

export default function App() {
  const [page, setPage] = useState<Page>('logs')
  const [logs, setLogs] = useState<LogSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null)
  const [rightRailOpen, setRightRailOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const [entityToShow, setEntityToShow] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<string | null>(null)

  useEffect(() => {
    fetchLogs().then(data => { setLogs(data); setLoading(false) })
  }, [])

  const handleSelectLog = (id: number) => {
    setSelectedLogId(id)
    setComposing(false)
    setRightRailOpen(true)
  }

  const handleNewLog = () => {
    setComposing(true)
    setSelectedLogId(null)
    setRightRailOpen(false)
  }

  const handleCancelCompose = () => {
    setComposing(false)
  }

  const handleLogCreated = (log: LogDetail) => {
    const summary: LogSummary = {
      id: log.id,
      raw_text: log.raw_text,
      created_at: log.created_at,
      source: log.source,
      annotation_types: [],
      tags: [],
    }
    setLogs(prev => [summary, ...prev])
    setSelectedLogId(log.id)
    setComposing(false)
  }

  const handleLogUpdated = (log: LogDetail) => {
    setLogs(prev => prev.map(l =>
      l.id === log.id ? { ...l, raw_text: log.raw_text, tags: log.tags } : l
    ))
  }

  const handleEntityClick = (name: string) => {
    setEntityToShow(name)
    setRightRailOpen(true)
  }

  // Clicking a mention in entities page switches to logs view and selects the log
  const handleSelectLogFromEntity = (id: number) => {
    setPage('logs')
    setSelectedLogId(id)
    setRightRailOpen(false)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden w-full">
      {/* Top nav */}
      <nav className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-gray-200 bg-white">
        <span className="text-sm font-semibold text-gray-800 mr-3">Captain's Log</span>
        {(['logs', 'entities', 'tasks'] as Page[]).map(p => (
          <button
            key={p}
            onClick={() => setPage(p)}
            className={`text-sm px-3 py-1 rounded transition-colors ${
              page === p
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {p === 'logs' ? 'Logs' : p === 'entities' ? 'People & Places' : 'Todos'}
          </button>
        ))}
      </nav>

      {/* Page content */}
      <div className="flex flex-1 min-h-0 bg-gray-50">
        {page === 'logs' ? (
          <>
            <LeftRail
              logs={logs}
              loading={loading}
              selectedLogId={selectedLogId}
              onSelectLog={handleSelectLog}
              onNewLog={handleNewLog}
              onLogsChange={setLogs}
              activeTag={activeTag}
              onTagClick={setActiveTag}
            />
            <CenterPane
              selectedLogId={selectedLogId}
              composing={composing}
              onNewLog={handleNewLog}
              onCancelCompose={handleCancelCompose}
              onLogCreated={handleLogCreated}
              onLogUpdated={handleLogUpdated}
              onToggleRightRail={() => setRightRailOpen(o => !o)}
              rightRailOpen={rightRailOpen}
              onEntityClick={handleEntityClick}
              onTagClick={setActiveTag}
            />
            <RightRail
              open={rightRailOpen}
              selectedLogId={selectedLogId}
              onClose={() => setRightRailOpen(false)}
              entityToShow={entityToShow}
              onSelectLog={handleSelectLog}
            />
          </>
        ) : page === 'entities' ? (
          <EntitiesPage onSelectLog={handleSelectLogFromEntity} />
        ) : (
          <TasksPage onSelectLog={handleSelectLogFromEntity} />
        )}
      </div>
    </div>
  )
}
