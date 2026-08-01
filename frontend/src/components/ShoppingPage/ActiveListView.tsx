import { useEffect, useRef, useState } from 'react'
import { addToActiveList, checkOffEntry, createShoppingItem, fetchActiveList, fetchSuggestions, patchShoppingItem, relinkActiveEntry, removeActiveEntry, searchShoppingItems } from '../../api'
import type { ShoppingActiveEntry, ShoppingItem, ShoppingStore, ShoppingSuggestion } from '../../types'
import StoreTagInput from './StoreTagInput'
import ItemPicker from './ItemPicker'
import { colorForStore } from '../../storeColors'

interface Props {
  stores: ShoppingStore[]
  onStoresChange: (stores: ShoppingStore[]) => void
}

export default function ActiveListView({ stores, onStoresChange }: Props) {
  const [storeId, setStoreId] = useState<number | null>(null)
  const [entries, setEntries] = useState<ShoppingActiveEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [suggestions, setSuggestions] = useState<ShoppingItem[]>([])
  const [dueItems, setDueItems] = useState<ShoppingSuggestion[]>([])
  const [browseItems, setBrowseItems] = useState<ShoppingItem[]>([])
  const [addingDueIds, setAddingDueIds] = useState<Set<number>>(new Set())
  const [newItemTags, setNewItemTags] = useState<number[]>([])
  const [editingTagsFor, setEditingTagsFor] = useState<number | null>(null)
  const [relinkingFor, setRelinkingFor] = useState<number | null>(null)
  const [relinkErrorFor, setRelinkErrorFor] = useState<Record<number, string>>({})
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [updating, setUpdating] = useState(false)
  const debounceRef = useRef<number | undefined>(undefined)
  const justSubmittedRef = useRef(false)

  const load = (sid: number | null) => {
    fetchActiveList(sid).then(data => { setEntries(data); setLoading(false) })
  }

  useEffect(() => { load(storeId) }, [storeId])

  // Items the repurchase heuristic thinks are due, plus the most recently/frequently
  // bought items for this store — together, the "best guess" shown the moment you tap
  // into the field, before typing a single character. Fetched alongside the active
  // list refresh so the guess is ready instantly on focus, not fetched-on-focus.
  useEffect(() => {
    fetchSuggestions(storeId).then(setDueItems)
    searchShoppingItems('', storeId).then(setBrowseItems)
  }, [storeId])

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

  // Merge the two prediction signals for the empty-query "best guess" dropdown:
  // overdue-for-repurchase items first (strongest signal for "need it now"), then
  // fill remaining slots with other items known for this store, ranked by recency/
  // frequency. Anything already on the active list is excluded from both — no point
  // guessing what's already sitting in front of you.
  const activeItemIds = new Set(entries.map(e => e.item_id))
  const dueIds = new Set(dueItems.map(d => d.item_id))
  const guessDue = dueItems
    .filter(d => !activeItemIds.has(d.item_id))
    .map(d => ({ kind: 'due' as const, id: d.item_id, name: d.item_name, hint: 'usually about now', data: d }))
  const guessBrowse = browseItems
    .filter(b => !activeItemIds.has(b.id) && !dueIds.has(b.id))
    .slice(0, Math.max(0, 8 - guessDue.length))
    .map(b => ({ kind: 'browse' as const, id: b.id, name: b.name, hint: b.last_purchased_at ? `last ${b.last_purchased_at}` : null, data: b }))
  const guesses = [...guessDue, ...guessBrowse]
  const visibleSuggestions = suggestions.filter(s => !activeItemIds.has(s.id))

  const pushOptimistic = (label: string) => {
    const tempId = -Date.now()
    setEntries(prev => [...prev, { id: tempId, item_id: -1, item_name: label, note: null, added_at: '', store_ids: [] }])
    return tempId
  }

  const settleOptimistic = (tempId: number, real: ShoppingActiveEntry | null) => {
    setEntries(prev => real ? prev.map(e => e.id === tempId ? real : e) : prev.filter(e => e.id !== tempId))
  }

  // Adding an item you've added before — one tap, no tag editing, keeps the fast path fast.
  // If a store filter is active, the item picks up that store's tag too (building
  // a Costco list while filtered to Costco should tag everything you add as Costco).
  const addExistingEntry = async (item: ShoppingItem) => {
    const tempId = pushOptimistic(item.name)
    setQuery('')
    setSuggestions([])
    try {
      if (storeId != null && !item.store_ids.includes(storeId)) {
        await patchShoppingItem(item.id, { store_ids: [...item.store_ids, storeId] })
      }
      const real = await addToActiveList({ item_id: item.id })
      settleOptimistic(tempId, real)
      setDueItems(prev => prev.filter(d => d.item_id !== item.id))
      setBrowseItems(prev => prev.filter(b => b.id !== item.id))
    } catch {
      settleOptimistic(tempId, null)
    }
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
      setDueItems(prev => prev.filter(d => d.item_id !== item.id))
      setBrowseItems(prev => prev.filter(b => b.id !== item.id))
    } catch {
      settleOptimistic(tempId, null)
    }
  }

  // Tapping a "due" guess — same fast path as re-adding a known item, just
  // sourced from the repurchase heuristic instead of typed search.
  const addDueItem = async (s: ShoppingSuggestion) => {
    setAddingDueIds(prev => new Set(prev).add(s.item_id))
    const tempId = pushOptimistic(s.item_name)
    try {
      const real = await addToActiveList({ item_id: s.item_id })
      settleOptimistic(tempId, real)
      setDueItems(prev => prev.filter(d => d.item_id !== s.item_id))
      setBrowseItems(prev => prev.filter(b => b.id !== s.item_id))
    } catch {
      settleOptimistic(tempId, null)
    } finally {
      setAddingDueIds(prev => { const next = new Set(prev); next.delete(s.item_id); return next })
    }
  }

  const handleSubmit = () => {
    if (!trimmedQuery) return
    justSubmittedRef.current = true
    const exact = suggestions.find(s => s.name.toLowerCase() === trimmedQuery.toLowerCase())
    if (exact) {
      addExistingEntry(exact)
    } else {
      const effectiveTags = storeId != null && !newItemTags.includes(storeId) ? [...newItemTags, storeId] : newItemTags
      addNewEntry(trimmedQuery, effectiveTags)
    }
  }

  // Tapping/clicking anywhere outside the whole add area (name field, suggestions,
  // tag picker) commits whatever's pending — no separate "confirm" step needed.
  const handleAddAreaBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setFocused(false)
    if (justSubmittedRef.current) { justSubmittedRef.current = false; return }
    if (trimmedQuery) handleSubmit()
  }

  // Tapping the checkbox only stages it (strikethrough, stays on screen) — a
  // mis-tap is trivial to undo. "Update" is what actually commits the checkoffs.
  const toggleChecked = (entryId: number) => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })
  }

  const handleUpdate = async () => {
    const ids = [...checkedIds]
    if (ids.length === 0) return
    setUpdating(true)
    const results = await Promise.allSettled(
      ids.map(id => checkOffEntry(id, storeId != null ? { store_id: storeId } : {}))
    )
    const succeededIds = ids.filter((_, i) => results[i].status === 'fulfilled')
    if (succeededIds.length > 0) {
      setEntries(prev => prev.filter(e => !succeededIds.includes(e.id)))
      setCheckedIds(prev => {
        const next = new Set(prev)
        succeededIds.forEach(id => next.delete(id))
        return next
      })
    }
    if (succeededIds.length < ids.length) load(storeId) // some failed — resync with server
    setUpdating(false)
  }

  const remove = (entry: ShoppingActiveEntry) => {
    setEntries(prev => prev.filter(e => e.id !== entry.id))
    removeActiveEntry(entry.id).catch(() => load(storeId))
  }

  const updateEntryTags = (entry: ShoppingActiveEntry, ids: number[]) => {
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, store_ids: ids } : e))
    patchShoppingItem(entry.item_id, { store_ids: ids }).catch(() => load(storeId))
  }

  // Repointing this row to a different item — e.g. same product, different
  // brand grabbed on sale. Not a rename: the old and new items keep independent
  // purchase histories, which is the whole reason this exists instead of just
  // editing the item's name in place.
  const relinkEntry = async (entry: ShoppingActiveEntry, item: ShoppingItem) => {
    setRelinkErrorFor(prev => { const { [entry.id]: _omit, ...rest } = prev; return rest })
    try {
      if (storeId != null && !item.store_ids.includes(storeId)) {
        await patchShoppingItem(item.id, { store_ids: [...item.store_ids, storeId] })
      }
      const updated = await relinkActiveEntry(entry.id, item.id)
      setEntries(prev => prev.map(e => e.id === entry.id ? updated : e))
      setRelinkingFor(null)
    } catch (err) {
      const message = String(err).includes('409') ? 'Already on the list' : 'Could not relink — try again'
      setRelinkErrorFor(prev => ({ ...prev, [entry.id]: message }))
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Store picker — one tap to filter the list to a specific store */}
      <div className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto shrink-0">
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => setStoreId(null)}
          className={`text-xs px-3 py-1 rounded-full border shrink-0 transition-colors ${
            storeId === null ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          All stores
        </button>
        {stores.map(store => {
          const c = colorForStore(store.color)
          const active = storeId === store.id
          return (
            <button
              key={store.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => setStoreId(store.id)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border shrink-0 transition-colors"
              style={active
                ? { backgroundColor: c.dot, borderColor: c.dot, color: '#fff' }
                : { backgroundColor: c.bg, borderColor: c.border, color: c.text }
              }
            >
              {!active && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />}
              {store.name}
            </button>
          )
        })}
      </div>

      {/* Fast add — autocompletes against items you've added before */}
      <div className="relative px-4 pb-3 shrink-0 space-y-1.5" onBlur={handleAddAreaBlur}>
        <input
          type="text"
          value={query}
          onFocus={() => setFocused(true)}
          onChange={e => { setQuery(e.target.value); justSubmittedRef.current = false; if (!e.target.value.trim()) setNewItemTags([]) }}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
          placeholder="Add an item…"
          enterKeyHint="done"
          className="w-full text-sm bg-white border border-gray-200 rounded-md px-3 py-2 outline-none focus:border-gray-400 placeholder-gray-400"
        />
        {/* Empty query, field focused — best guess before you've typed a thing:
            overdue-for-repurchase items first, then other known-for-this-store items. */}
        {trimmedQuery === '' && focused && guesses.length > 0 && (
          <div className="absolute left-4 right-4 top-[42px] mt-1 bg-white border border-gray-200 rounded-md shadow-sm z-10 overflow-hidden">
            {guesses.map(g => (
              <button
                key={`${g.kind}-${g.id}`}
                onMouseDown={e => e.preventDefault()}
                onClick={() => g.kind === 'due' ? addDueItem(g.data) : addExistingEntry(g.data)}
                disabled={g.kind === 'due' && addingDueIds.has(g.id)}
                className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-50 flex items-center justify-between disabled:opacity-50"
              >
                <span className="truncate">{g.name}</span>
                {g.hint && <span className={`text-xs shrink-0 ml-2 ${g.kind === 'due' ? 'text-indigo-500' : 'text-gray-400'}`}>{g.hint}</span>}
              </button>
            ))}
          </div>
        )}
        {/* Typed query — narrows to matching items, refining as you type. */}
        {trimmedQuery !== '' && visibleSuggestions.length > 0 && (
          <div className="absolute left-4 right-4 top-[42px] mt-1 bg-white border border-gray-200 rounded-md shadow-sm z-10 overflow-hidden">
            {visibleSuggestions.map(s => (
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
            const tags = stores.filter(s => entry.store_ids.includes(s.id))
            const editing = editingTagsFor === entry.id
            const checked = checkedIds.has(entry.id)
            return (
              <div key={entry.id} className="border-t border-gray-100 bg-white">
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <button
                    onClick={() => toggleChecked(entry.id)}
                    aria-label="Mark as bought"
                    className="shrink-0 flex items-center justify-center w-10 h-10 -m-3 rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors"
                  >
                    <span
                      className="w-4 h-4 rounded border flex items-center justify-center text-[10px] leading-none"
                      style={checked ? { backgroundColor: '#111827', borderColor: '#111827', color: '#fff' } : { borderColor: '#9CA3AF' }}
                    >
                      {checked && '✓'}
                    </span>
                  </button>
                  <div className="flex-1 min-w-0">
                    {relinkErrorFor[entry.id] && (
                      <div className="text-[11px] text-red-600 mb-0.5">{relinkErrorFor[entry.id]}</div>
                    )}
                    {relinkingFor === entry.id ? (
                      <ItemPicker
                        storeId={storeId}
                        autoFocus
                        initialText={entry.item_name}
                        onResolve={item => relinkEntry(entry, item)}
                        onCancel={() => setRelinkingFor(null)}
                      />
                    ) : (
                      <div className={`text-sm truncate ${checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                        {entry.item_name}
                      </div>
                    )}
                    {/* Store chips live inside this same flex-1 column (not a sibling
                        row below the whole card) so the row's items-center measures
                        the true two-line height — otherwise the checkbox/icons only
                        see the name line and visually sit high above the chip. */}
                    {!editing && tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tags.map(s => {
                          const c = colorForStore(s.color)
                          return (
                            <span key={s.id} className="text-[10px] leading-4 px-1.5 rounded-full" style={{ backgroundColor: c.bg, color: c.text }}>
                              {s.name}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  {/* Grouped with extra gap so the 40px invisible tap zones (padding +
                      negative-margin trick) don't overlap each other — gap-3 elsewhere
                      in this row is fine since it's not flanked by another small icon. */}
                  <div className="flex items-center gap-6 shrink-0">
                    <button
                      onClick={() => { setEditingTagsFor(null); setRelinkingFor(entry.id) }}
                      aria-label="Change item"
                      className="shrink-0 flex items-center justify-center w-10 h-10 -m-3 rounded-full text-gray-300 hover:bg-gray-100 hover:text-gray-600 active:bg-gray-200 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.68 19.32l1-4L17.18 4.82a1.5 1.5 0 012 2L8.68 17.32l-4 2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => { setRelinkingFor(null); setEditingTagsFor(editing ? null : entry.id) }}
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

      {checkedIds.size > 0 && (
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-t border-gray-200 bg-white">
          <span className="text-xs text-gray-500">{checkedIds.size} checked off</span>
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="text-sm px-4 py-1.5 rounded-lg bg-gray-900 text-white disabled:opacity-50 transition-colors"
          >
            {updating ? 'Updating…' : 'Update'}
          </button>
        </div>
      )}
    </div>
  )
}
