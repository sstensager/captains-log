import { useEffect, useRef, useState } from 'react'
import {
  createStore, deleteStore, patchStore,
  patchShoppingItem, deleteShoppingItem, searchShoppingItems,
  fetchPurchases, patchPurchase, deletePurchase, fetchAddEvents,
} from '../../api'
import type { ShoppingAddEvent, ShoppingItem, ShoppingPurchase, ShoppingStore } from '../../types'
import StoreTagInput from './StoreTagInput'
import ItemPicker from './ItemPicker'
import { STORE_PALETTE, colorForStore, nextAvailableStoreColor } from '../../storeColors'

type SortMode = 'recent' | 'stale' | 'most' | 'least'

interface Props {
  stores: ShoppingStore[]
  onStoresChange: (stores: ShoppingStore[]) => void
}

function EditableDate({ value, onSave }: { value: string; onSave: (next: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])

  const commit = () => {
    setEditing(false)
    if (draft && draft !== value) onSave(draft)
    else setDraft(value)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        className="text-xs bg-transparent border-b border-gray-400 outline-none"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        autoFocus
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-xs text-gray-600 hover:underline decoration-dotted underline-offset-2"
      title="Click to edit purchase date"
    >
      {value}
    </button>
  )
}

function ColorDotPicker({ value, onChange }: { value: string | null; onChange: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const current = colorForStore(value)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-label="Change color"
        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
      >
        <span className="w-3.5 h-3.5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: current.dot }} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 bg-white border border-gray-200 rounded-lg shadow-md z-30 p-2 flex flex-wrap gap-2 w-44">
          {STORE_PALETTE.map(c => (
            <button
              key={c.key}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(c.key); setOpen(false) }}
              title={c.key}
              className="w-6 h-6 rounded-full shrink-0"
              style={{
                backgroundColor: c.dot,
                boxShadow: c.key === value ? '0 0 0 2px #fff, 0 0 0 4px #111827' : '0 0 0 1px rgba(0,0,0,0.1)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ManageView({ stores, onStoresChange }: Props) {
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [purchasesByItem, setPurchasesByItem] = useState<Record<number, ShoppingPurchase[]>>({})
  const [addEventsByItem, setAddEventsByItem] = useState<Record<number, ShoppingAddEvent[]>>({})
  const [newStoreName, setNewStoreName] = useState('')
  const [relinkingPurchaseId, setRelinkingPurchaseId] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<SortMode>('recent')
  const [manageStoreId, setManageStoreId] = useState<number | null>(null)

  // Manage needs the whole catalog (up to a generous cap), not the top-20 the
  // fast-add typeahead asks for — client-side sort below only sees what's fetched.
  const loadItems = (q: string, sid: number | null) => {
    searchShoppingItems(q, sid, true, 500).then(setItems)
  }

  useEffect(() => { loadItems(query, manageStoreId) }, [manageStoreId])

  const toggleExpand = (item: ShoppingItem) => {
    if (expandedId === item.id) { setExpandedId(null); return }
    setExpandedId(item.id)
    if (!purchasesByItem[item.id]) {
      fetchPurchases(item.id).then(p => setPurchasesByItem(prev => ({ ...prev, [item.id]: p })))
    }
    if (!addEventsByItem[item.id]) {
      fetchAddEvents(item.id).then(a => setAddEventsByItem(prev => ({ ...prev, [item.id]: a })))
    }
  }

  // Merges the two permanent logs — "listed" (ShoppingAddEvent) and "bought"
  // (ShoppingPurchase) — into one chronological history per item.
  type TimelineEntry =
    | { kind: 'added'; at: string; key: string }
    | { kind: 'bought'; at: string; key: string; purchase: ShoppingPurchase }

  const buildTimeline = (itemId: number): TimelineEntry[] => {
    const adds = addEventsByItem[itemId] ?? []
    const purchases = purchasesByItem[itemId] ?? []
    const entries: TimelineEntry[] = [
      ...adds.map(a => ({ kind: 'added' as const, at: a.added_at, key: `a${a.id}` })),
      ...purchases.map(p => ({ kind: 'bought' as const, at: p.purchased_at, key: `p${p.id}`, purchase: p })),
    ]
    return entries.sort((a, b) => b.at.localeCompare(a.at))
  }

  const handleEditPurchaseDate = (itemId: number, purchase: ShoppingPurchase, next: string) => {
    patchPurchase(purchase.id, { purchased_at: next }).then(updated => {
      setPurchasesByItem(prev => ({
        ...prev,
        [itemId]: prev[itemId]
          .map(p => p.id === updated.id ? updated : p)
          .sort((a, b) => b.purchased_at.localeCompare(a.purchased_at)),
      }))
      loadItems(query, manageStoreId)
    })
  }

  const handleDeletePurchase = (itemId: number, purchaseId: number) => {
    deletePurchase(purchaseId).then(() => {
      setPurchasesByItem(prev => ({ ...prev, [itemId]: prev[itemId].filter(p => p.id !== purchaseId) }))
      loadItems(query, manageStoreId)
    })
  }

  // Reassigning a purchase to a different item — refetch both the source and
  // destination item's purchase history unconditionally (not just invalidate-
  // and-wait-for-lazy-refetch), since the source item is very likely the one
  // currently expanded, and cache deletion alone wouldn't retrigger its view.
  const handleRelinkPurchase = (sourceItemId: number, purchase: ShoppingPurchase, newItem: ShoppingItem) => {
    patchPurchase(purchase.id, { item_id: newItem.id }).then(() => {
      Promise.all([
        fetchPurchases(sourceItemId).then(p => setPurchasesByItem(prev => ({ ...prev, [sourceItemId]: p }))),
        fetchPurchases(newItem.id).then(p => setPurchasesByItem(prev => ({ ...prev, [newItem.id]: p }))),
      ]).then(() => setRelinkingPurchaseId(null))
      loadItems(query, manageStoreId)
    })
  }

  const handleArchiveToggle = (item: ShoppingItem) => {
    patchShoppingItem(item.id, { archived: !item.archived }).then(() => loadItems(query, manageStoreId))
  }

  const handleDeleteItem = (item: ShoppingItem) => {
    if (!confirm(`Delete "${item.name}"? This erases its purchase history.`)) return
    deleteShoppingItem(item.id).then(() => loadItems(query, manageStoreId))
  }

  const handleUpdateItemStores = (item: ShoppingItem, storeIds: number[]) => {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, store_ids: storeIds } : i))
    patchShoppingItem(item.id, { store_ids: storeIds }).catch(() => loadItems(query, manageStoreId))
  }

  const sortedItems = [...items].sort((a, b) => {
    switch (sortBy) {
      case 'recent':
        if (a.last_purchased_at == null && b.last_purchased_at == null) return 0
        if (a.last_purchased_at == null) return 1
        if (b.last_purchased_at == null) return -1
        return b.last_purchased_at.localeCompare(a.last_purchased_at)
      case 'stale':
        if (a.last_purchased_at == null && b.last_purchased_at == null) return 0
        if (a.last_purchased_at == null) return -1
        if (b.last_purchased_at == null) return 1
        return a.last_purchased_at.localeCompare(b.last_purchased_at)
      case 'most':
        return b.purchase_count - a.purchase_count
      case 'least':
        return a.purchase_count - b.purchase_count
    }
  })

  const handleAddStore = () => {
    const name = newStoreName.trim()
    if (!name) return
    const color = nextAvailableStoreColor(stores.map(s => s.color))
    createStore(name, color).then(store => {
      onStoresChange([...stores, store].sort((a, b) => a.name.localeCompare(b.name)))
      setNewStoreName('')
    })
  }

  const handleChangeStoreColor = (store: ShoppingStore, color: string) => {
    onStoresChange(stores.map(s => s.id === store.id ? { ...s, color } : s))
    patchStore(store.id, { color }).catch(() => {})
  }

  const handleArchiveStore = (store: ShoppingStore) => {
    patchStore(store.id, { archived: !store.archived }).then(updated => {
      onStoresChange(stores.map(s => s.id === updated.id ? updated : s))
    })
  }

  const handleDeleteStore = (store: ShoppingStore) => {
    deleteStore(store.id)
      .then(() => onStoresChange(stores.filter(s => s.id !== store.id)))
      .catch(() => alert('Store has purchase history — archive it instead of deleting.'))
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-6">
      {/* Stores */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Stores</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {stores.map(store => {
            const c = colorForStore(store.color)
            return (
              <span
                key={store.id}
                className="inline-flex items-center gap-1 text-xs pl-1 pr-2 py-1 rounded-full border"
                style={store.archived
                  ? { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB', color: '#9CA3AF' }
                  : { backgroundColor: c.bg, borderColor: c.border, color: c.text }
                }
              >
                <ColorDotPicker value={store.color} onChange={color => handleChangeStoreColor(store, color)} />
                {store.name}
                <button onClick={() => handleArchiveStore(store)} className="hover:opacity-70" title={store.archived ? 'Unarchive' : 'Archive'}>
                  {store.archived ? '↺' : '⊘'}
                </button>
                <button onClick={() => handleDeleteStore(store)} className="hover:text-red-600" title="Delete">×</button>
              </span>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newStoreName}
            onChange={e => setNewStoreName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddStore() }}
            placeholder="New store…"
            className="text-sm border border-gray-200 rounded-md px-2 py-1 outline-none focus:border-gray-400 placeholder-gray-400"
          />
          <button onClick={handleAddStore} className="text-xs px-2 py-1 rounded bg-gray-900 text-white">Add</button>
        </div>
      </div>

      {/* Items */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="p-4 border-b border-gray-100 space-y-2">
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); loadItems(e.target.value, manageStoreId) }}
            placeholder="Search items…"
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 outline-none focus:border-gray-400 placeholder-gray-400"
          />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortMode)}
            className="text-xs border border-gray-200 rounded-md px-2 py-1 outline-none focus:border-gray-400"
          >
            <option value="recent">Recently bought</option>
            <option value="stale">Not bought in a while</option>
            <option value="most">Most purchased</option>
            <option value="least">Least purchased</option>
          </select>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => setManageStoreId(null)}
              className={`text-xs px-3 py-1 rounded-full border shrink-0 transition-colors ${
                manageStoreId === null ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-500'
              }`}
            >
              All stores
            </button>
            {stores.map(store => {
              const c = colorForStore(store.color)
              const active = manageStoreId === store.id
              return (
                <button
                  key={store.id}
                  onClick={() => setManageStoreId(store.id)}
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
        </div>
        <div>
          {sortedItems.map(item => (
            <div key={item.id} className="border-t border-gray-50 first:border-t-0">
              <div className="flex items-center gap-3 px-4 py-2.5">
                <button onClick={() => toggleExpand(item)} className="flex-1 min-w-0 text-left flex items-center gap-2">
                  <svg
                    className={`w-3 h-3 shrink-0 text-gray-400 transition-transform ${expandedId === item.id ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className={`text-sm truncate ${item.archived ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{item.name}</span>
                  {item.last_purchased_at && (
                    <span className="text-xs text-gray-400 shrink-0">last {item.last_purchased_at}</span>
                  )}
                </button>
                <button onClick={() => handleArchiveToggle(item)} className="text-xs text-gray-400 hover:text-gray-700 shrink-0" title={item.archived ? 'Unarchive' : 'Archive'}>
                  {item.archived ? '↺' : '⊘'}
                </button>
                <button onClick={() => handleDeleteItem(item)} className="text-xs text-gray-400 hover:text-red-600 shrink-0" title="Delete">×</button>
              </div>
              {expandedId === item.id && (
                <div className="px-4 pb-3 pl-9 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-gray-400 shrink-0">Stores:</span>
                    <StoreTagInput
                      stores={stores}
                      selectedIds={item.store_ids}
                      onChange={ids => handleUpdateItemStores(item, ids)}
                      onStoreCreated={s => onStoresChange([...stores, s].sort((a, b) => a.name.localeCompare(b.name)))}
                    />
                    <span className="text-xs text-gray-300 italic">(none = any store)</span>
                  </div>
                  <div className="space-y-1">
                    {buildTimeline(item.id).map(entry => (
                      <div key={entry.key}>
                        <div className="flex items-center gap-2 text-xs">
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            entry.kind === 'added' ? 'bg-gray-100 text-gray-500' : 'bg-emerald-50 text-emerald-600'
                          }`}>
                            {entry.kind === 'added' ? 'Listed' : 'Bought'}
                          </span>
                          {entry.kind === 'bought' ? (
                            <EditableDate value={entry.purchase.purchased_at} onSave={next => handleEditPurchaseDate(item.id, entry.purchase, next)} />
                          ) : (
                            <span className="text-gray-600">{entry.at.slice(0, 10)}</span>
                          )}
                          {entry.kind === 'bought' && entry.purchase.store_name && (
                            <span className="text-gray-400">· {entry.purchase.store_name}</span>
                          )}
                          {entry.kind === 'bought' && (
                            <>
                              <button
                                onClick={() => setRelinkingPurchaseId(relinkingPurchaseId === entry.purchase.id ? null : entry.purchase.id)}
                                className="text-gray-300 hover:text-gray-700 ml-auto"
                                title="Reassign to a different item"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4.5 9a8 8 0 0113.9-3M19.5 15a8 8 0 01-13.9 3" />
                                </svg>
                              </button>
                              <button onClick={() => handleDeletePurchase(item.id, entry.purchase.id)} className="text-gray-300 hover:text-red-600">×</button>
                            </>
                          )}
                        </div>
                        {entry.kind === 'bought' && relinkingPurchaseId === entry.purchase.id && (
                          <div className="mt-1">
                            <ItemPicker
                              storeId={entry.purchase.store_id ?? undefined}
                              autoFocus
                              onResolve={newItem => handleRelinkPurchase(item.id, entry.purchase, newItem)}
                              onCancel={() => setRelinkingPurchaseId(null)}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                    {buildTimeline(item.id).length === 0 && (
                      <div className="text-xs text-gray-300 italic">No history yet</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {sortedItems.length === 0 && (
            <div className="p-6 text-sm text-gray-400 text-center">No items yet — add some from the List tab.</div>
          )}
        </div>
      </div>
    </div>
  )
}
