import { useState } from 'react'
import { createStore } from '../../api'
import type { ShoppingStore } from '../../types'

interface Props {
  stores: ShoppingStore[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
  onStoreCreated: (store: ShoppingStore) => void
}

// Tag-style store picker: type to filter existing stores, Enter with no match
// creates a new store on the fly (same pattern as GitHub labels / Notion tags).
export default function StoreTagInput({ stores, selectedIds, onChange, onStoreCreated }: Props) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)

  const selected = stores.filter(s => selectedIds.includes(s.id))
  const trimmed = text.trim()
  // With no text yet, show every unselected store so tapping the field alone
  // is enough — typing is only needed to filter a long list or create new.
  const candidates = stores.filter(s =>
    !selectedIds.includes(s.id) && (!trimmed || s.name.toLowerCase().includes(trimmed.toLowerCase()))
  )
  const hasExactMatch = trimmed !== '' && stores.some(s => s.name.toLowerCase() === trimmed.toLowerCase())

  const addExisting = (store: ShoppingStore) => {
    onChange([...selectedIds, store.id])
    setText('')
  }

  const removeTag = (id: number) => {
    onChange(selectedIds.filter(sid => sid !== id))
  }

  const commit = async () => {
    if (!trimmed) return
    const exact = stores.find(s => s.name.toLowerCase() === trimmed.toLowerCase())
    if (exact) { addExisting(exact); return }
    const created = await createStore(trimmed)
    onStoreCreated(created)
    onChange([...selectedIds, created.id])
    setText('')
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map(s => (
        <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-gray-900 text-white px-2 py-0.5 rounded-full">
          {s.name}
          <button onClick={() => removeTag(s.id)} className="hover:text-gray-300">×</button>
        </span>
      ))}
      <div className="relative">
        <input
          type="text"
          value={text}
          onChange={e => { setText(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit() }
            else if (e.key === 'Backspace' && !text && selected.length > 0) { removeTag(selected[selected.length - 1].id) }
          }}
          placeholder={selected.length === 0 ? 'Tag a store…' : '+ store'}
          className="text-xs px-2 py-1.5 rounded-full border border-dashed border-gray-300 outline-none focus:border-gray-400 placeholder-gray-400 w-24 focus:w-32 transition-all"
        />
        {open && (candidates.length > 0 || (trimmed && !hasExactMatch)) && (
          <div className="absolute left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-sm z-20 overflow-hidden min-w-[9rem] max-h-56 overflow-y-auto">
            {candidates.map(s => (
              <button
                key={s.id}
                onMouseDown={e => e.preventDefault()}
                onClick={() => addExisting(s)}
                className="w-full text-left text-xs px-3 py-2 hover:bg-gray-50 whitespace-nowrap"
              >
                {s.name}
              </button>
            ))}
            {trimmed && !hasExactMatch && (
              <button
                onMouseDown={e => e.preventDefault()}
                onClick={commit}
                className="w-full text-left text-xs px-3 py-2 hover:bg-gray-50 text-indigo-600 whitespace-nowrap"
              >
                + Create "{trimmed}"
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
