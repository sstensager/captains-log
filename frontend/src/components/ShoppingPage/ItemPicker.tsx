import { useEffect, useRef, useState } from 'react'
import { createShoppingItem, searchShoppingItems } from '../../api'
import type { ShoppingItem } from '../../types'

interface Props {
  storeId?: number | null
  onResolve: (item: ShoppingItem) => void
  onCancel: () => void
  autoFocus?: boolean
}

// Minimal "resolve text to a ShoppingItem" picker — search existing items as you
// type, or create a new one on the fly. Used for relinking an active-list entry
// or a purchase to a different item; not a fit for the main add-item flow in
// ActiveListView, which has its own optimistic-add logic.
export default function ItemPicker({ storeId, onResolve, onCancel, autoFocus = true }: Props) {
  const [text, setText] = useState('')
  const [results, setResults] = useState<ShoppingItem[]>([])
  const [creating, setCreating] = useState(false)
  const debounceRef = useRef<number | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    if (!text.trim()) { setResults([]); return }
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      searchShoppingItems(text, storeId ?? null).then(setResults)
    }, 150)
    return () => window.clearTimeout(debounceRef.current)
  }, [text, storeId])

  const trimmed = text.trim()
  const hasExactMatch = results.some(r => r.name.toLowerCase() === trimmed.toLowerCase())

  const commitCreate = async () => {
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const item = await createShoppingItem(trimmed)
      onResolve(item)
    } finally {
      setCreating(false)
    }
  }

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    onCancel()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { onCancel(); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const exact = results.find(r => r.name.toLowerCase() === trimmed.toLowerCase())
      if (exact) onResolve(exact)
      else if (trimmed) commitCreate()
    }
  }

  return (
    <div className="relative" onBlur={handleBlur}>
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search items…"
        enterKeyHint="done"
        className="w-full text-sm bg-white border border-gray-300 rounded-md px-3 py-1.5 outline-none focus:border-gray-400 placeholder-gray-400"
      />
      {(results.length > 0 || (trimmed && !hasExactMatch)) && (
        <div className="absolute left-0 right-0 top-[34px] mt-1 bg-white border border-gray-200 rounded-md shadow-sm z-20 overflow-hidden max-h-56 overflow-y-auto">
          {results.map(r => (
            <button
              key={r.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => onResolve(r)}
              className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-50 flex items-center justify-between"
            >
              <span className="truncate">{r.name}</span>
              {r.last_purchased_at && <span className="text-xs text-gray-400 shrink-0 ml-2">last {r.last_purchased_at}</span>}
            </button>
          ))}
          {trimmed && !hasExactMatch && (
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={commitCreate}
              disabled={creating}
              className="w-full text-left text-sm px-3 py-1.5 hover:bg-gray-50 text-indigo-600 disabled:opacity-50"
            >
              {creating ? 'Creating…' : `+ Create "${trimmed}"`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
