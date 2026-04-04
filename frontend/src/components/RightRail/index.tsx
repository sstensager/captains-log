import { useEffect, useState } from 'react'
import { fetchEntity, fetchLog } from '../../api'
import type { Annotation, EntityDetail, LogDetail } from '../../types'
import { colorFor } from '../../colors'
import { relativeDate } from '../../utils/time'
import AnnotatedText from '../AnnotatedText'
import EntityDetailView from '../EntityDetail'

const ENTITY_TYPES = ['person', 'place', 'pet', 'organization', 'event', 'thing', 'idea']

function getEntitySnippet(rawText: string, entityName: string): { before: string; match: string; after: string } | null {
  const lower = rawText.toLowerCase()
  const idx = lower.indexOf(entityName.toLowerCase())
  if (idx === -1) return null
  const WINDOW = 45
  const start = Math.max(0, idx - WINDOW)
  const end = Math.min(rawText.length, idx + entityName.length + WINDOW)
  return {
    before: (start > 0 ? '…' : '') + rawText.slice(start, idx),
    match: rawText.slice(idx, idx + entityName.length),
    after: rawText.slice(idx + entityName.length, end) + (end < rawText.length ? '…' : ''),
  }
}

interface Props {
  open: boolean
  selectedLogId: number | null
  onClose: () => void
  entityToShow?: string | null
  onSelectLog: (id: number) => void
  refreshKey?: number
  onEntityMerged?: () => void
  onLogChanged?: () => void
  onBack?: () => void
}

