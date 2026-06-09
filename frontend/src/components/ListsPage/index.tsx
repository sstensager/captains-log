import { useEffect, useRef, useState } from 'react'
import {
  createGeneratedList,
  deleteGeneratedList,
  fetchAllTasks,
  fetchGeneratedList,
  fetchGeneratedLists,
  patchGeneratedList,
  patchTask,
} from '../../api'
import type { GeneratedListOut, GeneratedListSummary, InlineTaskItem, TaskOut } from '../../types'
import { relativeDate } from '../../utils/time'

// ── Inline-editable title ─────────────────────────────────────────────────────

function EditableTitle({
  value,
  onSave,
}: {
  value: string
  onSave: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    else setDraft(value)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="text-base font-semibold text-gray-800 bg-transparent border-b border-gray-400 outline-none w-full"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        autoFocus
      />
    )
  }

  return (
    <h2
      className="text-base font-semibold text-gray-800 cursor-text hover:underline decoration-dotted underline-offset-2"
      title="Click to rename"
      onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.select(), 0) }}
    >
      {value}
    </h2>
  )
}

// ── List detail view ──────────────────────────────────────────────────────────

function ListDetail({
  listId,
  onDeleted,
  onRegenerated,
  onSelectLog,
}: {
  listId: number
  onDeleted: () => void
  onRegenerated: (newList: GeneratedListSummary) => void
  onSelectLog?: (id: number) => void
}) {
  const [list, setList] = useState<GeneratedListOut | null>(null)
  const [tasks, setTasks] = useState<TaskOut[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState('')
  const [refining, setRefining] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [addingToSection, setAddingToSection] = useState<number | null>(null)
  const [addInput, setAddInput] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)
  const addSubmittingRef = useRef(false)
  // Mirror addInput in a ref so the async callback always reads the latest value
  const addInputValueRef = useRef('')

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchGeneratedList(listId), fetchAllTasks()])
      .then(([l, t]) => { setList(l); setTasks(t) })
      .finally(() => setLoading(false))
  }, [listId])

  const taskById = (id: number) => tasks.find(t => t.id === id)

  const handleToggle = async (task: TaskOut) => {
    const next = task.status === 'done' ? 'todo' : 'done'
    const updated = await patchTask(task.id, next)
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  const handleRename = async (newTitle: string) => {
    if (!list) return
    const updated = await patchGeneratedList(list.id, { title: newTitle })
    setList(updated)
  }

  const handleRefine = async () => {
    if (!list || !feedback.trim()) return
    setRefining(true)
    try {
      const updated = await patchGeneratedList(list.id, { feedback: feedback.trim() })
      setList(updated)
      setFeedback('')
    } finally {
      setRefining(false)
    }
  }

  const handleRegenerate = async () => {
    if (!list) return
    const filter = JSON.parse(list.filter_json) as { kind: 'entity' | 'tag'; value: string }
    setRegenerating(true)
    try {
      const survivingTasks = list.sections.flatMap(s =>
        (s.inline_tasks ?? []).filter(t => !t.checked).map(t => t.text)
      )
      let newList = await createGeneratedList(filter)
      // Keep the user's custom name if they renamed the list
      if (list.title !== list.description) {
        newList = await patchGeneratedList(newList.id, { title: list.title })
      }
      for (const text of survivingTasks) {
        newList = await patchGeneratedList(newList.id, { add_inline_task: { text, section_index: 0 } })
      }
      await deleteGeneratedList(list.id)
      const summary: GeneratedListSummary = {
        id: newList.id,
        title: newList.title,
        description: newList.description,
        created_at: newList.created_at,
        updated_at: null,
        task_count: newList.sections.reduce((n, s) => n + s.tasks.length, 0),
      }
      onRegenerated(summary)
    } finally {
      setRegenerating(false)
    }
  }

  const handleDelete = async () => {
    if (!list) return
    setDeleting(true)
    try {
      await deleteGeneratedList(list.id)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  const submitAddInline = async (sectionIndex: number) => {
    if (addSubmittingRef.current) return
    addSubmittingRef.current = true
    const text = addInputValueRef.current.trim()
    setAddingToSection(null)
    setAddInput('')
    addInputValueRef.current = ''
    if (!text || !list) { addSubmittingRef.current = false; return }
    try {
      const updated = await patchGeneratedList(list.id, { add_inline_task: { text, section_index: sectionIndex } })
      setList(updated)
    } catch (e) {
      console.error('Add inline task failed', e)
    } finally {
      addSubmittingRef.current = false
    }
  }

  const handleToggleInline = async (sectionIndex: number, taskIndex: number, item: InlineTaskItem) => {
    if (!list) return
    const updated = await patchGeneratedList(list.id, {
      toggle_inline_task: { section_index: sectionIndex, task_index: taskIndex, checked: !item.checked },
    })
    setList(updated)
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        Loading…
      </div>
    )
  }

  if (!list) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        List not found.
      </div>
    )
  }

  const filterMeta = (() => {
    try { return JSON.parse(list.filter_json) as { kind: 'entity' | 'tag'; value: string } }
    catch { return null }
  })()

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 md:px-8">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <EditableTitle value={list.title} onSave={handleRename} />
            {filterMeta && (
              <p className="text-xs text-gray-400 mt-0.5">
                {filterMeta.kind === 'entity' ? 'Node' : 'Tag'}: <span className="font-medium text-gray-500">{filterMeta.value}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleRegenerate}
              disabled={regenerating || refining}
              className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-40 transition-colors"
            >
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>

        {/* Sections */}
        {list.sections.map((section, si) => (
          <div key={si} className="rounded-xl border bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <div className="text-sm font-medium text-gray-700">{section.label}</div>
              {section.description && (
                <div className="text-xs text-gray-400 mt-0.5 italic">{section.description}</div>
              )}
            </div>
            <div className="divide-y divide-gray-50">
              {section.tasks.map(sectionTask => {
                const live = taskById(sectionTask.id) ?? sectionTask
                const done = live.status === 'done'
                return (
                  <div
                    key={live.id}
                    onClick={() => handleToggle(live)}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer active:bg-gray-50 transition-opacity ${done ? 'opacity-50' : ''}`}
                  >
                    <div
                      className={`w-4 h-4 shrink-0 rounded border text-xs flex items-center justify-center transition-colors ${
                        done ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-400'
                      }`}
                    >
                      {done && '✓'}
                    </div>
                    <span className={`text-sm flex-1 min-w-0 break-words ${done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {live.title}
                    </span>
                    {live.source_log_id != null && (
                      <button
                        onClick={e => { e.stopPropagation(); onSelectLog?.(live.source_log_id!) }}
                        title="View source log"
                        className="shrink-0 text-gray-300 hover:text-gray-500 transition-colors"
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="1" width="12" height="14" rx="1.5"/>
                          <line x1="5" y1="5" x2="11" y2="5"/>
                          <line x1="5" y1="8" x2="11" y2="8"/>
                          <line x1="5" y1="11" x2="8" y2="11"/>
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
              {(section.inline_tasks ?? []).map((item, ti) => (
                <div
                  key={`inline-${ti}`}
                  onClick={() => handleToggleInline(si, ti, item)}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer active:bg-gray-50 transition-opacity ${item.checked ? 'opacity-50' : ''}`}
                >
                  <div
                    className={`w-4 h-4 shrink-0 rounded border text-xs flex items-center justify-center transition-colors ${
                      item.checked ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-400'
                    }`}
                  >
                    {item.checked && '✓'}
                  </div>
                  <span className={`text-sm flex-1 min-w-0 break-words ${item.checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                    {item.text}
                  </span>
                  <span className="shrink-0 text-gray-300" title="Added to list">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="8" y1="2" x2="8" y2="14"/>
                      <line x1="2" y1="8" x2="14" y2="8"/>
                    </svg>
                  </span>
                </div>
              ))}
              {/* Per-section quick-add */}
              {addingToSection === si ? (
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-4 h-4 shrink-0 rounded border border-gray-300" />
                  <input
                    ref={addInputRef}
                    autoFocus
                    type="text"
                    value={addInput}
                    onChange={e => { setAddInput(e.target.value); addInputValueRef.current = e.target.value }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); submitAddInline(si) }
                      if (e.key === 'Escape') { addInputValueRef.current = ''; setAddingToSection(null); setAddInput('') }
                    }}
                    onBlur={() => submitAddInline(si)}
                    placeholder="New todo…"
                    enterKeyHint="done"
                    className="flex-1 text-sm outline-none text-gray-800 placeholder-gray-400 bg-transparent"
                  />
                </div>
              ) : (
                <button
                  onClick={() => { addInputValueRef.current = ''; setAddInput(''); setAddingToSection(si) }}
                  className="flex items-center gap-3 px-4 py-2.5 w-full text-left text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <span className="w-4 h-4 shrink-0 flex items-center justify-center rounded border border-gray-200 text-xs leading-none">+</span>
                  Add todo
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Feedback area */}
        <div className="rounded-xl border bg-white shadow-sm p-4 space-y-2">
          <p className="text-xs font-medium text-gray-500">Refine this list</p>
          <textarea
            className="w-full text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 resize-none outline-none focus:border-gray-400 transition-colors"
            rows={2}
            placeholder="e.g. milk isn't a beverage, move it to dairy"
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRefine() }}
          />
          <div className="flex justify-end">
            <button
              onClick={handleRefine}
              disabled={refining || !feedback.trim()}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              {refining ? 'Refining…' : 'Refine'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Lists rail (left panel) ───────────────────────────────────────────────────

function ListsRail({
  lists,
  selectedId,
  onSelect,
  onDeleted,
}: {
  lists: GeneratedListSummary[]
  selectedId: number | null
  onSelect: (id: number) => void
  onDeleted: (id: number) => void
}) {
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    setDeletingId(id)
    try {
      await deleteGeneratedList(id)
      onDeleted(id)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-3 border-b border-gray-100">
        <h1 className="text-sm font-semibold text-gray-700">Lists</h1>
      </div>
      {lists.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
          <p className="text-sm font-medium text-gray-500">No lists yet</p>
          <p className="text-xs text-gray-400">
            Go to Todos, filter by entity or tag, then click "Organize" to create one.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {lists.map(l => (
            <button
              key={l.id}
              onClick={() => onSelect(l.id)}
              className={`w-full flex items-start gap-2 px-3 py-2.5 text-left transition-colors border-l-2 ${
                selectedId === l.id
                  ? 'bg-gray-100 border-gray-800'
                  : 'border-transparent hover:bg-gray-50'
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{l.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {l.task_count} task{l.task_count !== 1 ? 's' : ''} · {relativeDate(l.updated_at ?? l.created_at)}
                </p>
              </div>
              <button
                onClick={e => handleDelete(e, l.id)}
                disabled={deletingId === l.id}
                className="text-xs text-gray-300 hover:text-red-400 disabled:opacity-40 transition-colors shrink-0 mt-0.5"
              >
                {deletingId === l.id ? '…' : '✕'}
              </button>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ListsPage({ initialSelectedId, onSelectLog }: { initialSelectedId?: number | null; onSelectLog?: (id: number) => void }) {
  const [lists, setLists] = useState<GeneratedListSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    fetchGeneratedLists()
      .then(data => {
        setLists(data)
        if (initialSelectedId != null) setSelectedId(initialSelectedId)
      })
      .finally(() => setLoading(false))
  }, [])

  const handleDeleted = (id: number) => {
    setLists(prev => prev.filter(l => l.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const handleRegenerated = (newSummary: GeneratedListSummary) => {
    setLists(prev => prev
      .filter(l => l.id !== selectedId)
      .concat(newSummary)
      .sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at))
    )
    setSelectedId(newSummary.id)
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        Loading…
      </div>
    )
  }

  const showDetail = selectedId !== null

  return (
    <div className="flex flex-1 min-h-0 min-w-0">
      {/* Left rail — full screen on mobile when no selection */}
      <div className={`${showDetail ? 'hidden md:flex' : 'flex'} md:flex w-full md:w-64 shrink-0 flex-col border-r border-gray-200 bg-white`}>
        <ListsRail
          lists={lists}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDeleted={handleDeleted}
        />
      </div>

      {/* Detail panel — full screen on mobile when selected */}
      <div className={`${showDetail ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-h-0 bg-white`}>
        {showDetail ? (
          <>
            {/* Mobile back button */}
            <div className="md:hidden flex items-center px-4 py-3 border-b border-gray-200">
              <button
                onClick={() => setSelectedId(null)}
                className="text-gray-400 hover:text-gray-600 p-1 -ml-1"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
            </div>
            <ListDetail
              listId={selectedId!}
              onDeleted={() => handleDeleted(selectedId!)}
              onRegenerated={handleRegenerated}
              onSelectLog={onSelectLog}
            />
          </>
        ) : (
          <div className="hidden md:flex items-center justify-center h-full">
            <p className="text-sm text-gray-400">Select a list</p>
          </div>
        )}
      </div>
    </div>
  )
}
