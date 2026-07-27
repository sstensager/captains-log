import { useEffect, useState } from 'react'
import { addToActiveList, fetchSuggestions } from '../../api'
import type { ShoppingSuggestion } from '../../types'

export default function SuggestionsView() {
  const [suggestions, setSuggestions] = useState<ShoppingSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [added, setAdded] = useState<Set<number>>(new Set())

  useEffect(() => {
    fetchSuggestions().then(s => { setSuggestions(s); setLoading(false) })
  }, [])

  const handleAdd = (s: ShoppingSuggestion) => {
    setAdded(prev => new Set(prev).add(s.item_id))
    addToActiveList({ item_id: s.item_id }).catch(() => {
      setAdded(prev => { const next = new Set(prev); next.delete(s.item_id); return next })
    })
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>

  if (suggestions.length === 0) {
    return (
      <div className="p-6 text-sm text-gray-400">
        No suggestions yet — an item needs at least two purchases before it can show up here.
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl space-y-2">
      {suggestions.map(s => (
        <div key={s.item_id} className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-800">{s.item_name}</div>
            <div className="text-xs text-gray-400">
              Last bought {s.last_purchased_at} · usually every {s.interval_days}d · {s.days_overdue}d overdue
            </div>
          </div>
          <button
            onClick={() => handleAdd(s)}
            disabled={added.has(s.item_id)}
            className="text-xs px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 transition-colors shrink-0"
          >
            {added.has(s.item_id) ? 'Added ✓' : '+ Add to list'}
          </button>
        </div>
      ))}
    </div>
  )
}
