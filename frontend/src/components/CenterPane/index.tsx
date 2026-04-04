import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import EmptyState from './EmptyState'
import { fetchLog, createLog, fetchTasks, patchTask, updateLog, patchAnnotation, promoteAnnotation, relinkAnnotation, fetchEntities } from '../../api'
import type { Annotation, EntitySummary, LogDetail, TaskOut } from '../../types'
import { colorFor } from '../../colors'
import { relativeDate, shortTime } from '../../utils/time'

const ENTITY_TYPES = new Set(['person', 'place', 'pet', 'organization', 'event', 'thing', 'idea'])
const TODO_LINE_RE = /^\s*(?:[-*]\s+)?\[[ xX]?\]\s*(.*)/
const BULLET_LINE_RE = /^(\s*)([-*])\s+(.*)/

// ── Line-by-line body renderer ────────────────────────────────────────────────

// ── Entity mark with action menu ──────────────────────────────────────────────

// True when the primary input is touch (no hover capability)
const isTouch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches

function EntityMark({
  displayText, entityName, type, annotationId, isLlm,
  onEntityClick, onReject, onPromote, onRelink,
}: {
  displayText: string
  entityName: string
  type: string
  annotationId: number
  isLlm: boolean
  onEntityClick: (name: string) => void
  onReject: (id: number) => void
  onPromote: (id: number) => void
  onRelink: (id: number, targetName: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [relinking, setRelinking] = useState(false)
  const [relinkQuery, setRelinkQuery] = useState('')
  const [allEntities, setAllEntities] = useState<EntitySummary[]>([])
  const ref = useRef<HTMLSpanElement>(null)
  const relinkInputRef = useRef<HTMLInputElement>(null)
  const c = colorFor(type)

  useEffect(() => {
    if (!open) { setRelinking(false); setRelinkQuery('') }
  }, [open])

  useEffect(() => {
    if (relinking) {
      fetchEntities().then(setAllEntities)
      setTimeout(() => relinkInputRef.current?.focus(), 0)
    }
  }, [relinking])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [open])

  const filteredRelink = relinkQuery.trim()
    ? allEntities
        .filter(e => e.name.toLowerCase().includes(relinkQuery.toLowerCase()) && e.name.toLowerCase() !== entityName.toLowerCase())
        .slice(0, 6)
    : []

  const stopBoth = (e: React.MouseEvent | React.TouchEvent) => {
    e.nativeEvent.stopImmediatePropagation()
  }

  return (
    <span ref={ref} className="relative inline group/mark">
      <mark
        onClick={() => {
          // On touch: tap opens the action menu (nav is inside the menu)
          // On desktop: tap navigates directly (▾ button opens menu on hover)
          if (isTouch) {
            setOpen(o => !o)
          } else if (!open && entityName) {
            onEntityClick(entityName)
          }
        }}
        style={{
          backgroundColor: c.bg,
          textDecoration: 'underline',
          textDecorationStyle: isLlm ? 'dashed' : 'solid',
          textDecorationColor: c.border,
          textUnderlineOffset: '3px',
          cursor: 'pointer',
          borderRadius: '2px',
          padding: '0 1px',
          fontStyle: 'inherit',
        }}
      >
        {displayText}
      </mark>
      {/* Chevron trigger — always visible on touch, hover-only on desktop */}
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) }}
        className={`absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-gray-400 text-white text-[10px] leading-none items-center justify-center hover:bg-gray-600 transition-colors z-10 ${isTouch ? 'flex' : 'hidden group-hover/mark:flex'}`}
        title="Actions"
      >
        ▾
      </button>
      {/* Action menu */}
      {open && (
        <span
          className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 flex flex-col py-1 min-w-max max-w-[min(280px,80vw)]"
          onMouseDown={stopBoth}
          onTouchStart={stopBoth}
        >
          {relinking ? (
            <>
              <div className="px-3 py-1.5 border-b border-gray-100">
                <input
                  ref={relinkInputRef}
                  value={relinkQuery}
                  onChange={e => setRelinkQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
                    if (e.key === 'Enter' && relinkQuery.trim()) {
                      onRelink(annotationId, relinkQuery.trim()); setOpen(false)
                    }
                  }}
                  placeholder="Search or create…"
                  className="text-xs w-40 outline-none bg-transparent text-gray-700 placeholder-gray-300"
                />
              </div>
              {filteredRelink.map(e => {
                const ec = colorFor(e.type)
                return (
                  <button
                    key={e.id}
                    onClick={() => { onRelink(annotationId, e.name); setOpen(false) }}
                    className="flex items-center gap-2 px-3 py-3 text-xs text-left hover:bg-gray-50 text-gray-700 whitespace-nowrap"
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ec.dot }} />
                    {e.name}
                  </button>
                )
              })}
              {relinkQuery.trim() && (
                <button
                  onClick={() => { onRelink(annotationId, relinkQuery.trim()); setOpen(false) }}
                  className={`px-3 py-3 text-xs text-left hover:bg-gray-50 text-gray-400 whitespace-nowrap italic ${filteredRelink.length > 0 ? 'border-t border-gray-100' : ''}`}
                >
                  Create "{relinkQuery.trim()}"
                </button>
              )}
              <button
                onClick={() => setRelinking(false)}
                className="px-3 py-3 text-xs text-left text-gray-300 hover:text-gray-500 border-t border-gray-100"
              >
                ← Back
              </button>
            </>
          ) : (
            <>
              {/* On touch, "go to entity" lives inside the menu since tap opens the menu */}
              {isTouch && entityName && (
                <button
                  onClick={() => { onEntityClick(entityName); setOpen(false) }}
                  className="px-3 py-3 text-xs text-left hover:bg-gray-50 text-gray-800 font-medium whitespace-nowrap border-b border-gray-100"
                >
                  {entityName} →
                </button>
              )}
              {isLlm && (
                <button
                  onClick={() => { onPromote(annotationId); setOpen(false) }}
                  className="px-3 py-3 text-xs text-left hover:bg-gray-50 text-gray-700 whitespace-nowrap"
                >
                  Link as <span className="font-mono text-blue-600">[[{displayText}]]</span>
                </button>
              )}
              <button
                onClick={() => setRelinking(true)}
                className="px-3 py-3 text-xs text-left hover:bg-gray-50 text-gray-700 whitespace-nowrap"
              >
                Different entity…
              </button>
              <button
                onClick={() => { onReject(annotationId); setOpen(false) }}
                className="px-3 py-3 text-xs text-left hover:bg-gray-50 text-red-500 whitespace-nowrap"
              >
                Remove reference
              </button>
            </>
          )}
        </span>
      )}
    </span>
  )
}

