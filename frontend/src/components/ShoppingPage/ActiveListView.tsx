import { useEffect, useRef, useState } from 'react'
import { addToActiveList, checkOffEntry, fetchActiveList, removeActiveEntry, searchShoppingItems } from '../../api'
import type { ShoppingActiveEntry, ShoppingItem, ShoppingStore } from '../../types'

interface Props {
  stores: ShoppingStore[]
}

export default function ActiveListView({ stores }: Props) {
  const [storeId, setStoreId] = useState<number | null>(null)
  const [entries, setEntries] = useState<ShoppingActiveEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<ShoppingItem[]>([])
  const debounceRef = useRef<number | undefined>(undefined)

  const load = (sid: number | null) => {
    fetchActiveList(sid).then(data => { setEntries(data); setLoading(false) })
  }

  useEffect(() => { load(storeId) }, [storeId])

  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); return }
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      searchShoppingItems(query, storeId).then(setSuggestions)
    }, 150)
    return () => window.clearTimeout(debounceRef.current)
  }, [query, storeId])

  const addEntry = (opts: { item_id?: number; name?: string }) => {
    const label = opts.name ?? suggestions.find(s => s.id === opts.item_id)?.name ?? ''
    const tempId = -Date.now()
    setEntries(prev => [...prev, { id: tempId, item_id: opts.item_id ?? -1, item_name: label, note: null, added_at: '', store_ids: [] }])
    setQuery('')
    setSuggestions([])
    addToActiveList(opts).then(real => {
      setEntries(prev => prev.map(e => e.id === tempId ? real : e))
    }).catch(() => {
      setEntries(prev => prev.filter(e => e.id !== tempId))
    })
  }

  const handleSubmit = () => {
    const trimmed = query.trim()
    if (!trimmed) return
    const exact = suggestions.find(s => s.name.toLowerCase() === trimmed.toLowerCase())
    addEntry(exact ? { item_id: exact.id } : { name: trimmed })
  }

  const checkOff = (entry: ShoppingActiveEntry) => {
    setEntries(prev => prev.filter(e => e.id !== entry.id))
    checkOffEntry(entry.id, storeId != null ? { store_id: storeId } : {}).catch(() => load(storeId))
  }

  const remove = (entry: ShoppingActiveEntry) => {
    setEntries(prev => prev.filter(e => e.id !== entry.id))
    removeActiveEntry(entry.id).catch(() => load(storeId))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Store picker — one tap to filter the list to a specific store */}
      <div className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto shrink-0">
        <button
          onClick={() => setStoreId(null)}
          className={`text-xs px-3 py-1 rounded-full border shrink-0 transition-colors ${
            storeId === null ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          All stores
        </button>
        {stores.map(store => (
          <button
            key={store.id}
            onClick={() => setStoreId(store.id)}
            className={`text-xs px-3 py-1 rounded-full border shrink-0 transition-colors ${
              storeId === store.id ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-500'
            }`}
          >
            {store.name}
          </button>
        ))}
      </div>

      {/* Fast add — autocompletes against items you've added before */}
      <div className="relative px-4 pb-3 shrink-0">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
          placeholder="Add an item…"
          enterKeyHint="done"
          className="w-full text-sm bg-white border border-gray-200 rounded-md px-3 py-2 outline-none focus:border-gray-400 placeholder-gray-400"
        />
        {suggestions.length > 0 && (
          <div className="absolute left-4 right-4 mt-1 bg-white border border-gray-200 rounded-md shadow-sm z-10 overflow-hidden">
            {suggestions.map(s => (
              <button
                key={s.id}
                onClick={() => addEntry({ item_id: s.id })}
                className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-50 flex items-center justify-between"
              >
                <span className="truncate">{s.name}</span>
                {s.last_purchased_at && <span className="text-xs text-gray-400 shrink-0 ml-2">last {s.last_purchased_at}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active items */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">Nothing on the list yet.</div>
        ) : (
          entries.map(entry => (
            <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-100 bg-white">
              <button
                onClick={() => checkOff(entry)}
                className="w-4 h-4 shrink-0 rounded border border-gray-400 hover:bg-gray-100"
              />
              <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">{entry.item_name}</span>
              <button onClick={() => remove(entry)} className="text-gray-300 hover:text-red-600 text-sm shrink-0">×</button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
