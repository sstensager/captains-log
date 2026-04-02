import { useEffect, useRef, useState } from 'react'
import { fetchAllTasks, patchTask } from '../../api'
import type { TaskEntityRef, TaskOut } from '../../types'
import { colorFor } from '../../colors'

interface Props {
  onSelectLog: (id: number) => void
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
  tags: string[]
  entities: TaskEntityRef[]
  sections: SnapshotSection[]
}

type StatusFilter = 'open' | 'done'

type ActiveFilter =
  | { kind: 'search'; query: string }
  | { kind: 'tag'; value: string }
  | { kind: 'entity'; value: string }
  | null

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
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border hover:opacity-75 transition-opacity"
      style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.dot }} />
      {entity.name}
    </button>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TasksPage({ onSelectLog }: Props) {
  const [tasks, setTasks] = useState<TaskOut[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [filter, setFilter] = useState<ActiveFilter>(null)
  const [searchInput, setSearchInput] = useState('')
  const [snapshotGroups, setSnapshotGroups] = useState<SnapshotGroup[]>([])

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

  // Derived filter options
  const allTags = [...new Set(tasks.flatMap(t => t.tags))].sort()
  const allEntities = Object.values(
    tasks.flatMap(t => t.entities).reduce<Record<string, TaskEntityRef>>((acc, e) => {
      acc[e.name] = e; return acc
    }, {})
  ).sort((a, b) => a.name.localeCompare(b.name))

  const handleSearch = (q: string) => {
    setSearchInput(q)
    setFilter(q.trim() ? { kind: 'search', query: q } : null)
  }

  const setPill = (kind: 'tag' | 'entity', value: string) => {
    const already = filter?.kind === kind && (filter as any).value === value
    if (already) { setFilter(null); setSearchInput('') }
    else { setFilter({ kind, value }); setSearchInput('') }
  }

  // Live counts (always up-to-date even without snapshot rebuild)
  const openCount = tasks.filter(t => t.status !== 'done').length
  const doneCount = tasks.length - openCount

  const activeTag = filter?.kind === 'tag' ? filter.value : null
  const activeEntity = filter?.kind === 'entity' ? filter.value : null

  return (
    <div className="flex flex-col md:flex-row flex-1 min-h-0">
      {/* Filters — sidebar on desktop, compact top bar on mobile */}
      <div className="md:w-[220px] shrink-0 flex flex-col bg-gray-50 border-b md:border-b-0 md:border-r border-gray-200">
        {/* Mobile: single compact row */}
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
          <input
            type="text"
            placeholder="Search…"
            value={searchInput}
            onChange={e => handleSearch(e.target.value)}
            className="flex-1 text-sm bg-white border border-gray-200 rounded-md px-3 py-1.5 outline-none focus:border-gray-400 placeholder-gray-400"
          />
        </div>

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
                  <button onClick={() => { setFilter(null); setSearchInput('') }} className="hover:text-gray-300 ml-0.5">×</button>
                </span>
              </div>
            )}
          </div>

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

          {allEntities.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Nodes</div>
              <div className="flex flex-wrap gap-1">
                {allEntities.map(entity => {
                  const c = colorFor(entity.type)
                  const isActive = activeEntity === entity.name
                  return (
                    <button
                      key={entity.name}
                      onClick={() => setPill('entity', entity.name)}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-opacity hover:opacity-75"
                      style={isActive
                        ? { backgroundColor: '#111827', borderColor: '#111827', color: '#fff' }
                        : { backgroundColor: c.bg, borderColor: c.border, color: c.text }
                      }
                    >
                      {!isActive && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.dot }} />}
                      {entity.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Task groups */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
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
        ) : (
          <div className="max-w-2xl space-y-6">
            {snapshotGroups.map(group => {
              // Get live task data for rendering (status may have changed)
              const taskById = (id: number) => tasks.find(t => t.id === id)
              const allTaskIds = group.sections.flatMap(s => s.taskIds)
              const openInGroup = allTaskIds.filter(id => taskById(id)?.status !== 'done').length

              return (
                <div key={group.key} className="rounded-xl border bg-white shadow-sm overflow-hidden">
                  {/* Group header */}
                  <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {group.log_preview && (
                        <button
                          onClick={() => group.source_log_id && onSelectLog(group.source_log_id)}
                          className="text-sm font-medium text-gray-700 hover:text-gray-900 text-left truncate block w-full"
                        >
                          {group.log_preview}
                        </button>
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
                        <div className="px-4 py-1.5 text-xs text-gray-400 italic bg-gray-50 border-b border-gray-100">
                          {section.header}
                        </div>
                      )}
                      <div className="divide-y divide-gray-50">
                        {section.taskIds.map(id => {
                          const task = taskById(id)
                          if (!task) return null
                          const done = task.status === 'done'
                          return (
                            <div
                              key={id}
                              className={`flex items-center gap-3 py-2.5 pr-4 transition-opacity ${done ? 'opacity-50' : ''}`}
                              style={{ paddingLeft: `${Math.min(1 + (task.indent ?? 0) * 1.25, 4)}rem` }}
                            >
                              <button
                                onClick={() => toggle(task)}
                                className={`w-4 h-4 shrink-0 rounded border text-xs flex items-center justify-center transition-colors ${
                                  done ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-400 hover:border-gray-600'
                                }`}
                              >
                                {done && '✓'}
                              </button>
                              <span className={`text-sm ${done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
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
