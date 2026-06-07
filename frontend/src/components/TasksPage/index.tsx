import { useEffect, useRef, useState } from 'react'
import { createGeneratedList, fetchAllTasks, patchTask } from '../../api'
import type { TaskEntityRef, TaskOut, TasksActiveFilter, TasksStatusFilter } from '../../types'
import { colorFor } from '../../colors'
import { relativeDate } from '../../utils/time'
import AnnotatedText from '../AnnotatedText'

interface Props {
  onSelectLog: (id: number) => void
  onEditLog?: (id: number) => void
  initialFilter?: TasksActiveFilter
  initialStatusFilter?: TasksStatusFilter
  onSnapshot?: (filter: TasksActiveFilter, statusFilter: TasksStatusFilter) => void
  onListCreated?: (listId: number) => void
}

// ── Snapshot types ────────────────────────────────────────────────────────────
// Groups are computed once when filters change, then frozen.
// Individual task status is read live from `tasks` state.

interface SnapshotSection {
  header: string | null
  taskIds: number[]
}

interface SnapshotGroup {
  key: string
  source_log_id: number | null
  log_preview: string | null
  log_created_at: string | null
  tags: string[]
  entities: TaskEntityRef[]
  sections: SnapshotSection[]
}

type StatusFilter = TasksStatusFilter
type ActiveFilter = TasksActiveFilter

function matchesFilter(task: TaskOut, filter: ActiveFilter): boolean {
  if (!filter) return true
  if (filter.kind === 'tag') return task.tags.includes(filter.value)
  if (filter.kind === 'entity') return task.entities.some(e => e.name === filter.value)
  const q = filter.query.toLowerCase()
  return (
    task.tags.some(t => t.toLowerCase().includes(q)) ||
    task.entities.some(e => e.name.toLowerCase().includes(q))
  )
}

function buildSnapshot(
  tasks: TaskOut[],
  statusFilter: StatusFilter,
  filter: ActiveFilter,
): SnapshotGroup[] {
  const filtered = tasks.filter(t => matchesFilter(t, filter))

  // Build groups preserving task order
  const groupMap = new Map<string, SnapshotGroup>()
  for (const task of filtered) {
    const key = String(task.source_log_id ?? 'none')
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        source_log_id: task.source_log_id,
        log_preview: task.log_preview,
        log_created_at: task.log_created_at,
        tags: task.tags,
        entities: task.entities,
        sections: [],
      })
    }
    const group = groupMap.get(key)!
    const last = group.sections[group.sections.length - 1]
    if (last && last.header === (task.section ?? null)) {
      last.taskIds.push(task.id)
    } else {
      group.sections.push({ header: task.section ?? null, taskIds: [task.id] })
    }
  }

  // Apply status filter at the group level
  return [...groupMap.values()].filter(group => {
    const ids = group.sections.flatMap(s => s.taskIds)
    const groupTasks = ids.map(id => tasks.find(t => t.id === id)).filter(Boolean) as TaskOut[]
    if (statusFilter === 'open') return groupTasks.some(t => t.status !== 'done')
    if (statusFilter === 'done') return groupTasks.every(t => t.status === 'done')
    return true
  })
}


