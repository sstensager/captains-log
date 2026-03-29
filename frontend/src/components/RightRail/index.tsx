import { useEffect, useState } from 'react'
import { fetchEntity, fetchLog } from '../../api'
import type { EntityDetail, LogDetail } from '../../types'
import { colorFor } from '../../colors'
import EntityDetailView from '../EntityDetail'

interface Props {
  open: boolean
  selectedLogId: number | null
  onClose: () => void
  entityToShow?: string | null
  onSelectLog: (id: number) => void
}

export default function RightRail({ open, selectedLogId, onClose, entityToShow, onSelectLog }: Props) {
  const [log, setLog] = useState<LogDetail | null>(null)
  const [selectedEntity, setSelectedEntity] = useState<EntityDetail | null>(null)

  useEffect(() => {
    if (!selectedLogId) { setLog(null); return }
    fetchLog(selectedLogId).then(setLog)
  }, [selectedLogId])

  // Respond to external entity-click requests (e.g. from chip row)
  useEffect(() => {
    if (entityToShow) fetchEntity(entityToShow).then(setSelectedEntity)
  }, [entityToShow])

  if (!open) return null

  const entities = log
    ? [...new Map(
        log.annotations
          .filter(a => a.status !== 'rejected' && ['person', 'place'].includes(a.type))
          .map(a => [a.value, a])
      ).values()]
    : []

  return (
    <div className="w-64 shrink-0 flex flex-col h-full bg-white border-l border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
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
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 text-lg leading-none"
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
          />
        ) : (
          <ContextPanel
            entities={entities.map(a => ({ type: a.type, value: a.value ?? '' }))}
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
  entities: { type: string; value: string }[]
  onSelectEntity: (name: string) => void
}) {
  const hasEntities = entities.length > 0

  if (!hasEntities) {
    return (
      <p className="text-xs text-gray-400 text-center mt-8 px-4">
        No annotations detected
      </p>
    )
  }

  const grouped = entities.reduce<Record<string, string[]>>((acc, { type, value }) => {
    if (!acc[type]) acc[type] = []
    if (value && !acc[type].includes(value)) acc[type].push(value)
    return acc
  }, {})

  return (
    <div className="px-3 py-3 space-y-4">
      {Object.entries(grouped).map(([type, names]) => {
        const c = colorFor(type)
        return (
          <div key={type}>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5 px-1">
              {type}s
            </div>
            {names.map(name => (
              <button
                key={name}
                onClick={() => onSelectEntity(name)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 text-left"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
                <span className="text-sm text-gray-800 flex-1">{name}</span>
                <span className="text-gray-300 text-xs">›</span>
              </button>
            ))}
          </div>
        )
      })}

    </div>
  )
}

