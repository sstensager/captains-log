import { useEffect, useRef, useState } from 'react'
import { fetchEntities, fetchEntity } from '../../api'
import type { EntityDetail, EntitySummary } from '../../types'
import { colorFor } from '../../colors'
import EntityDetailView from '../EntityDetail'

export default function EntitiesPage({
  onSelectLog,
}: {
  onSelectLog: (id: number) => void
}) {
  const [entities, setEntities] = useState<EntitySummary[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<EntityDetail | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | 'person' | 'place'>('all')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchEntities().then(setEntities)
  }, [])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected?.name])

  const filtered = entities.filter(e => {
    const matchesQuery = e.name.toLowerCase().includes(query.toLowerCase())
    const matchesType = typeFilter === 'all' || e.type === typeFilter
    return matchesQuery && matchesType
  })

  const handleSelect = (e: EntitySummary) => {
    fetchEntity(e.name).then(setSelected)
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* List panel */}
      <div className="w-72 shrink-0 flex flex-col border-r border-gray-200 bg-white">
        {/* Search + filter */}
        <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">
          <input
            autoFocus
            type="text"
            placeholder="Search people & places…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full text-sm px-3 py-1.5 rounded border border-gray-200 outline-none focus:border-gray-400 bg-gray-50"
          />
          <div className="flex gap-1">
            {(['all', 'person', 'place'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                  typeFilter === t
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                }`}
              >
                {t === 'all' ? 'All' : t === 'person' ? 'People' : 'Places'}
              </button>
            ))}
          </div>
        </div>

        {/* Entity list */}
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-xs text-gray-400 text-center mt-8 px-4">
              {query ? 'No matches' : 'No entities yet'}
            </p>
          ) : (
            filtered.map(e => {
              const c = colorFor(e.type)
              const isSelected = selected?.name === e.name
              return (
                <button
                  key={e.id}
                  data-selected={isSelected ? 'true' : undefined}
                  onClick={() => handleSelect(e)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-l-2 ${
                    isSelected
                      ? 'bg-gray-100 border-gray-800'
                      : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: c.dot }}
                  />
                  <span className="flex-1 text-sm text-gray-800 truncate">{e.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">{e.ref_count}</span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto bg-white">
        {selected ? (
          <EntityDetailView
            entity={selected}
            onSelectLog={onSelectLog}
            onUpdated={updated => {
              setSelected(updated)
              setEntities(prev => prev.map(e =>
                e.id === updated.id ? { ...e, name: updated.name } : e
              ))
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-400">Select a person or place</p>
          </div>
        )}
      </div>
    </div>
  )
}