function EntityChip({ entity, onClick }: { entity: TaskEntityRef; onClick?: () => void }) {
  const c = colorFor(entity.type)
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border hover:opacity-75 transition-opacity max-w-[160px]"
      style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
    >
      <span className="w-1.5 h-1.5 shrink-0 rounded-full" style={{ backgroundColor: c.dot }} />
      <span className="truncate">{entity.name}</span>
    </button>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TasksPage({ onSelectLog, onEditLog, initialFilter, initialStatusFilter, onSnapshot, onListCreated }: Props) {
  const [tasks, setTasks] = useState<TaskOut[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatusFilter ?? 'open')
  const [filter, setFilter] = useState<ActiveFilter>(initialFilter ?? null)
  const [searchInput, setSearchInput] = useState(
    initialFilter?.kind === 'search' ? initialFilter.query : ''
  )
  const [snapshotGroups, setSnapshotGroups] = useState<SnapshotGroup[]>([])
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>(
    initialFilter != null ? 'flat' : 'grouped'
  )
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)
  const [organizing, setOrganizing] = useState(false)

  // Keep a ref so we can rebuild the snapshot without adding tasks as a dep
  const tasksRef = useRef<TaskOut[]>([])

  const rebuild = (t: TaskOut[], sf: StatusFilter, f: ActiveFilter) => {
    setSnapshotGroups(buildSnapshot(t, sf, f))
  }

  useEffect(() => {
    fetchAllTasks().then(t => {
      tasksRef.current = t
      setTasks(t)
      rebuild(t, statusFilter, filter)
      setLoading(false)
    })
  }, [])

  // Rebuild snapshot when filters change (not on checkbox toggle)
  const filterKey = `${statusFilter}::${JSON.stringify(filter)}`
  const prevFilterKey = useRef(filterKey)
  useEffect(() => {
    if (prevFilterKey.current !== filterKey && tasksRef.current.length > 0) {
      prevFilterKey.current = filterKey
      rebuild(tasksRef.current, statusFilter, filter)
    }
  }, [filterKey])

  const toggle = (task: TaskOut) => {
    const newStatus = task.status === 'done' ? 'todo' : 'done'
    patchTask(task.id, newStatus).then(updated => {
      const next = tasks.map(t => t.id === updated.id ? { ...t, status: updated.status } : t)
      tasksRef.current = next
      setTasks(next)
      // Snapshot intentionally NOT rebuilt — groups stay visible until filter changes
    })
  }

  // Derived filter options — scoped to tasks matching the current status tab
  const statusMatchingTasks = tasks.filter(t =>
    statusFilter === 'open' ? t.status !== 'done' : t.status === 'done'
  )
  const allTags = [...new Set(statusMatchingTasks.flatMap(t => t.tags))].sort()
  const entityTaskCounts = statusMatchingTasks.reduce<Record<string, number>>((acc, task) => {
    task.entities.forEach(e => { acc[e.name] = (acc[e.name] ?? 0) + 1 })
    return acc
  }, {})
  const allEntities = Object.values(
    statusMatchingTasks.flatMap(t => t.entities).reduce<Record<string, TaskEntityRef>>((acc, e) => {
      acc[e.name] = e; return acc
    }, {})
  ).sort((a, b) => (entityTaskCounts[b.name] ?? 0) - (entityTaskCounts[a.name] ?? 0))

  const handleSearch = (q: string) => {
    setSearchInput(q)
    if (q.trim()) {
      setFilter({ kind: 'search', query: q })
      setViewMode('flat')
    } else {
      setFilter(null)
      setViewMode('grouped')
    }
  }

  const setPill = (kind: 'tag' | 'entity', value: string) => {
    const already = filter?.kind === kind && (filter as any).value === value
    if (already) { setFilter(null); setSearchInput(''); setViewMode('grouped') }
    else { setFilter({ kind, value }); setSearchInput(''); setViewMode('flat') }
  }

  const handleOrganize = async () => {
    if (!filter || filter.kind === 'search' || organizing) return
    setOrganizing(true)
    try {
      const list = await createGeneratedList({ kind: filter.kind, value: filter.value })
      onListCreated?.(list.id)
    } catch (e) {
      console.error('Organize failed', e)
    } finally {
      setOrganizing(false)
    }
  }

  const navigateToLog = (logId: number, editMode: boolean) => {
    onSnapshot?.(filter, statusFilter)
    if (editMode && onEditLog) {
      onEditLog(logId)
    } else {
      onSelectLog(logId)
    }
  }

  // Live counts (always up-to-date even without snapshot rebuild)
  const openCount = tasks.filter(t => t.status !== 'done').length
  const doneCount = tasks.length - openCount

  const activeTag = filter?.kind === 'tag' ? filter.value : null
  const activeEntity = filter?.kind === 'entity' ? filter.value : null

  return (
    <div className="flex flex-col md:flex-row flex-1 min-h-0 min-w-0">
      {/* Filters — sidebar on desktop, compact top bar on mobile */}
      <div className="md:w-[220px] shrink-0 flex flex-col bg-gray-50 border-b md:border-b-0 md:border-r border-gray-200">
        {/* Mobile: compact row with filter button */}
        <div className="flex md:hidden items-center gap-2 px-3 py-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs shrink-0">
            {(['open', 'done'] as StatusFilter[]).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1.5 transition-colors ${
                  statusFilter === s ? 'bg-gray-900 text-white' : 'bg-white text-gray-500'
                }`}
              >
                {s === 'open' ? `Open (${openCount})` : `Done (${doneCount})`}
              </button>
            ))}
          </div>
          <button
            onClick={() => setMobileFilterOpen(true)}
            className={`flex-1 flex items-center gap-1.5 text-sm border rounded-md px-3 py-1.5 text-left transition-colors ${
              filter ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-400'
            }`}
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M7 8h10M10 12h4" />
            </svg>
            <span className="truncate">
              {filter ? (filter.kind === 'search' ? filter.query : filter.value) : 'Filter…'}
            </span>
            {filter && (
              <span
                onClick={e => { e.stopPropagation(); setFilter(null); setSearchInput(''); setViewMode('grouped') }}
                className="ml-auto text-white/70 hover:text-white"
              >×</span>
            )}
          </button>
        </div>

        {/* Mobile: filter sheet */}
        {mobileFilterOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/30" onClick={() => setMobileFilterOpen(false)} />
            {/* Sheet */}
            <div className="relative bg-white rounded-t-2xl shadow-xl flex flex-col max-h-[75vh]">
              <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-gray-100">
                <input
                  type="text"
                  placeholder="Search tags or people…"
                  value={searchInput}
                  autoFocus
                  onChange={e => handleSearch(e.target.value)}
                  className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-md px-3 py-2 outline-none focus:border-gray-400 placeholder-gray-400"
                />
                <button onClick={() => setMobileFilterOpen(false)} className="text-gray-400 text-lg px-1">✕</button>
              </div>
              <div className="overflow-y-auto px-4 py-3 space-y-4">
                {allEntities.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Nodes</div>
                    <div className="flex flex-col gap-1.5">
                      {allEntities.map(entity => {
                        const c = colorFor(entity.type)
                        const isActive = activeEntity === entity.name
                        const count = entityTaskCounts[entity.name] ?? 0
                        return (
                          <button
                            key={entity.name}
                            onClick={() => { setPill('entity', entity.name); setMobileFilterOpen(false) }}
                            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-full border transition-opacity w-full"
                            style={isActive
                              ? { backgroundColor: '#111827', borderColor: '#111827', color: '#fff' }
                              : { backgroundColor: c.bg, borderColor: c.border, color: c.text }
                            }
                          >
                            {!isActive && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />}
                            <span className="flex-1 text-left truncate">{entity.name}</span>
                            <span className={`shrink-0 text-xs font-medium tabular-nums ${isActive ? 'text-white/60' : 'text-gray-400'}`}>{count}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {allTags.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Tags</div>
                    <div className="flex flex-wrap gap-1.5">
                      {allTags.map(tag => (
                        <button
                          key={tag}
                          onClick={() => { setPill('tag', tag); setMobileFilterOpen(false) }}
                          className={`text-sm px-3 py-1 rounded-full transition-colors ${
                            activeTag === tag ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Desktop: full sidebar */}
        <div className="hidden md:flex flex-1 overflow-y-auto py-4 px-3 space-y-4 flex-col">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            {(['open', 'done'] as StatusFilter[]).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`flex-1 py-1.5 transition-colors capitalize ${
                  statusFilter === s ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                {s === 'open' ? `Open · ${openCount}` : `Done · ${doneCount}`}
              </button>
            ))}
          </div>

          <div>
            <input
              type="text"
              placeholder="Search tags or people…"
              value={searchInput}
              onChange={e => handleSearch(e.target.value)}
              className="w-full text-sm bg-white border border-gray-200 rounded-md px-3 py-1.5 outline-none focus:border-gray-400 placeholder-gray-400"
            />
            {(filter?.kind === 'tag' || filter?.kind === 'entity') && (
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-xs text-gray-500">{filter.kind === 'tag' ? 'Tag' : 'Entity'}:</span>
                <span className="flex items-center gap-1 text-xs bg-gray-900 text-white px-2 py-0.5 rounded">
                  {filter.value}
                  <button onClick={() => { setFilter(null); setSearchInput(''); setViewMode('grouped') }} className="hover:text-gray-300 ml-0.5">×</button>
                </span>
              </div>
            )}
          </div>

          {allEntities.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Nodes</div>
              <div className="flex flex-col gap-1">
                {allEntities.map(entity => {
                  const c = colorFor(entity.type)
                  const isActive = activeEntity === entity.name
                  const count = entityTaskCounts[entity.name] ?? 0
                  return (
                    <button
                      key={entity.name}
                      onClick={() => setPill('entity', entity.name)}
                      className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-opacity hover:opacity-75 w-full"
                      style={isActive
                        ? { backgroundColor: '#111827', borderColor: '#111827', color: '#fff' }
                        : { backgroundColor: c.bg, borderColor: c.border, color: c.text }
                      }
                    >
                      {!isActive && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />}
                      <span className="truncate flex-1 text-left">{entity.name}</span>
                      <span className={`shrink-0 text-[10px] font-medium tabular-nums ${isActive ? 'text-white/60' : 'text-gray-400'}`}>{count}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {allTags.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Tags</div>
              <div className="flex flex-wrap gap-1">
                {allTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setPill('tag', tag)}
                    className={`text-xs px-2 py-0.5 rounded transition-colors ${
                      activeTag === tag ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Task groups */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
        {/* View mode toggle + Organize button — only shown when a filter is active */}
        {filter && (
          <div className="flex items-center gap-2 mb-4 max-w-2xl">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {(['flat', 'grouped'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 transition-colors ${
                    viewMode === mode ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {mode === 'flat' ? 'Flat list' : 'By log'}
                </button>
              ))}
            </div>
            {filter.kind !== 'search' && (
              <button
                onClick={handleOrganize}
                disabled={organizing}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
              >
                {organizing ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    Organizing…
                  </>
                ) : (
                  <>✦ Organize</>
                )}
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : snapshotGroups.length === 0 ? (
          <div className="text-sm text-gray-400 mt-8 text-center">
            {tasks.length === 0
              ? 'No todos yet — add [ ] items to any note'
              : statusFilter === 'open'
              ? 'Nothing open — switch to Done to review completed lists'
              : 'No completed lists yet'}
          </div>
        ) : viewMode === 'flat' ? (
          // ── Flat checklist ───────────────────────────────────────────────────
          <div className="w-full max-w-2xl rounded-xl border bg-white shadow-sm overflow-hidden">
            {/* Active filter chip */}
            {filter && (filter.kind === 'entity' || filter.kind === 'tag') && (
              <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
                {filter.kind === 'entity' ? (() => {
                  const entity = allEntities.find(e => e.name === filter.value)
                    ?? statusMatchingTasks.flatMap(t => t.entities).find(e => e.name === filter.value)
                  if (!entity) return <span className="text-xs text-gray-500">{filter.value}</span>
                  const c = colorFor(entity.type)
                  return (
                    <span
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
                      style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
                      {entity.name}
                    </span>
                  )
                })() : (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{filter.value}</span>
                )}
              </div>
            )}
            <div>
              {snapshotGroups.flatMap(group =>
                group.sections.flatMap((section, si) => {
                  const rows = section.taskIds.map(id => {
                    const task = tasks.find(t => t.id === id)
                    if (!task) return null
                    const done = task.status === 'done'
                    return (
                      <div
                        key={id}
                        onClick={() => toggle(task)}
                        className={`flex items-center gap-3 py-2.5 pr-4 border-t border-gray-50 transition-opacity cursor-pointer active:bg-gray-50 ${done ? 'opacity-50' : ''}`}
                        style={{ paddingLeft: `${Math.min(1 + (task.indent ?? 0) * 1.25, 4)}rem` }}
                      >
                        <div
                          className={`w-4 h-4 shrink-0 rounded border text-xs flex items-center justify-center transition-colors ${
                            done ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-400'
                          }`}
                        >
                          {done && '✓'}
                        </div>
                        <span className={`text-sm min-w-0 break-words ${done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                          {task.title}
                        </span>
                      </div>
                    )
                  })
                  return section.header
                    ? [
                        <button
                          key={`${group.key}-s${si}`}
                          onClick={() => group.source_log_id && navigateToLog(group.source_log_id, false)}
                          className="w-full px-4 py-1.5 text-xs text-gray-400 italic bg-gray-50 border-t border-gray-100 text-left hover:bg-gray-100 active:bg-gray-200 transition-colors flex items-center gap-2"
                        >
                          <span className="flex-1 min-w-0"><AnnotatedText text={section.header} /></span>
                          <svg className="w-3 h-3 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>,
                        ...rows,
                      ]
                    : rows
                })
              )}
            </div>
          </div>
        ) : (
          // ── Grouped by log ───────────────────────────────────────────────────
          <div className="w-full max-w-2xl space-y-6">
            {snapshotGroups.map(group => {
              const taskById = (id: number) => tasks.find(t => t.id === id)
              const allTaskIds = group.sections.flatMap(s => s.taskIds)
              const openInGroup = allTaskIds.filter(id => taskById(id)?.status !== 'done').length

              return (
                <div key={group.key} className="rounded-xl border bg-white shadow-sm overflow-hidden">
                  {/* Group header */}
                  <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {group.log_preview && (
                        <div className="text-sm font-medium text-gray-700 truncate">
                          <AnnotatedText text={group.log_preview} />
                        </div>
                      )}
                      {group.log_created_at && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          {relativeDate(group.log_created_at)}
                        </div>
                      )}
                      {(group.entities.length > 0 || group.tags.length > 0) && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {group.entities.map(entity => (
                            <EntityChip key={entity.name} entity={entity} onClick={() => setPill('entity', entity.name)} />
                          ))}
                          {group.tags.map(tag => (
                            <button
                              key={tag}
                              onClick={() => setPill('tag', tag)}
                              className="text-xs text-gray-400 bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded transition-colors"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 shrink-0">
                      {openInGroup}/{allTaskIds.length}
                    </div>
                  </div>

                  {/* Sections */}
                  {group.sections.map((section, si) => (
                    <div key={si}>
                      {section.header && (
                        <button
                          onClick={() => group.source_log_id && navigateToLog(group.source_log_id, true)}
                          className="w-full px-4 py-1.5 text-xs text-gray-400 italic bg-gray-50 border-b border-gray-100 text-left hover:bg-gray-100 active:bg-gray-200 transition-colors flex items-center gap-2"
                        >
                          <span className="flex-1 min-w-0"><AnnotatedText text={section.header} /></span>
                          <svg className="w-3 h-3 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                      )}
                      <div className="divide-y divide-gray-50">
                        {section.taskIds.map(id => {
                          const task = taskById(id)
                          if (!task) return null
                          const done = task.status === 'done'
                          return (
                            <div
                              key={id}
                              onClick={() => toggle(task)}
                              className={`flex items-center gap-3 py-2.5 pr-4 transition-opacity cursor-pointer active:bg-gray-50 ${done ? 'opacity-50' : ''}`}
                              style={{ paddingLeft: `${Math.min(1 + (task.indent ?? 0) * 1.25, 4)}rem` }}
                            >
                              <div
                                className={`w-4 h-4 shrink-0 rounded border text-xs flex items-center justify-center transition-colors ${
                                  done ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-400'
                                }`}
                              >
                                {done && '✓'}
                              </div>
                              <span className={`text-sm min-w-0 break-words ${done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                {task.title}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
