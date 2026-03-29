import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import EmptyState from './EmptyState'
import { fetchLog, createLog, fetchTasks, patchTask, updateLog, patchAnnotation } from '../../api'
import type { Annotation, LogDetail, TaskOut } from '../../types'
import { colorFor } from '../../colors'
import { relativeDate, shortTime } from '../../utils/time'

const ENTITY_TYPES = new Set(['person', 'place'])
const TODO_LINE_RE = /^\s*\[[ xX]?\]\s*(.*)/
const BULLET_LINE_RE = /^(\s*)([-*])\s+(.*)/

// ── Line-by-line body renderer ────────────────────────────────────────────────

function renderLineHighlights(
  line: string,
  lineStart: number,
  annotations: Annotation[],
  onEntityClick: (name: string) => void,
): React.ReactNode {
  const spans = annotations
    .filter(a =>
      a.span_start != null && a.span_end != null &&
      a.span_end! > lineStart && a.span_start! < lineStart + line.length &&
      ENTITY_TYPES.has(a.type) && a.status !== 'rejected'
    )
    .map(a => ({
      ...a,
      span_start: Math.max(0, a.span_start! - lineStart),
      span_end: Math.min(line.length, a.span_end! - lineStart),
    }))
    .sort((a, b) => a.span_start! - b.span_start!)

  if (spans.length === 0) return <>{line}</>

  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const ann of spans) {
    const s = ann.span_start!
    const e = ann.span_end!
    if (s < cursor) continue
    if (s > cursor) nodes.push(line.slice(cursor, s))
    const c = colorFor(ann.type)
    const entityName = ann.corrected_value ?? ann.value ?? ''
    nodes.push(
      <mark
        key={ann.id}
        onClick={entityName ? () => onEntityClick(entityName) : undefined}
        style={{
          backgroundColor: c.bg,
          borderBottom: `2px solid ${c.border}`,
          cursor: entityName ? 'pointer' : 'default',
          borderRadius: '2px',
          padding: '0 1px',
          fontStyle: 'inherit',
        }}
      >
        {line.slice(s, e)}
      </mark>
    )
    cursor = e
  }
  if (cursor < line.length) nodes.push(line.slice(cursor))
  return <>{nodes}</>
}

