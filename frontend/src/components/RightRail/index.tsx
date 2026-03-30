import { useEffect, useState } from 'react'
import { fetchEntity, fetchLog } from '../../api'
import type { Annotation, EntityDetail, LogDetail } from '../../types'
import { colorFor } from '../../colors'
import EntityDetailView from '../EntityDetail'

const ENTITY_TYPES = ['person', 'place', 'pet', 'organization', 'event', 'thing', 'idea']

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
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden text-gray-400 hover:text-gray-700 text-sm"
            >
              ‹ Back
            </button>
          )}
          {selectedEntity ? (
            <button
              onClick={() => setSelectedEntity(null)}
              className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"
            >
              ‹ Context
            </button>
          ) : (
            <span className="text-sm font-medium text-gray-700">Context</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="hidden md:block text-gray-400 hover:text-gray-700 text-lg leading-none"
        >
          ×
        </button>
      </div>

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
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 text-left"
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

