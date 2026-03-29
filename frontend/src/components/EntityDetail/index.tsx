import React, { useRef, useState } from 'react'
import type { EntityDetail } from '../../types'
import { colorFor } from '../../colors'
import { relativeDate } from '../../utils/time'
import { updateEntity } from '../../api'

export function highlightInExcerpt(excerpt: string, name: string): React.ReactNode {
  const idx = excerpt.toLowerCase().indexOf(name.toLowerCase())
  if (idx === -1) return excerpt
  return (
    <>
      {excerpt.slice(0, idx)}
      <mark className="bg-yellow-100 text-yellow-900 rounded-sm px-0.5 not-italic font-medium">
        {excerpt.slice(idx, idx + name.length)}
      </mark>
      {excerpt.slice(idx + name.length)}
    </>
  )
}

export default function EntityDetailView({
  entity,
  onSelectLog,
  onUpdated,
}: {
  entity: EntityDetail
  onSelectLog: (id: number) => void
  onUpdated?: (updated: EntityDetail) => void
}) {
  const c = colorFor(entity.type)

  // ── Inline name editing ────────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(entity.name)
  const [savingName, setSavingName] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const commitName = async () => {
    const trimmed = nameValue.trim()
    if (!trimmed || trimmed === entity.name) { setEditingName(false); setNameValue(entity.name); return }
    setSavingName(true)
    try {
      const updated = await updateEntity(entity.id, { canonical_name: trimmed })
      onUpdated?.(updated)
    } finally {
      setSavingName(false)
      setEditingName(false)
    }
  }

  // ── Inline user_notes editing ──────────────────────────────────────────────
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState(entity.user_notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const notesRef = useRef<HTMLTextAreaElement>(null)

  const commitNotes = async () => {
    setSavingNotes(true)
    try {
      const updated = await updateEntity(entity.id, { user_notes: notesValue })
      onUpdated?.(updated)
    } finally {
      setSavingNotes(false)
      setEditingNotes(false)
    }
  }

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Badge + inline name */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="text-xs font-medium px-2 py-1 rounded-full border shrink-0"
          style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
        >
          {entity.type}
        </span>
        {editingName ? (
          <input
            ref={nameRef}
            autoFocus
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitName() }
              if (e.key === 'Escape') { setEditingName(false); setNameValue(entity.name) }
            }}
            disabled={savingName}
            className="font-semibold text-gray-900 border-b border-gray-400 outline-none bg-transparent text-base"
          />
        ) : (
          <button
            onClick={() => { setEditingName(true); setNameValue(entity.name) }}
            className="font-semibold text-gray-900 hover:text-gray-600 text-left"
            title="Click to rename"
          >
            {entity.name}
          </button>
        )}
      </div>

      {/* User notes */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Notes</h3>
        {editingNotes ? (
          <div className="space-y-1.5">
            <textarea
              ref={notesRef}
              autoFocus
              value={notesValue}
              onChange={e => setNotesValue(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commitNotes() }
                if (e.key === 'Escape') { setEditingNotes(false); setNotesValue(entity.user_notes ?? '') }
              }}
              disabled={savingNotes}
              rows={3}
              className="w-full text-sm text-gray-700 border border-gray-200 rounded p-2 outline-none focus:border-gray-400 resize-none bg-white"
              placeholder="Add notes about this entity…"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setEditingNotes(false); setNotesValue(entity.user_notes ?? '') }}
                className="text-xs text-gray-400 hover:text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={commitNotes}
                disabled={savingNotes}
                className="text-xs px-2 py-0.5 bg-gray-900 text-white rounded disabled:opacity-40"
              >
                {savingNotes ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setEditingNotes(true); setNotesValue(entity.user_notes ?? '') }}
            className="w-full text-left text-sm text-gray-500 hover:text-gray-800 italic transition-colors"
          >
            {entity.user_notes || 'Add notes…'}
          </button>
        )}
      </section>

      {/* Attributes — grouped by attr_type */}
      {entity.attributes.length > 0 && (() => {
        const grouped = entity.attributes.reduce<Record<string, typeof entity.attributes>>((acc, a) => {
          const t = a.attr_type || 'fact'
          if (!acc[t]) acc[t] = []
          acc[t].push(a)
          return acc
        }, {})
        return (
          <section>
            {Object.entries(grouped).map(([type, attrs]) => (
              <div key={type} className="mb-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  {type === 'fact' ? 'Facts' : type.charAt(0).toUpperCase() + type.slice(1) + 's'}
                </h3>
                <div className="space-y-1">
                  {attrs.map(attr => (
                    <div key={attr.key} className="flex justify-between text-sm">
                      <span className="text-gray-500">{attr.key}</span>
                      <span className="text-gray-800 font-medium">{attr.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )
      })()}

      {/* Mentions */}
      {entity.mentions.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Appears in
          </h3>
          <div className="space-y-2">
            {entity.mentions.map((m, i) => (
              <button
                key={i}
                onClick={() => onSelectLog(m.log_id)}
                className="w-full text-left text-xs bg-gray-50 hover:bg-gray-100 rounded p-2 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-gray-400">{relativeDate(m.ts)}</span>
                  {m.tags.length > 0 && (
                    <div className="flex gap-1">
                      {m.tags.map(tag => (
                        <span key={tag} className="text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-gray-700 leading-relaxed">
                  {highlightInExcerpt(m.excerpt, entity.name)}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Relationships */}
      {entity.relationships.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Relationships
          </h3>
          <div className="space-y-1">
            {entity.relationships.map((r, i) => {
              const tc = colorFor(r.target_type)
              return (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  <span className="text-gray-400 italic">{r.label}</span>
                  <span
                    className="px-1.5 py-0.5 rounded border"
                    style={{ backgroundColor: tc.bg, borderColor: tc.border, color: tc.text }}
                  >
                    {r.target_name}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