function renderBody(
  rawText: string,
  annotations: Annotation[],
  tasks: TaskOut[],
  onEntityClick: (name: string) => void,
  onToggleTodo: (task: TaskOut) => void,
): React.ReactNode {
  const lines = rawText.split('\n')
  let offset = 0
  const nodes: React.ReactNode[] = []

  lines.forEach((line, i) => {
    const lineStart = offset
    offset += line.length + 1

    const todoM = line.match(TODO_LINE_RE)
    const bulletM = !todoM && line.match(BULLET_LINE_RE)

    if (todoM) {
      const title = todoM[1].trim()
      const task = tasks.find(t => t.title === title)
      const done = task ? task.status === 'done' : false
      const indent = (line.match(/^(\s*)/)?.[1].length ?? 0) / 2
      nodes.push(
        <div key={i} className="flex items-center gap-2 py-0.5" style={{ paddingLeft: `${indent * 1.25}rem` }}>
          <button
            onClick={() => task && onToggleTodo(task)}
            disabled={!task}
            className={`w-4 h-4 shrink-0 rounded border text-xs flex items-center justify-center transition-colors ${
              done
                ? 'bg-gray-900 border-gray-900 text-white'
                : 'border-gray-400 hover:border-gray-600'
            }`}
          >
            {done && '✓'}
          </button>
          <span className={`text-base leading-relaxed ${done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
            {title}
          </span>
        </div>
      )
    } else if (bulletM) {
      const [, indent, , content] = bulletM
      const level = Math.floor(indent.length / 2)
      const contentStart = lineStart + indent.length + 2 // past "- "
      nodes.push(
        <div key={i} className="flex items-baseline gap-2 leading-relaxed" style={{ paddingLeft: `${level * 1.25}rem` }}>
          <span className="text-gray-400 shrink-0 select-none text-sm">•</span>
          <span className="text-base text-gray-800">
            {renderLineHighlights(content, contentStart, annotations, onEntityClick)}
          </span>
        </div>
      )
    } else {
      nodes.push(
        <div key={i} className="text-base text-gray-800 leading-relaxed min-h-[1.5em]">
          {line
            ? renderLineHighlights(line, lineStart, annotations, onEntityClick)
            : <>&nbsp;</>}
        </div>
      )
    }
  })

  return <div>{nodes}</div>
}

interface Props {
  selectedLogId: number | null
  composing: boolean
  onNewLog: () => void
  onCancelCompose: () => void
  onLogCreated: (log: LogDetail) => void
  onLogUpdated: (log: LogDetail) => void
  onToggleRightRail: () => void
  rightRailOpen: boolean
  onEntityClick: (name: string) => void
  onTagClick: (tag: string) => void
}

// ── Smart textarea for editing ────────────────────────────────────────────────

function EditView({
  initialText,
  onSave,
  onCancel,
}: {
  initialText: string
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initialText)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const selAfter = useRef<{ start: number; end: number } | null>(null)

  useEffect(() => { ref.current?.focus() }, [])

  // Apply cursor position after React re-renders from key handling
  useLayoutEffect(() => {
    if (selAfter.current && ref.current) {
      ref.current.selectionStart = selAfter.current.start
      ref.current.selectionEnd = selAfter.current.end
      selAfter.current = null
    }
  })

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    const { selectionStart: ss, selectionEnd: se, value } = ta

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return }

    if (e.key === 'Tab') {
      e.preventDefault()
      const lineStart = value.lastIndexOf('\n', ss - 1) + 1
      if (!e.shiftKey) {
        setText(value.slice(0, lineStart) + '  ' + value.slice(lineStart))
        selAfter.current = { start: ss + 2, end: se + 2 }
      } else {
        const spaces = value.slice(lineStart).match(/^ {1,2}/)
        if (spaces) {
          const n = spaces[0].length
          setText(value.slice(0, lineStart) + value.slice(lineStart + n))
          selAfter.current = { start: Math.max(lineStart, ss - n), end: Math.max(lineStart, se - n) }
        }
      }
      return
    }

    if (e.key === 'Enter') {
      const lineStart = value.lastIndexOf('\n', ss - 1) + 1
      const line = value.slice(lineStart, ss)
      const m = line.match(/^(\s*)([-*]|\[[ xX]?\])\s/)
      if (m) {
        e.preventDefault()
        const [, indent, marker] = m
        const lineContent = line.slice(m[0].length).trim()
        if (!lineContent) {
          // empty bullet/todo — break out
          const next = value.slice(0, lineStart) + '\n' + value.slice(se)
          setText(next)
          selAfter.current = { start: lineStart + 1, end: lineStart + 1 }
        } else {
          const prefix = marker.startsWith('[') ? `${indent}[ ] ` : `${indent}${marker} `
          const insertion = '\n' + prefix
          setText(value.slice(0, ss) + insertion + value.slice(se))
          selAfter.current = { start: ss + insertion.length, end: ss + insertion.length }
        }
      }
    }
  }

  const handleSave = async () => {
    if (!text.trim() || saving) return
    setSaving(true)
    onSave(text.trim())
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
        <span className="text-xs text-gray-300">⌘↵ to save · Esc to cancel</span>
        <div className="flex gap-2">
          <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!text.trim() || saving}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-gray-700 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <div className="flex-1 p-8">
        <textarea
          ref={ref}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full h-full resize-none outline-none text-base text-gray-800 leading-[1.8] bg-transparent font-mono text-sm"
        />
      </div>
    </div>
  )
}

// ── Compose view ──────────────────────────────────────────────────────────────

function ComposeView({
  onLogCreated,
  onCancel,
}: {
  onLogCreated: (log: LogDetail) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { ref.current?.focus() }, [])

  const submit = async () => {
    if (!text.trim() || submitting) return
    setSubmitting(true)
    try {
      const log = await createLog(text.trim())
      onLogCreated(log)
    } catch {
      setSubmitting(false)
    }
  }

  const selAfter = useRef<{ start: number; end: number } | null>(null)

  useLayoutEffect(() => {
    if (selAfter.current && ref.current) {
      ref.current.selectionStart = selAfter.current.start
      ref.current.selectionEnd = selAfter.current.end
      selAfter.current = null
    }
  })

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { submit(); return }
    if (e.key === 'Escape') { onCancel(); return }

    const ta = e.currentTarget
    const { selectionStart: ss, selectionEnd: se, value } = ta

    if (e.key === 'Tab') {
      e.preventDefault()
      const lineStart = value.lastIndexOf('\n', ss - 1) + 1
      if (!e.shiftKey) {
        setText(value.slice(0, lineStart) + '  ' + value.slice(lineStart))
        selAfter.current = { start: ss + 2, end: se + 2 }
      } else {
        const spaces = value.slice(lineStart).match(/^ {1,2}/)
        if (spaces) {
          const n = spaces[0].length
          setText(value.slice(0, lineStart) + value.slice(lineStart + n))
          selAfter.current = { start: Math.max(lineStart, ss - n), end: Math.max(lineStart, se - n) }
        }
      }
      return
    }

    if (e.key === 'Enter') {
      const lineStart = value.lastIndexOf('\n', ss - 1) + 1
      const line = value.slice(lineStart, ss)
      const m = line.match(/^(\s*)([-*]|\[[ xX]?\])\s/)
      if (m) {
        e.preventDefault()
        const [, indent, marker] = m
        const lineContent = line.slice(m[0].length).trim()
        if (!lineContent) {
          const next = value.slice(0, lineStart) + '\n' + value.slice(se)
          setText(next)
          selAfter.current = { start: lineStart + 1, end: lineStart + 1 }
        } else {
          const prefix = marker.startsWith('[') ? `${indent}[ ] ` : `${indent}${marker} `
          const insertion = '\n' + prefix
          setText(value.slice(0, ss) + insertion + value.slice(se))
          selAfter.current = { start: ss + insertion.length, end: ss + insertion.length }
        }
      }
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
        <span className="text-sm text-gray-400">{relativeDate(new Date().toISOString())}</span>
        <span className="text-xs text-gray-300">⌘↵ to save · Esc to cancel</span>
      </div>
      <div className="flex-1 flex flex-col p-8">
        <textarea
          ref={ref}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What's on your mind?"
          className="flex-1 w-full resize-none outline-none text-base text-gray-800 leading-[1.8] placeholder-gray-300 bg-transparent"
        />
        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          <button
            onClick={onCancel}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!text.trim() || submitting}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-gray-700 transition-colors"
          >
            {submitting ? 'Saving…' : 'Log it'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function LogSkeleton() {
  return (
    <div className="p-8 space-y-3 animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-24" />
      <div className="h-4 bg-gray-200 rounded w-full" />
      <div className="h-4 bg-gray-200 rounded w-5/6" />
      <div className="h-4 bg-gray-200 rounded w-4/5" />
      <div className="h-4 bg-gray-200 rounded w-full" />
      <div className="h-4 bg-gray-200 rounded w-3/5" />
    </div>
  )
}

// ── Chip ──────────────────────────────────────────────────────────────────────

function Chip({
  type, value, onClick, onReject,
}: {
  type: string
  value: string
  onClick: () => void
  onReject?: () => void
}) {
  const c = colorFor(type)
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border"
      style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
    >
      <button onClick={onClick} className="flex items-center gap-1 hover:opacity-75 transition-opacity">
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.dot }} />
        {value}
      </button>
      {onReject && (
        <button
          onClick={e => { e.stopPropagation(); onReject() }}
          className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity leading-none"
          title="Dismiss"
        >
          ×
        </button>
      )}
    </span>
  )
}

// ── Read view ─────────────────────────────────────────────────────────────────

export default function CenterPane({
  selectedLogId,
  composing,
  onNewLog,
  onCancelCompose,
  onLogCreated,
  onLogUpdated,
  onToggleRightRail,
  rightRailOpen,
  onEntityClick,
  onTagClick,
}: Props) {
  const [log, setLog] = useState<LogDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [tasks, setTasks] = useState<TaskOut[]>([])
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    setEditing(false)
    if (!selectedLogId) { setLog(null); setTasks([]); return }
    setLoading(true)
    Promise.all([fetchLog(selectedLogId), fetchTasks(selectedLogId)]).then(([data, t]) => {
      setLog(data); setLoading(false); setTasks(t)
    })
  }, [selectedLogId])

  // Poll for annotations while parse is in-flight (only for recently created logs)
  useEffect(() => {
    const isRecent = log && (Date.now() - new Date(log.created_at).getTime()) < 60_000
    if (!log || log.annotations.length > 0 || !isRecent) { setParsing(false); return }
    setParsing(true)
    let tries = 0
    const iv = setInterval(() => {
      tries++
      Promise.all([fetchLog(log.id), fetchTasks(log.id)]).then(([data, t]) => {
        if (data.annotations.length > 0 || tries >= 10) {
          setLog(data); setTasks(t); setParsing(false); clearInterval(iv)
        }
      })
    }, 2000)
    return () => clearInterval(iv)
  }, [log?.id, log?.annotations.length])

  if (composing) {
    return (
      <ComposeView
        onLogCreated={onLogCreated}
        onCancel={onCancelCompose}
      />
    )
  }

  if (editing && log) {
    return (
      <EditView
        initialText={log.raw_text}
        onCancel={() => setEditing(false)}
        onSave={async (text) => {
          const updated = await updateLog(log.id, text)
          setLog({ ...log, raw_text: updated.raw_text, annotations: [], tags: updated.tags })
          setTasks([])
          setEditing(false)
          onLogUpdated(updated)
          // Re-fetch after a short delay so background parse can run
          setTimeout(() => {
            Promise.all([fetchLog(log.id), fetchTasks(log.id)]).then(([d, t]) => {
              setLog(d); setTasks(t)
            })
          }, 3000)
        }}
      />
    )
  }

  if (!selectedLogId) {
    return (
      <div className="flex-1 flex flex-col min-w-0">
        <EmptyState onNewLog={onNewLog} />
      </div>
    )
  }

  const entityChips = log?.annotations.filter(
    a => a.status !== 'rejected' && ENTITY_TYPES.has(a.type)
  ) ?? []

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* TopBar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
        <div>
          {log && (
            <>
              <span className="text-sm font-medium text-gray-700">
                {relativeDate(log.created_at)}
              </span>
              <span className="text-sm text-gray-400 ml-2">
                {shortTime(log.created_at)}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {log && (
            <button
              onClick={() => setEditing(true)}
              className="text-xs px-2.5 py-1 rounded border bg-white text-gray-600 border-gray-200 hover:border-gray-400 transition-colors"
            >
              Edit
            </button>
          )}
          <button
            onClick={onToggleRightRail}
            className={`text-xs px-2.5 py-1 rounded border transition-colors ${
              rightRailOpen
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            Context
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <LogSkeleton />
        ) : log ? (
          <div className="px-8 py-6 max-w-2xl">
            <div className="mb-6">
              {renderBody(
                log.raw_text,
                log.annotations,
                tasks,
                onEntityClick,
                (task) => {
                  const newStatus = task.status === 'done' ? 'todo' : 'done'
                  patchTask(task.id, newStatus).then(updated =>
                    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
                  )
                },
              )}
            </div>

            {entityChips.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-100">
                {entityChips.map(a => {
                  const val = a.corrected_value ?? a.value ?? ''
                  return val ? (
                    <Chip
                      key={a.id}
                      type={a.type}
                      value={val}
                      onClick={() => onEntityClick(val)}
                      onReject={() => {
                        patchAnnotation(a.id, 'rejected').then(() => {
                          setLog(prev => prev ? {
                            ...prev,
                            annotations: prev.annotations.map(ann =>
                              ann.id === a.id ? { ...ann, status: 'rejected' } : ann
                            ),
                          } : null)
                        })
                      }}
                    />
                  ) : null
                })}
              </div>
            )}

            {log.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-4">
                {log.tags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => onTagClick(tag)}
                    className="text-xs text-gray-400 bg-gray-100 hover:bg-gray-200 px-2 py-0.5 rounded transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {parsing && (
              <p className="text-xs text-gray-400 italic mt-2">Parsing…</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