function renderLineHighlights(
  line: string,
  lineStart: number,
  annotations: Annotation[],
  onEntityClick: (name: string) => void,
  onRejectAnnotation: (id: number) => void,
  onPromoteAnnotation: (id: number) => void,
  onRelinkAnnotation: (id: number, targetName: string) => void,
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
    const entityName = ann.corrected_value ?? ann.value ?? ''
    const rawSpan = line.slice(s, e)
    const isUserLink = rawSpan.startsWith('[[') && rawSpan.endsWith(']]')
    const isSoftLink = rawSpan.startsWith('{') && rawSpan.endsWith('}')
    const displayText = isUserLink ? rawSpan.slice(2, -2) : isSoftLink ? rawSpan.slice(1, -1) : rawSpan
    const isLlm = !isUserLink && ann.provenance !== 'user' && ann.status !== 'accepted'
    nodes.push(
      <EntityMark
        key={ann.id}
        displayText={displayText}
        entityName={entityName}
        type={ann.type}
        annotationId={ann.id}
        isLlm={isLlm}
        onEntityClick={onEntityClick}
        onReject={onRejectAnnotation}
        onPromote={onPromoteAnnotation}
        onRelink={onRelinkAnnotation}
      />
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
  onRejectAnnotation: (id: number) => void,
  onPromoteAnnotation: (id: number) => void,
  onRelinkAnnotation: (id: number, targetName: string) => void,
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
            {renderLineHighlights(content, contentStart, annotations, onEntityClick, onRejectAnnotation, onPromoteAnnotation, onRelinkAnnotation)}
          </span>
        </div>
      )
    } else {
      nodes.push(
        <div key={i} className="text-base text-gray-800 leading-relaxed min-h-[1.5em]">
          {line
            ? renderLineHighlights(line, lineStart, annotations, onEntityClick, onRejectAnnotation, onPromoteAnnotation, onRelinkAnnotation)
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
  refreshKey?: number
  onBack?: () => void
}

// ── Smart textarea with [[ entity autocomplete ────────────────────────────────

function SmartTextarea({
  value,
  onChange,
  onSave,
  onCancel,
  placeholder,
  textareaClassName,
}: {
  value: string
  onChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
  placeholder?: string
  textareaClassName?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const selAfter = useRef<{ start: number; end: number } | null>(null)
  const [entities, setEntities] = useState<EntitySummary[]>([])
  const [linkQuery, setLinkQuery] = useState<string | null>(null)
  const [linkStart, setLinkStart] = useState(0)
  const [hlIdx, setHlIdx] = useState(0)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => { fetchEntities().then(setEntities) }, [])

  useLayoutEffect(() => {
    if (selAfter.current && ref.current) {
      ref.current.selectionStart = selAfter.current.start
      ref.current.selectionEnd = selAfter.current.end
      selAfter.current = null
    }
  })

  const filtered = useMemo(() => {
    if (linkQuery === null) return []
    return entities
      .filter(e => e.name.toLowerCase().includes(linkQuery.toLowerCase()))
      .slice(0, 8)
  }, [linkQuery, entities])

  const detectLink = (val: string, pos: number) => {
    const before = val.slice(0, pos)
    const lastOpen = before.lastIndexOf('[[')
    if (lastOpen !== -1 && !before.slice(lastOpen).includes(']]')) {
      setLinkQuery(before.slice(lastOpen + 2))
      setLinkStart(lastOpen)
      setHlIdx(0)
      if (ref.current) {
        const r = ref.current.getBoundingClientRect()
        const linesAbove = val.slice(0, pos).split('\n').length - 1
        const lineHeight = parseFloat(getComputedStyle(ref.current).lineHeight) || 29
        const cursorTop = r.top + linesAbove * lineHeight + lineHeight + 4 - ref.current.scrollTop
        // Flip above cursor if too close to viewport bottom
        const dropHeight = 280
        const top = cursorTop + dropHeight > window.innerHeight
          ? cursorTop - lineHeight - dropHeight - 4
          : cursorTop
        setDropdownPos({ top, left: r.left })
      }
    } else {
      setLinkQuery(null)
      setDropdownPos(null)
    }
  }

  const insertLink = (name: string) => {
    const pos = ref.current?.selectionStart ?? value.length
    const newVal = value.slice(0, linkStart) + '[[' + name + ']]' + value.slice(pos)
    onChange(newVal)
    setLinkQuery(null)
    const newPos = linkStart + name.length + 4
    selAfter.current = { start: newPos, end: newPos }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
    detectLink(e.target.value, e.target.selectionStart)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    const { selectionStart: ss, selectionEnd: se, value: v } = ta

    // ── Dropdown navigation ──
    if (linkQuery !== null) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHlIdx(i => Math.min(i + 1, filtered.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHlIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Escape')    { e.preventDefault(); setLinkQuery(null); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered.length > 0) insertLink(filtered[hlIdx].name)
        else if (linkQuery.trim()) insertLink(linkQuery.trim())
        else setLinkQuery(null)
        return
      }
      if (e.key === 'Tab' && filtered.length > 0) { e.preventDefault(); insertLink(filtered[hlIdx].name); return }
    }

    // ── ⌘↵ save / Esc cancel ──
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSave(); return }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return }

    // ── [ with selection → wrap as [[...]] ──
    if (e.key === '[' && ss !== se) {
      e.preventDefault()
      const selected = v.slice(ss, se)
      const isWholeSoftLink = selected.startsWith('{') && selected.endsWith('}')
      const isInsideSoftLink = !isWholeSoftLink && ss > 0 && se < v.length && v[ss - 1] === '{' && v[se] === '}'
      let newVal: string, newPos: number
      if (isWholeSoftLink) {
        const inner = selected.slice(1, -1)
        newVal = v.slice(0, ss) + '[[' + inner + ']]' + v.slice(se)
        newPos = ss + inner.length + 4
      } else if (isInsideSoftLink) {
        // Replace the surrounding { } with [[ ]]
        newVal = v.slice(0, ss - 1) + '[[' + selected + ']]' + v.slice(se + 1)
        newPos = (ss - 1) + selected.length + 4
      } else {
        newVal = v.slice(0, ss) + '[[' + selected + ']]' + v.slice(se)
        newPos = ss + selected.length + 4
      }
      onChange(newVal)
      setLinkQuery(null)
      selAfter.current = { start: newPos, end: newPos }
      return
    }

    // ── Tab indent/dedent ──
    if (e.key === 'Tab') {
      e.preventDefault()
      const lineStart = v.lastIndexOf('\n', ss - 1) + 1
      if (!e.shiftKey) {
        onChange(v.slice(0, lineStart) + '  ' + v.slice(lineStart))
        selAfter.current = { start: ss + 2, end: se + 2 }
      } else {
        const spaces = v.slice(lineStart).match(/^ {1,2}/)
        if (spaces) {
          const n = spaces[0].length
          onChange(v.slice(0, lineStart) + v.slice(lineStart + n))
          selAfter.current = { start: Math.max(lineStart, ss - n), end: Math.max(lineStart, se - n) }
        }
      }
      return
    }

    // ── Enter continuation (bullet / todo) ──
    if (e.key === 'Enter') {
      const lineStart = v.lastIndexOf('\n', ss - 1) + 1
      const line = v.slice(lineStart, ss)
      const m = line.match(/^(\s*)([-*]|\[[ xX]?\])\s/)
      if (m) {
        e.preventDefault()
        const [, indent, marker] = m
        const lineContent = line.slice(m[0].length).trim()
        if (!lineContent) {
          onChange(v.slice(0, lineStart) + '\n' + v.slice(se))
          selAfter.current = { start: lineStart + 1, end: lineStart + 1 }
        } else {
          const prefix = marker.startsWith('[') ? `${indent}[ ] ` : `${indent}${marker} `
          const insertion = '\n' + prefix
          onChange(v.slice(0, ss) + insertion + v.slice(se))
          selAfter.current = { start: ss + insertion.length, end: ss + insertion.length }
        }
      }
    }
  }

  const insertToolbarAction = (action: 'link' | 'todo' | 'bullet' | 'indent' | 'dedent') => {
    const ta = ref.current
    if (!ta) return
    const { selectionStart: ss, selectionEnd: se, value: v } = ta
    const lineStart = v.lastIndexOf('\n', ss - 1) + 1

    if (action === 'link') {
      const newVal = v.slice(0, ss) + '[[]]' + v.slice(se)
      const cursorPos = ss + 2 // place cursor between [[ and ]]
      onChange(newVal)
      selAfter.current = { start: cursorPos, end: cursorPos }
      // detectLink will fire on the next render via the onChange → re-render cycle,
      // but we also call it directly so the dropdown opens immediately
      detectLink(newVal, cursorPos)
      ta.focus()
      return
    }

    if (action === 'indent') {
      onChange(v.slice(0, lineStart) + '  ' + v.slice(lineStart))
      selAfter.current = { start: ss + 2, end: se + 2 }
      ta.focus()
      return
    }
    if (action === 'dedent') {
      const spaces = v.slice(lineStart).match(/^ {1,2}/)
      if (spaces) {
        const n = spaces[0].length
        onChange(v.slice(0, lineStart) + v.slice(lineStart + n))
        selAfter.current = { start: Math.max(lineStart, ss - n), end: Math.max(lineStart, se - n) }
      }
      ta.focus()
      return
    }
    // todo / bullet: replace any existing prefix, add new one
    const prefixMatch = v.slice(lineStart).match(/^(\s*)([-*]\s+|\[[ xX]?\]\s+)?/)
    const indent = prefixMatch?.[1] ?? ''
    const existingPrefixLen = prefixMatch?.[0].length ?? 0
    const newPrefix = action === 'todo' ? `${indent}[ ] ` : `${indent}- `
    const diff = newPrefix.length - existingPrefixLen
    onChange(v.slice(0, lineStart) + newPrefix + v.slice(lineStart + existingPrefixLen))
    selAfter.current = {
      start: Math.max(lineStart + newPrefix.length, ss + diff),
      end: Math.max(lineStart + newPrefix.length, se + diff),
    }
    ta.focus()
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={textareaClassName ?? 'flex-1 w-full resize-none outline-none text-base text-gray-800 leading-[1.8] placeholder-gray-300 bg-transparent'}
      />
      {/* Mobile formatting toolbar — hidden on md+ where keyboard shortcuts work */}
      <div className="flex md:hidden items-center gap-1 border-t border-gray-100 bg-white py-1 px-1 shrink-0">
        {([
          { label: '[[]]', title: 'Link entity', action: 'link' as const },
          { label: '☐', title: 'Todo', action: 'todo' as const },
          { label: '•', title: 'Bullet', action: 'bullet' as const },
          { label: '⇥', title: 'Indent', action: 'indent' as const },
          { label: '⇤', title: 'Dedent', action: 'dedent' as const },
        ] as const).map(btn => (
          <button
            key={btn.action}
            title={btn.title}
            onMouseDown={e => { e.preventDefault(); insertToolbarAction(btn.action) }}
            className={`flex items-center justify-center h-8 rounded text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition-colors ${btn.action === 'link' ? 'px-2 text-xs font-mono' : 'w-10 text-base'}`}
          >
            {btn.label}
          </button>
        ))}
      </div>
      {linkQuery !== null && dropdownPos && (
        <div
          className="fixed w-72 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <div className="px-3 py-1.5 border-b border-gray-100">
            <span className="text-xs text-gray-400 font-mono">{`[[${linkQuery}`}</span>
            <span className="text-xs text-gray-300 ml-1">↑↓ navigate · ↵ select · Esc dismiss</span>
          </div>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 italic">
              {linkQuery.trim() ? `Create new: [[${linkQuery.trim()}]]` : 'Type to search…'}
            </div>
          ) : filtered.map((e, i) => {
            const c = colorFor(e.type)
            return (
              <button
                key={e.id}
                onMouseDown={ev => { ev.preventDefault(); insertLink(e.name) }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${i === hlIdx ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
                <span className="flex-1 truncate text-gray-800">{e.name}</span>
                <span className="text-xs text-gray-400 shrink-0">{e.type}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Edit-mode annotation chip & bar ───────────────────────────────────────────

function EditAnnotationChip({
  name, type, text, onLink, onDismiss,
}: {
  name: string
  type: string
  text: string
  onLink: (newText: string) => void
  onDismiss: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const c = colorFor(type)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const handleLink = () => {
    // Prefer upgrading a {Name} marker if one exists
    const softRe = new RegExp('\\{' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}', 'i')
    const softMatch = softRe.exec(text)
    if (softMatch) {
      onLink(text.slice(0, softMatch.index) + '[[' + name + ']]' + text.slice(softMatch.index + softMatch[0].length))
      setOpen(false)
      return
    }
    // Fall back to wrapping first unbracketed plain occurrence
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(escaped, 'gi')
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const idx = match.index
      const before = text.slice(0, idx)
      const after = text.slice(idx + match[0].length)
      if (!before.endsWith('[[')) {
        onLink(before + '[[' + match[0] + ']]' + after)
        setOpen(false)
        return
      }
    }
    setOpen(false)
  }

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border cursor-pointer hover:opacity-80 transition-opacity"
        style={{ backgroundColor: c.bg, borderColor: c.border, borderStyle: 'dashed', color: c.text }}
        title="Actions"
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
        {name}
        <span className="opacity-50 text-[9px] leading-none">▾</span>
      </button>
      {open && (
        <span className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 flex flex-col py-1 min-w-max">
          <button
            onMouseDown={e => { e.preventDefault(); handleLink() }}
            className="px-3 py-3 text-xs text-left hover:bg-gray-50 text-gray-700 whitespace-nowrap"
          >
            Link as <span className="font-mono text-blue-600">[[{name}]]</span>
          </button>
          <button
            onMouseDown={e => { e.preventDefault(); onDismiss(); setOpen(false) }}
            className="px-3 py-3 text-xs text-left hover:bg-gray-50 text-red-500 whitespace-nowrap"
          >
            Remove reference
          </button>
        </span>
      )}
    </span>
  )
}

function EditAnnotationBar({
  annotations,
  dismissedIds,
  text,
  onTextChange,
  onDismiss,
}: {
  annotations: Annotation[]
  dismissedIds: Set<number>
  text: string
  onTextChange: (t: string) => void
  onDismiss: (id: number) => void
}) {
  const chips = (() => {
    const groups = new Map<string, { type: string; id: number }>()
    for (const a of annotations) {
      if (a.status === 'rejected' || a.status === 'accepted' || dismissedIds.has(a.id) || !ENTITY_TYPES.has(a.type) || a.provenance === 'user') continue
      const name = a.corrected_value ?? a.value ?? ''
      if (!name || groups.has(name)) continue
      groups.set(name, { type: a.type, id: a.id })
    }
    return Array.from(groups.entries()).map(([name, { type, id }]) => ({ name, type, id }))
  })()

  if (chips.length === 0) return null

  return (
    <div className="flex items-center gap-2 px-6 py-2 border-b border-amber-100 bg-amber-50/40">
      <span className="text-xs text-gray-400 shrink-0">Detected:</span>
      <div className="flex flex-wrap gap-1.5">
        {chips.map(({ name, type, id }) => (
          <EditAnnotationChip
            key={id}
            name={name}
            type={type}
            text={text}
            onLink={onTextChange}
            onDismiss={() => onDismiss(id)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Edit view ─────────────────────────────────────────────────────────────────

function EditView({
  initialText,
  annotations,
  onSave,
  onCancel,
}: {
  initialText: string
  annotations?: Annotation[]
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initialText)
  const [saving, setSaving] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set())

  const handleSave = () => {
    if (!text.trim() || saving) return
    setSaving(true)
    onSave(text.trim())
  }

  const handleDismiss = (id: number) => {
    setDismissedIds(prev => new Set([...prev, id]))
    patchAnnotation(id, 'rejected').catch(() => {
      // revert on failure
      setDismissedIds(prev => { const s = new Set(prev); s.delete(id); return s })
    })
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-gray-200 bg-white">
        <span className="hidden sm:block text-xs text-gray-300">⌘↵ to save · Esc to cancel</span>
        <div className="flex gap-2">
          <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!text.trim() || saving}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-40 hover:bg-gray-700 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {annotations && annotations.length > 0 && (
        <EditAnnotationBar
          annotations={annotations}
          dismissedIds={dismissedIds}
          text={text}
          onTextChange={setText}
          onDismiss={handleDismiss}
        />
      )}
      <div className="flex-1 flex flex-col p-4 md:p-8 min-h-0">
        <SmartTextarea
          value={text}
          onChange={setText}
          onSave={handleSave}
          onCancel={onCancel}
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

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-gray-200 bg-white shrink-0">
        <span className="text-sm text-gray-400">{relativeDate(new Date().toISOString())}</span>
        <span className="hidden sm:block text-xs text-gray-300">⌘↵ to save · Esc to cancel</span>
      </div>
      <div className="flex-1 flex flex-col p-4 md:p-8 pb-0 md:pb-0 min-h-0">
        <SmartTextarea
          value={text}
          onChange={setText}
          onSave={submit}
          onCancel={onCancel}
          placeholder="What's on your mind?"
        />
      </div>
      {/* Action bar — outside the scroll area so it's always visible on mobile */}
      <div className="shrink-0 flex items-center justify-between px-4 md:px-8 py-3 border-t border-gray-100 bg-white">
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
  type, value, onClick, onReject, isLlm,
}: {
  type: string
  value: string
  onClick: () => void
  onReject?: () => void
  isLlm?: boolean
}) {
  const c = colorFor(type)
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border"
      style={{
        backgroundColor: c.bg,
        borderColor: c.border,
        borderStyle: isLlm ? 'dashed' : 'solid',
        color: c.text,
      }}
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
  refreshKey,
  onBack,
}: Props) {
  const [log, setLog] = useState<LogDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [tasks, setTasks] = useState<TaskOut[]>([])
  const [editing, setEditing] = useState(false)
  const [pendingReject, setPendingReject] = useState<{ name: string; ids: number[] } | null>(null)

  useEffect(() => {
    setEditing(false)
    if (!selectedLogId) { setLog(null); setTasks([]); return }
    setLoading(true)
    Promise.all([fetchLog(selectedLogId), fetchTasks(selectedLogId)]).then(([data, t]) => {
      setLog(data); setLoading(false); setTasks(t)
    })
  }, [selectedLogId, refreshKey])

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
        annotations={log.annotations}
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

  // Deduplicate by name — one chip per unique entity name
  const entityChips = (() => {
    const groups = new Map<string, { type: string; annotations: Annotation[]; hasUserLink: boolean }>()
    for (const a of log?.annotations ?? []) {
      if (a.status === 'rejected' || !ENTITY_TYPES.has(a.type)) continue
      const name = a.corrected_value ?? a.value ?? ''
      if (!name) continue
      if (!groups.has(name)) groups.set(name, { type: a.type, annotations: [], hasUserLink: false })
      const g = groups.get(name)!
      g.annotations.push(a)
      if (a.provenance === 'user' || a.status === 'accepted') g.hasUserLink = true
    }
    return Array.from(groups.entries()).map(([name, { type, annotations, hasUserLink }]) => ({
      name, type, annotations, isLlm: !hasUserLink,
    }))
  })()

  const rejectAnnotations = (ids: number[]) => {
    Promise.all(ids.map(id => patchAnnotation(id, 'rejected'))).then(() => {
      setLog(prev => prev ? {
        ...prev,
        annotations: prev.annotations.map(ann =>
          ids.includes(ann.id) ? { ...ann, status: 'rejected' } : ann
        ),
      } : null)
      setPendingReject(null)
    })
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* TopBar */}
      <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden text-gray-400 hover:text-gray-600 p-1 -ml-1"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          )}
          {log && (
            <>
              <span className="text-sm font-medium text-gray-700">
                {relativeDate(log.created_at)}
              </span>
              <span className="text-sm text-gray-400">
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
          <div className="px-4 md:px-8 py-4 md:py-6 max-w-2xl">
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
                (id) => rejectAnnotations([id]),
                (id) => { promoteAnnotation(id).then(setLog) },
                (id, targetName) => { relinkAnnotation(id, targetName).then(setLog) },
              )}
            </div>

            {entityChips.length > 0 && (
              <div className="pt-4 border-t border-gray-100 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {entityChips.map(({ name, type, annotations, isLlm }) => (
                    <Chip
                      key={name}
                      type={type}
                      value={name}
                      isLlm={isLlm}
                      onClick={() => onEntityClick(name)}
                      onReject={() => {
                        if (annotations.length > 1) {
                          setPendingReject({ name, ids: annotations.map(a => a.id) })
                        } else {
                          rejectAnnotations([annotations[0].id])
                        }
                      }}
                    />
                  ))}
                </div>
                {pendingReject && (
                  <div className="flex items-center gap-2 text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    <span className="flex-1">
                      <span className="font-medium">{pendingReject.name}</span> appears {pendingReject.ids.length} times in this note. Remove all references?
                    </span>
                    <button
                      onClick={() => rejectAnnotations(pendingReject.ids)}
                      className="text-red-600 hover:text-red-800 font-medium shrink-0"
                    >
                      Remove all
                    </button>
                    <button
                      onClick={() => setPendingReject(null)}
                      className="text-gray-400 hover:text-gray-700 shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                )}
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
