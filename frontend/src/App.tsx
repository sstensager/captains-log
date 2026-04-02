import { useEffect, useState } from 'react'
import LeftRail from './components/LeftRail'
import CenterPane from './components/CenterPane'
import RightRail from './components/RightRail'
import EntitiesPage from './components/EntitiesPage'
import TasksPage from './components/TasksPage'
import type { LogDetail, LogSummary } from './types'
import { fetchLogs } from './api'

type Page = 'logs' | 'entities' | 'tasks'
type MobileView = 'list' | 'detail' | 'context'

export default function App() {
  const [page, setPage] = useState<Page>('logs')
  const [logs, setLogs] = useState<LogSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null)
  const [rightRailOpen, setRightRailOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const [entityToShow, setEntityToShow] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [logRefreshKey, setLogRefreshKey] = useState(0)
  const [mobileView, setMobileView] = useState<MobileView>('list')

  useEffect(() => {
    fetchLogs().then(data => { setLogs(data); setLoading(false) })
  }, [])

  const handleSelectLog = (id: number) => {
    setSelectedLogId(id)
    setComposing(false)
    setRightRailOpen(true)
    setMobileView('detail')
  }

  const handleNewLog = () => {
    setComposing(true)
    setSelectedLogId(null)
    setRightRailOpen(false)
    setMobileView('detail')
  }

  const handleCancelCompose = () => {
    setComposing(false)
    setMobileView('list')
  }

  const handleLogCreated = (log: LogDetail) => {
    const summary: LogSummary = {
      id: log.id,
      raw_text: log.raw_text,
      created_at: log.created_at,
      updated_at: log.updated_at ?? null,
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
    setMobileView('context')
  }

  const handleSelectLogFromEntity = (id: number) => {
    setPage('logs')
    setSelectedLogId(id)
    setRightRailOpen(false)
    setMobileView('detail')
  }

  const handleToggleRightRail = () => {
    setRightRailOpen(o => !o)
    setMobileView('context')
  }

  const NAV_ITEMS: { key: Page; label: string }[] = [
    { key: 'logs', label: 'Logs' },
    { key: 'entities', label: 'Nodes' },
    { key: 'tasks', label: 'Todos' },
  ]

  return (
    <div className="flex flex-col h-screen overflow-hidden w-full">
      {/* Top nav — desktop only */}
      <nav className="hidden md:flex shrink-0 items-center gap-1 px-4 py-2 border-b border-gray-200 bg-white">
        <span className="text-sm font-semibold text-gray-800 mr-3">Captain's Log</span>
        {NAV_ITEMS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setPage(key)}
            className={`text-sm px-3 py-1 rounded transition-colors ${
              page === key ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Page content */}
      <div className="flex flex-1 min-h-0 bg-gray-50">
        {page === 'logs' ? (
          <>
            {/* Left rail — full screen on mobile when mobileView=list */}
            <div className={`${mobileView === 'list' ? 'flex' : 'hidden'} md:flex flex-col min-h-0 w-full md:w-auto`}>
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
            </div>

            {/* Center pane — full screen on mobile when mobileView=detail */}
            <div className={`${mobileView === 'detail' ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-h-0 w-full`}>
              <CenterPane
                selectedLogId={selectedLogId}
                composing={composing}
                onNewLog={handleNewLog}
                onCancelCompose={handleCancelCompose}
                onLogCreated={handleLogCreated}
                onLogUpdated={handleLogUpdated}
                onToggleRightRail={handleToggleRightRail}
                rightRailOpen={rightRailOpen}
                onEntityClick={handleEntityClick}
                onTagClick={setActiveTag}
                refreshKey={logRefreshKey}
                onBack={() => setMobileView('list')}
              />
            </div>

            {/* Right rail — full screen on mobile when mobileView=context */}
            <div className={`${mobileView === 'context' ? 'flex' : 'hidden'} md:flex flex-col min-h-0 w-full md:w-auto`}>
              <RightRail
                open={rightRailOpen || mobileView === 'context'}
                selectedLogId={selectedLogId}
                onClose={() => setRightRailOpen(false)}
                entityToShow={entityToShow}
                onSelectLog={handleSelectLog}
                refreshKey={logRefreshKey}
                onEntityMerged={() => setLogRefreshKey(k => k + 1)}
                onLogChanged={() => setLogRefreshKey(k => k + 1)}
                onBack={() => setMobileView('detail')}
              />
            </div>
          </>
        ) : page === 'entities' ? (
          <EntitiesPage onSelectLog={handleSelectLogFromEntity} />
        ) : (
          <TasksPage onSelectLog={handleSelectLogFromEntity} />
        )}
      </div>

      {/* Bottom nav — mobile only */}
      <nav className="md:hidden shrink-0 flex border-t border-gray-200 bg-white">
        {NAV_ITEMS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setPage(key); setMobileView('list') }}
            className={`flex-1 py-3 text-xs font-medium transition-colors ${
              page === key ? 'text-gray-900' : 'text-gray-400'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
