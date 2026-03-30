import React, { useEffect, useRef, useState } from 'react'
import type { Annotation, EntityDetail, EntitySummary } from '../../types'
import { colorFor } from '../../colors'
import { relativeDate } from '../../utils/time'
import { updateEntity, deleteEntity, mergeEntity, fetchEntities, promoteAnnotation } from '../../api'

// Keep in sync with VALID_ENTITY_TYPES in server.py
const ENTITY_TYPES = ['person', 'place', 'pet', 'organization', 'event', 'thing', 'idea']

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
  onDeleted,
  onMerged,
  pendingSuggestions,
  onSuggestionConfirmed,
}: {
  entity: EntityDetail
  onSelectLog: (id: number) => void
  onUpdated?: (updated: EntityDetail) => void
  onDeleted?: () => void
  onMerged?: (winner: EntityDetail) => void
  pendingSuggestions?: Annotation[]
  onSuggestionConfirmed?: () => void
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

  const [savingType, setSavingType] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const changeType = async (newType: string) => {
    if (newType === entity.type || savingType) return
    setSavingType(true)
    try {
      const updated = await updateEntity(entity.id, { entity_type: newType })
      onUpdated?.(updated)
    } finally {
      setSavingType(false)
    }
  }

  const handleConfirm = async () => {
    if (!pendingSuggestions?.length || confirming) return
    setConfirming(true)
    try {
      await promoteAnnotation(pendingSuggestions[0].id)
      onSuggestionConfirmed?.()
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Confirm suggestion banner */}
      {pendingSuggestions && pendingSuggestions.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-xs text-amber-700">
            {pendingSuggestions.length === 1 ? 'Suggested in this log' : `${pendingSuggestions.length} suggestions in this log`}
          </span>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-40 transition-colors font-mono"
          >
            {confirming ? 'Linking…' : `[[${entity.name}]]`}
          </button>
        </div>
      )}
      {/* Type dropdown + inline name */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={entity.type}
          onChange={e => changeType(e.target.value)}
          disabled={savingType}
          className="text-xs font-medium px-2 py-1 rounded-full border appearance-none cursor-pointer disabled:opacity-40 hover:opacity-75 transition-opacity"
          style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
        >
          {ENTITY_TYPES.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
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
      {/* Archive + Merge */}
      <MergeButton entity={entity} onMerged={onMerged} />
      <ArchiveButton entity={entity} onDeleted={onDeleted} />
    </div>
  )
}

function MergeButton({
  entity,
  onMerged,
}: {
  entity: EntityDetail
  onMerged?: (winner: EntityDetail) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<EntitySummary[]>([])
  const [target, setTarget] = useState<EntitySummary | null>(null)
  // null = not chosen yet, 'entity' = current entity wins, 'target' = target wins
  const [winner, setWinner] = useState<'entity' | 'target' | null>(null)
  const [merging, setMerging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      fetchEntities().then(all =>
        setCandidates(all.filter(e => e.id !== entity.id))
      )
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery('')
      setTarget(null)
      setWinner(null)
    }
  }, [open, entity.id])

  const filtered = candidates.filter(e =>
    e.name.toLowerCase().includes(query.toLowerCase())
  )

  const handleMerge = async () => {
    if (!target || !winner) return
    setMerging(true)
    // loser is merged into winner; API: merge(loser_id, winner_id)
    const loserId  = winner === 'entity' ? target.id  : entity.id
    const winnerId = winner === 'entity' ? entity.id  : target.id
    try {
      const result = await mergeEntity(loserId, winnerId)
      onMerged?.(result)
      setOpen(false)
    } catch (err) {
      console.error('Merge failed:', err)
    } finally {
      setMerging(false)
    }
  }

  if (!open) {
    return (
      <div className="pt-1">
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-gray-400 hover:text-blue-500 transition-colors"
        >
          Merge with…
        </button>
      </div>
    )
  }

  return (
    <div className="pt-2 border-t border-gray-100 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500">Merge with…</span>
        <button onClick={() => setOpen(false)} className="text-gray-300 hover:text-gray-600 text-sm leading-none">×</button>
      </div>

      {target && winner ? (
        // Step 3: final confirm
        <div className="space-y-2">
          <p className="text-xs text-gray-600">
            <span className="font-medium line-through text-gray-400">
              {winner === 'entity' ? target.name : entity.name}
            </span>
            {' → '}
            <span className="font-medium">
              {winner === 'entity' ? entity.name : target.name}
            </span>
            {'. All mentions will be reattributed.'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleMerge}
              disabled={merging}
              className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {merging ? 'Merging…' : 'Confirm merge'}
            </button>
            <button
              onClick={() => setWinner(null)}
              className="text-xs px-2.5 py-1 border border-gray-200 text-gray-500 rounded hover:border-gray-400 transition-colors"
            >
              Back
            </button>
          </div>
        </div>
      ) : target ? (
        // Step 2: pick winner
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Which one survives?</p>
          {[
            { key: 'entity' as const, name: entity.name, type: entity.type, refCount: null },
            { key: 'target' as const, name: target.name, type: target.type, refCount: target.ref_count },
          ].map(opt => {
            const c = colorFor(opt.type)
            return (
              <button
                key={opt.key}
                onClick={() => setWinner(opt.key)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded border border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-left transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
                <span className="text-xs text-gray-800 flex-1 font-medium">{opt.name}</span>
                {opt.refCount != null && (
                  <span className="text-xs text-gray-400">{opt.refCount} refs</span>
                )}
              </button>
            )
          })}
          <button
            onClick={() => setTarget(null)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            ← Back
          </button>
        </div>
      ) : (
        // Step 1: search for other entity
        <div className="space-y-1">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search entities…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full text-xs px-2 py-1.5 rounded border border-gray-200 outline-none focus:border-gray-400 bg-gray-50"
          />
          <div className="max-h-36 overflow-y-auto space-y-0.5">
            {filtered.slice(0, 20).map(e => {
              const c = colorFor(e.type)
              return (
                <button
                  key={e.id}
                  onClick={() => setTarget(e)}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-gray-50"
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
                  <span className="text-xs text-gray-800 flex-1 truncate">{e.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">{e.ref_count}</span>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-2">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ArchiveButton({ entity, onDeleted }: { entity: EntityDetail; onDeleted?: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteEntity(entity.id)
      onDeleted?.()
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <div className="pt-2 border-t border-gray-100">
        <button
          onClick={() => setConfirming(true)}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          Archive entity
        </button>
      </div>
    )
  }

  return (
    <div className="pt-2 border-t border-gray-100 space-y-1.5">
      <p className="text-xs text-gray-500">
        Archive <span className="font-medium">{entity.name}</span>? It will be hidden everywhere but notes stay intact.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs px-2.5 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40 transition-colors"
        >
          {deleting ? 'Archiving…' : 'Yes, archive'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs px-2.5 py-1 border border-gray-200 text-gray-500 rounded hover:border-gray-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
