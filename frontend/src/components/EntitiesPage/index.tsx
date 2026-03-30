import { useEffect, useRef, useState } from 'react'
import { fetchEntities, fetchEntity, createEntity } from '../../api'
import type { EntityDetail, EntitySummary } from '../../types'
import { colorFor } from '../../colors'
import EntityDetailView from '../EntityDetail'

const ENTITY_TYPES = ['person', 'place', 'pet', 'organization', 'event', 'thing', 'idea']

export default function EntitiesPage({
  onSelectLog,
}: {
  onSelectLog: (id: number) => void
}) {
  const [entities, setEntities] = useState<EntitySummary[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<EntityDetail | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const listRef = useRef<HTMLDivElement>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('person')
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const newNameRef = useRef<HTMLInputElement>(null)

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

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    setCreateError(null)
    try {
      const entity = await createEntity(name, newType)
      setEntities(prev => [...prev, { id: entity.id, name: entity.name, type: entity.type, status: entity.status, ref_count: 0 }])
      setSelected(entity)
      setCreating(false)
      setNewName('')
      setNewType('person')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create entity'
      setCreateError(msg.includes('409') ? 'An entity with that name already exists.' : msg)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (creating) setTimeout(() => newNameRef.current?.focus(), 0)
  }, [creating])

  return (
    <div className="flex flex-1 min-h-0">
      {/* List panel */}
      <div className="w-72 shrink-0 flex flex-col border-r border-gray-200 bg-white">
        {/* Search + filter */}
        <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">
          <div className="flex gap-1.5">
            <input
              autoFocus={!creating}
              type="text"
              placeholder="Search…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="flex-1 text-sm px-3 py-1.5 rounded border border-gray-200 outline-none focus:border-gray-400 bg-gray-50"
            />
            <button
              onClick={() => { setCreating(c => !c); setCreateError(null) }}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${creating ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}
              title="New entity"
            >
              + New
            </button>
          </div>

          {creating && (
            <div className="space-y-1.5 pb-1">
              <input
                ref={newNameRef}
                type="text"
                placeholder="Name…"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') { setCreating(false); setNewName('') }
                }}
                className="w-full text-sm px-2.5 py-1.5 rounded border border-gray-200 outline-none focus:border-gray-400 bg-white"
              />
              <div className="flex gap-1.5">
                <select
                  value={newType}
                  onChange={e => setNewType(e.target.value)}
                  className="flex-1 text-xs px-2 py-1.5 rounded border border-gray-200 outline-none focus:border-gray-400 bg-white"
                >
                  {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button
                  onClick={handleCreate}
                  disabled={saving || !newName.trim()}
                  className="text-xs px-2.5 py-1 bg-gray-900 text-white rounded disabled:opacity-40"
                >
                  {saving ? 'Adding…' : 'Add'}
                </button>
              </div>
              {createError && <p className="text-xs text-red-500">{createError}</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setTypeFilter('all')}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                typeFilter === 'all'
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
              }`}
            >
              All
            </button>
            {['person', 'place', 'pet', 'organization', 'event', 'thing', 'idea'].map(t => {
              const c = colorFor(t)
              const active = typeFilter === t
              return (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-opacity hover:opacity-75"
                  style={active
                    ? { backgroundColor: '#111827', borderColor: '#111827', color: '#fff' }
                    : { backgroundColor: c.bg, borderColor: c.border, color: c.text }
                  }
                >
                  {!active && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.dot }} />}
                  {t}
                </button>
              )
            })}
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
            onDeleted={() => {
              setEntities(prev => prev.filter(e => e.id !== selected.id))
              setSelected(null)
            }}
            onMerged={winner => {
              // Remove the loser from list, update winner's entry, navigate to winner
              setEntities(prev => prev.filter(e => e.id !== selected.id))
              fetchEntities().then(all => setEntities(all))
              setSelected(winner)
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
