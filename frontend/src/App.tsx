import { useEffect, useRef, useState } from 'react'
import LeftRail from './components/LeftRail'
import CenterPane from './components/CenterPane'
import EntitiesPage from './components/EntitiesPage'
import TasksPage from './components/TasksPage'
import AskPage from './components/AskPage'
import ListsPage from './components/ListsPage'
import type { LogDetail, LogSummary, TasksActiveFilter, TasksStatusFilter } from './types'
import { fetchLogs } from './api'

type Page = 'logs' | 'entities' | 'tasks' | 'lists' | 'ask'
type MobileView = 'list' | 'detail'
type NavSnapshot = {
  page: Page
  mobileView: MobileView
  selectedLogId: number | null
  entityToNavigate: string | null
}

export default function App() {
  const appRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState<Page>('logs')
  const [logs, setLogs] = useState<LogSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null)
  const [composing, setComposing] = useState(false)
  const [entityToNavigate, setEntityToNavigate] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<MobileView>('list')
  const [editing, setEditing] = useState(false)
  const [pendingEdit, setPendingEdit] = useState(false)
  const [tasksFilter, setTasksFilter] = useState<TasksActiveFilter>(null)
  const [tasksStatusFilter, setTasksStatusFilter] = useState<TasksStatusFilter>('open')
  const [listsInitialId, setListsInitialId] = useState<number | null>(null)

  useEffect(() => {
    fetchLogs().then(data => { setLogs(data); setLoading(false) })
  }, [])

  // ── History API shim for swipe-back on mobile ─────────────────────────────
  // navDepth counts pushState calls; navStackRef stores full state snapshots so
  // each swipe-back can restore the exact prior view (unlimited depth).
  const navDepth = useRef(0)
  const navStackRef = useRef<NavSnapshot[]>([])
  const [prevSnapshot, setPrevSnapshot] = useState<NavSnapshot | null>(null)
  const stateRef = useRef({ page, mobileView, selectedLogId, entityToNavigate })
  stateRef.current = { page, mobileView, selectedLogId, entityToNavigate }

  const restoreFromStack = () => {
    const prev = navStackRef.current.pop()
    const newTop = navStackRef.current[navStackRef.current.length - 1] ?? null
    setPrevSnapshot(newTop)
    if (prev) {
      setPage(prev.page)
      setMobileView(prev.mobileView)
      setSelectedLogId(prev.selectedLogId)
      setEntityToNavigate(prev.entityToNavigate)
    } else {
      setPage('logs')
      setMobileView('list')
      setEntityToNavigate(null)
    }
    setComposing(false)
    setPendingEdit(false)
  }

  useEffect(() => {
    // Seed a base history entry so the first popstate has something to land on
    history.replaceState({ depth: 0 }, '')

    const onPopstate = () => {
      if (navDepth.current > 0) navDepth.current--
      history.replaceState({ depth: navDepth.current }, '')
      restoreFromStack()
    }

    window.addEventListener('popstate', onPopstate)
    return () => window.removeEventListener('popstate', onPopstate)
  }, [])

  const pushNav = () => {
    const snap: NavSnapshot = {
      page: stateRef.current.page,
      mobileView: stateRef.current.mobileView,
      selectedLogId: stateRef.current.selectedLogId,
      entityToNavigate: stateRef.current.entityToNavigate,
    }
    navStackRef.current.push(snap)
    setPrevSnapshot(snap)
    navDepth.current++
    history.pushState({ depth: navDepth.current }, '')
  }

  // iOS Safari: keyboard overlays the viewport without resizing it.
  // visualViewport gives the actual visible area; we size + translate the root
  // element to match so toolbars stay above the keyboard.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const el = appRef.current
      if (!el) return
      el.style.height = `${vv.height}px`
      el.style.transform = `translateY(${vv.offsetTop}px)`
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  const handleSelectLog = (id: number) => {
    pushNav()
    setSelectedLogId(id)
    setComposing(false)
    setMobileView('detail')
  }

  const handleNewLog = () => {
    pushNav()
    setComposing(true)
    setSelectedLogId(null)
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
      user_tags: [],
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

  const handleLogDeleted = (id: number) => {
    setLogs(prev => prev.filter(l => l.id !== id))
    setSelectedLogId(null)
    setMobileView('list')
  }

  const handleEntityClick = (name: string) => {
    pushNav()
    setEntityToNavigate(name)
    setPage('entities')
  }

  const handleSelectLogFromEntity = (id: number, entityName?: string) => {
    pushNav()
    setPage('logs')
    setSelectedLogId(id)
    setEntityToNavigate(entityName ?? null)
    setMobileView('detail')
  }

  const handleSelectLogFromTasks = (id: number) => {
    pushNav()
    setPage('logs')
    setSelectedLogId(id)
    setEntityToNavigate(null)
    setMobileView('detail')
  }

  const handleListCreated = (listId: number) => {
    setPage('lists')
    setListsInitialId(listId)
  }

  const handleSelectLogFromLists = (id: number) => {
    pushNav()
    setPage('logs')
    setSelectedLogId(id)
    setEntityToNavigate(null)
    setMobileView('detail')
  }

  const handleSelectLogFromAsk = (id: number) => {
    pushNav()
    setPage('logs')
    setSelectedLogId(id)
    setEntityToNavigate(null)
    setMobileView('detail')
  }

  const handleEditLogFromTasks = (id: number) => {
    pushNav()
    setPage('logs')
    setSelectedLogId(id)
    setEntityToNavigate(null)
    setMobileView('detail')
    setPendingEdit(true)
  }

  const handleBackFromEntity = () => {
    if (navDepth.current > 0) navDepth.current--
    history.replaceState({ depth: navDepth.current }, '')
    restoreFromStack()
  }

  const handleTagClick = (tag: string | null) => {
    setActiveTag(tag)
    if (tag) { setPage('logs'); setMobileView('list') }
  }

  const NAV_ITEMS: { key: Page; label: string }[] = [
    { key: 'logs', label: 'Logs' },
    { key: 'entities', label: 'People & Places' },
    { key: 'tasks', label: 'Todos' },
    { key: 'lists', label: 'Lists' },
    { key: 'ask', label: 'Ask' },
  ]

  return (
    <div ref={appRef} className="flex flex-col h-[100dvh] overflow-hidden w-full">
      {/* Top nav — desktop only */}
      <nav className="hidden md:flex shrink-0 items-center gap-1 px-4 py-2 border-b border-gray-200 bg-white">
        <span className="text-sm font-semibold text-gray-800 mr-3">CaptainSlog</span>
        {NAV_ITEMS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { pushNav(); setPage(key); setEntityToNavigate(null); setListsInitialId(null); if (key !== 'tasks') { setTasksFilter(null); setTasksStatusFilter('open') } }}
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
                onTagClick={handleTagClick}
              />
            </div>

            {/* Center pane — full screen on mobile when mobileView=detail */}
            <div className={`${mobileView === 'detail' ? 'flex' : 'hidden'} md:flex flex-col flex-1 min-h-0 w-full`}>
              <CenterPane
                selectedLogId={selectedLogId}
                composing={composing}
                hasLogs={logs.length > 0}
                onNewLog={handleNewLog}
                onCancelCompose={handleCancelCompose}
                onLogCreated={handleLogCreated}
                onLogUpdated={handleLogUpdated}
                onLogDeleted={handleLogDeleted}
                onEntityClick={handleEntityClick}
                onTagClick={handleTagClick}
                onBack={() => {
                  if (navDepth.current > 0) navDepth.current--
                  history.replaceState({ depth: navDepth.current }, '')
                  restoreFromStack()
                }}
                crossPageBack={prevSnapshot !== null && prevSnapshot.page !== 'logs'}
                onEditingChange={setEditing}
                autoEdit={pendingEdit}
                onAutoEditConsumed={() => setPendingEdit(false)}
              />
            </div>
          </>
        ) : page === 'entities' ? (
          <EntitiesPage
            onSelectLog={handleSelectLogFromEntity}
            initialEntity={entityToNavigate ?? undefined}
            onBack={prevSnapshot?.page === 'logs' ? handleBackFromEntity : undefined}
          />
        ) : page === 'tasks' ? (
          <TasksPage
            onSelectLog={handleSelectLogFromTasks}
            onEditLog={handleEditLogFromTasks}
            initialFilter={tasksFilter}
            initialStatusFilter={tasksStatusFilter}
            onSnapshot={(f, s) => { setTasksFilter(f); setTasksStatusFilter(s) }}
            onListCreated={handleListCreated}
          />
        ) : page === 'lists' ? (
          <ListsPage initialSelectedId={listsInitialId} onSelectLog={handleSelectLogFromLists} />
        ) : (
          <AskPage onSelectLog={handleSelectLogFromAsk} />
        )}
      </div>

      {/* Bottom nav — mobile only, hidden while composing or editing */}
      <nav className={`md:hidden shrink-0 flex border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] ${composing || editing ? 'hidden' : ''}`}>
        {NAV_ITEMS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { pushNav(); setPage(key); setMobileView('list'); setEntityToNavigate(null); if (key !== 'tasks') { setTasksFilter(null); setTasksStatusFilter('open') } }}
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