export default function RightRail({ open, selectedLogId, onClose, entityToShow, onSelectLog, refreshKey, onEntityMerged, onLogChanged, onBack }: Props) {
  const [log, setLog] = useState<LogDetail | null>(null)
  const [selectedEntity, setSelectedEntity] = useState<EntityDetail | null>(null)

  useEffect(() => {
    if (!selectedLogId) { setLog(null); return }
    fetchLog(selectedLogId).then(setLog)
  }, [selectedLogId, refreshKey])

  // Respond to external entity-click requests (e.g. from chip row)
  useEffect(() => {
    if (entityToShow) fetchEntity(entityToShow).then(setSelectedEntity)
  }, [entityToShow])

  if (!open) return null

  // Derive per-entity isConfirmed: true if any annotation for that name is user-linked or accepted
  const entities = (() => {
    if (!log) return []
    const groups = new Map<string, { type: string; isConfirmed: boolean }>()
    for (const a of log.annotations) {
      if (a.status === 'rejected' || !ENTITY_TYPES.includes(a.type)) continue
      const name = a.value ?? ''
      if (!name) continue
      if (!groups.has(name)) groups.set(name, { type: a.type, isConfirmed: false })
      if (a.provenance === 'user' || a.status === 'accepted') {
        groups.get(name)!.isConfirmed = true
      }
    }
    return Array.from(groups.entries()).map(([value, { type, isConfirmed }]) => ({ type, value, isConfirmed }))
  })()

  // Suggested annotations for the currently viewed entity in this log
  const pendingSuggestions: Annotation[] = selectedEntity && log
    ? log.annotations.filter(a =>
        (a.corrected_value ?? a.value)?.toLowerCase() === selectedEntity.name.toLowerCase() &&
        a.provenance !== 'user' &&
        a.status !== 'accepted' &&
        a.status !== 'rejected'
      )
    : []

  const handleSuggestionConfirmed = () => {
    if (!selectedLogId) return
    fetchLog(selectedLogId).then(setLog)
    onLogChanged?.()
  }

  return (
    <div className="w-full md:w-64 shrink-0 flex flex-col h-full bg-white border-l border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Mobile: single chevron, goes back one level */}
          {selectedEntity ? (
            <button
              onClick={() => setSelectedEntity(null)}
              className="md:hidden text-gray-400 hover:text-gray-600 p-1 -ml-1 shrink-0"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          ) : onBack ? (
            <button
              onClick={onBack}
              className="md:hidden text-gray-400 hover:text-gray-600 p-1 -ml-1 shrink-0"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          ) : null}

          {/* Desktop: full breadcrumb */}
          {selectedEntity ? (
            <div className="hidden md:flex items-center gap-1 min-w-0 text-sm">
              <button onClick={() => setSelectedEntity(null)} className="text-gray-400 hover:text-gray-700 shrink-0">Context</button>
              <span className="text-gray-300">›</span>
              <span className="font-medium text-gray-800 truncate">{selectedEntity.name}</span>
            </div>
          ) : (
            <span className="hidden md:block text-sm font-medium text-gray-700">Context</span>
          )}

          {/* Mobile: title label */}
          <span className="md:hidden text-sm font-medium text-gray-700">
            {selectedEntity ? selectedEntity.name : 'Context'}
          </span>
        </div>
        <button
          onClick={onClose}
          className="hidden md:block text-gray-400 hover:text-gray-700 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Log anchor strip */}
      {log && (() => {
        const snippet = selectedEntity ? getEntitySnippet(log.raw_text.replace(/\[\[([^\]]+)\]\]|\{([^}]+)\}/g, (_, a, b) => a ?? b), selectedEntity.name) : null
        const c = selectedEntity ? colorFor(selectedEntity.type) : null
        return (
          <button
            onClick={() => onSelectLog(log.id)}
            className="w-full px-4 py-2 border-b border-gray-100 bg-gray-50 hover:bg-gray-100 transition-colors text-left shrink-0 block"
          >
            <div className="text-xs text-gray-400">
              {relativeDate(log.created_at)}
            </div>
            {snippet ? (
              <div className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                <span>{snippet.before}</span>
                <span className="font-semibold rounded px-0.5" style={{ backgroundColor: c?.bg, color: c?.text }}>{snippet.match}</span>
                <span>{snippet.after}</span>
              </div>
            ) : (
              <div className="text-xs text-gray-600 truncate mt-0.5">
                <AnnotatedText text={log.raw_text.split('\n').find(l => l.trim()) ?? ''} />
              </div>
            )}
          </button>
        )
      })()}

      <div className="flex-1 overflow-y-auto">
        {selectedEntity ? (
          <EntityDetailView
            entity={selectedEntity}
            onSelectLog={onSelectLog}
            onUpdated={setSelectedEntity}
            onDeleted={() => setSelectedEntity(null)}
            onMerged={winner => { setSelectedEntity(winner); onEntityMerged?.() }}
            pendingSuggestions={pendingSuggestions}
            onSuggestionConfirmed={handleSuggestionConfirmed}
          />
        ) : (
          <ContextPanel
            entities={entities}
            onSelectEntity={name => fetchEntity(name).then(setSelectedEntity)}
          />
        )}
      </div>
    </div>
  )
}

function ContextPanel({
  entities,
  onSelectEntity,
}: {
  entities: { type: string; value: string; isConfirmed: boolean }[]
  onSelectEntity: (name: string) => void
}) {
  if (entities.length === 0) {
    return (
      <p className="text-xs text-gray-400 text-center mt-8 px-4">
        No annotations detected
      </p>
    )
  }

  const grouped = entities.reduce<Record<string, typeof entities>>((acc, e) => {
    if (!acc[e.type]) acc[e.type] = []
    acc[e.type].push(e)
    return acc
  }, {})

  return (
    <div className="px-3 py-3 space-y-4">
      {Object.entries(grouped).map(([type, items]) => {
        const c = colorFor(type)
        return (
          <div key={type}>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 px-1">
              {type}s
            </div>
            {items.map(({ value, isConfirmed }) => (
              <button
                key={value}
                onClick={() => onSelectEntity(value)}
                className="w-full flex items-center gap-2 px-2 py-3 rounded hover:bg-gray-50 text-left"
              >
                {isConfirmed
                  ? <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
                  : <span className="w-2 h-2 rounded-full shrink-0 border-2" style={{ borderColor: c.dot }} />
                }
                <span className="text-sm text-gray-800 flex-1">{value}</span>
                <span className="text-gray-300 text-xs">›</span>
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

