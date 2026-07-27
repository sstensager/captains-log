import { useEffect, useRef, useState } from 'react'
import { addToActiveList, checkOffEntry, createShoppingItem, fetchActiveList, patchShoppingItem, removeActiveEntry, searchShoppingItems } from '../../api'
import type { ShoppingActiveEntry, ShoppingItem, ShoppingStore } from '../../types'
import StoreTagInput from './StoreTagInput'

interface Props {
  stores: ShoppingStore[]
  onStoresChange: (stores: ShoppingStore[]) => void
}

export default function ActiveListView({ stores, onStoresChange }: Props) {
  const [storeId, setStoreId] = useState<number | null>(null)
  const [entries, setEntries] = useState<ShoppingActiveEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<ShoppingItem[]>([])
  const [newItemTags, setNewItemTags] = useState<number[]>([])
  const [editingTagsFor, setEditingTagsFor] = useState<number | null>(null)
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

  const trimmedQuery = query.trim()
  const isNewItem = trimmedQuery !== '' && !suggestions.some(s => s.name.toLowerCase() === trimmedQuery.toLowerCase())

  const pushOptimistic = (label: string) => {
    const tempId = -Date.now()
    setEntries(prev => [...prev, { id: tempId, item_id: -1, item_name: label, note: null, added_at: '', store_ids: [] }])
    return tempId
  }

  const settleOptimistic = (tempId: number, real: ShoppingActiveEntry | null) => {
    setEntries(prev => real ? prev.map(e => e.id === tempId ? real : e) : prev.filter(e => e.id !== tempId))
  }

  // Adding an item you've added before — one tap, no tag editing, keeps the fast path fast.
  const addExistingEntry = (item: ShoppingItem) => {
    const tempId = pushOptimistic(item.name)
    setQuery('')
    setSuggestions([])
    addToActiveList({ item_id: item.id })
      .then(real => settleOptimistic(tempId, real))
      .catch(() => settleOptimistic(tempId, null))
  }

  // Adding something genuinely new — apply any store tags picked in the inline tag row.
  const addNewEntry = async (name: string, storeIds: number[]) => {
    const tempId = pushOptimistic(name)
    setQuery('')
    setSuggestions([])
    setNewItemTags([])
    try {
      let item = await createShoppingItem(name, storeIds)
      const sameTags = storeIds.length === item.store_ids.length && storeIds.every(id => item.store_ids.includes(id))
      if (storeIds.length > 0 && !sameTags) {
        item = await patchShoppingItem(item.id, { store_ids: storeIds })
      }
      const real = await addToActiveList({ item_id: item.id })
      settleOptimistic(tempId, real)
    } catch {
      settleOptimistic(tempId, null)
    }
  }

  const handleSubmit = () => {
    if (!trimmedQuery) return
    const exact = suggestions.find(s => s.name.toLowerCase() === trimmedQuery.toLowerCase())
    if (exact) addExistingEntry(exact)
    else addNewEntry(trimmedQuery, newItemTags)
  }

  const checkOff = (entry: ShoppingActiveEntry) => {
    setEntries(prev => prev.filter(e => e.id !== entry.id))
    checkOffEntry(entry.id, storeId != null ? { store_id: storeId } : {}).catch(() => load(storeId))
  }

  const remove = (entry: ShoppingActiveEntry) => {
    setEntries(prev => prev.filter(e => e.id !== entry.id))
    removeActiveEntry(entry.id).catch(() => load(storeId))
  }

  const updateEntryTags = (entry: ShoppingActiveEntry, ids: number[]) => {
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, store_ids: ids } : e))
    patchShoppingItem(entry.item_id, { store_ids: ids }).catch(() => load(storeId))
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
      <div className="relative px-4 pb-3 shrink-0 space-y-1.5">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); if (!e.target.value.trim()) setNewItemTags([]) }}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
          placeholder="Add an item…"
          enterKeyHint="done"
          className="w-full text-sm bg-white border border-gray-200 rounded-md px-3 py-2 outline-none focus:border-gray-400 placeholder-gray-400"
        />
        {suggestions.length > 0 && (
          <div className="absolute left-4 right-4 top-[42px] mt-1 bg-white border border-gray-200 rounded-md shadow-sm z-10 overflow-hidden">
            {suggestions.map(s => (
              <button
                key={s.id}
                onClick={() => addExistingEntry(s)}
                className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-50 flex items-center justify-between"
              >
                <span className="truncate">{s.name}</span>
                {s.last_purchased_at && <span className="text-xs text-gray-400 shrink-0 ml-2">last {s.last_purchased_at}</span>}
              </button>
            ))}
          </div>
        )}
        {isNewItem && (
          <StoreTagInput
            stores={stores}
            selectedIds={newItemTags}
            onChange={setNewItemTags}
            onStoreCreated={s => onStoresChange([...stores, s].sort((a, b) => a.name.localeCompare(b.name)))}
          />
        )}
      </div>

      {/* Active items */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">Nothing on the list yet.</div>
        ) : (
          entries.map(entry => {
            const tagNames = stores.filter(s => entry.store_ids.includes(s.id)).map(s => s.name)
            const editing = editingTagsFor === entry.id
            return (
              <div key={entry.id} className="border-t border-gray-100 bg-white">
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <button
                    onClick={() => checkOff(entry)}
                    aria-label="Mark as bought"
                    className="shrink-0 flex items-center justify-center w-10 h-10 -m-3 rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors"
                  >
                    <span className="w-4 h-4 rounded border border-gray-400" />
                  </button>
                  <div className="flex-1 min-w-0 flex items-baseline gap-2">
                    <span className="text-sm text-gray-800 truncate">{entry.item_name}</span>
                    {!editing && tagNames.length > 0 && (
                      <span className="text-xs text-gray-400 truncate shrink-0">{tagNames.join(', ')}</span>
                    )}
                  </div>
                  <button
                    onClick={() => setEditingTagsFor(editing ? null : entry.id)}
                    aria-label="Edit store tags"
                    className={`shrink-0 flex items-center justify-center w-10 h-10 -m-3 rounded-full transition-colors ${
                      editing ? 'bg-gray-100 text-gray-700' : 'text-gray-300 hover:bg-gray-100 hover:text-gray-600 active:bg-gray-200'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5L21 5M3 5L4 7M21 5L20 7M4 7L4 19M20 7L20 19M4 19L20 19M9 19L9 13L15 13L15 19" />
                    </svg>
                  </button>
                  <button
                    onClick={() => remove(entry)}
                    aria-label="Remove from list"
                    className="shrink-0 flex items-center justify-center w-10 h-10 -m-3 rounded-full text-gray-300 hover:bg-gray-100 hover:text-red-600 active:bg-gray-200 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6L18 18M18 6L6 18" />
                    </svg>
                  </button>
                </div>
                {editing && (
                  <div className="px-4 pb-2.5 pl-11">
                    <StoreTagInput
                      stores={stores}
                      selectedIds={entry.store_ids}
                      onChange={ids => updateEntryTags(entry, ids)}
                      onStoreCreated={s => onStoresChange([...stores, s].sort((a, b) => a.name.localeCompare(b.name)))}
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
