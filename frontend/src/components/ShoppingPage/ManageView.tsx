import { useEffect, useRef, useState } from 'react'
import {
  createStore, deleteStore, patchStore,
  patchShoppingItem, deleteShoppingItem, searchShoppingItems,
  fetchPurchases, patchPurchase, deletePurchase,
} from '../../api'
import type { ShoppingItem, ShoppingPurchase, ShoppingStore } from '../../types'
import StoreTagInput from './StoreTagInput'
import { STORE_PALETTE, colorForStore, nextAvailableStoreColor } from '../../storeColors'

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
  const [newStoreName, setNewStoreName] = useState('')

  const loadItems = (q: string) => {
    searchShoppingItems(q, null, true).then(setItems)
  }

  useEffect(() => { loadItems('') }, [])

  const toggleExpand = (item: ShoppingItem) => {
    if (expandedId === item.id) { setExpandedId(null); return }
    setExpandedId(item.id)
    if (!purchasesByItem[item.id]) {
      fetchPurchases(item.id).then(p => setPurchasesByItem(prev => ({ ...prev, [item.id]: p })))
    }
  }

  const handleEditPurchaseDate = (itemId: number, purchase: ShoppingPurchase, next: string) => {
    patchPurchase(purchase.id, { purchased_at: next }).then(updated => {
      setPurchasesByItem(prev => ({
        ...prev,
        [itemId]: prev[itemId]
          .map(p => p.id === updated.id ? updated : p)
          .sort((a, b) => b.purchased_at.localeCompare(a.purchased_at)),
      }))
      loadItems(query)
    })
  }

  const handleDeletePurchase = (itemId: number, purchaseId: number) => {
    deletePurchase(purchaseId).then(() => {
      setPurchasesByItem(prev => ({ ...prev, [itemId]: prev[itemId].filter(p => p.id !== purchaseId) }))
      loadItems(query)
    })
  }

  const handleArchiveToggle = (item: ShoppingItem) => {
    patchShoppingItem(item.id, { archived: !item.archived }).then(() => loadItems(query))
  }

  const handleDeleteItem = (item: ShoppingItem) => {
    if (!confirm(`Delete "${item.name}"? This erases its purchase history.`)) return
    deleteShoppingItem(item.id).then(() => loadItems(query))
  }

  const handleUpdateItemStores = (item: ShoppingItem, storeIds: number[]) => {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, store_ids: storeIds } : i))
    patchShoppingItem(item.id, { store_ids: storeIds }).catch(() => loadItems(query))
  }

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
        <div className="p-4 border-b border-gray-100">
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); loadItems(e.target.value) }}
            placeholder="Search items…"
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 outline-none focus:border-gray-400 placeholder-gray-400"
          />
        </div>
        <div>
          {items.map(item => (
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
                    {(purchasesByItem[item.id] ?? []).map(p => (
                      <div key={p.id} className="flex items-center gap-2 text-xs">
                        <EditableDate value={p.purchased_at} onSave={next => handleEditPurchaseDate(item.id, p, next)} />
                        {p.store_name && <span className="text-gray-400">· {p.store_name}</span>}
                        <button onClick={() => handleDeletePurchase(item.id, p.id)} className="text-gray-300 hover:text-red-600 ml-auto">×</button>
                      </div>
                    ))}
                    {(purchasesByItem[item.id] ?? []).length === 0 && (
                      <div className="text-xs text-gray-300 italic">No purchase history yet</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <div className="p-6 text-sm text-gray-400 text-center">No items yet — add some from the List tab.</div>
          )}
        </div>
      </div>
    </div>
  )
}
