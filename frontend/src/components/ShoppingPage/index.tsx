import { useEffect, useState } from 'react'
import { fetchStores } from '../../api'
import type { ShoppingStore } from '../../types'
import ActiveListView from './ActiveListView'
import SuggestionsView from './SuggestionsView'
import ManageView from './ManageView'

type Tab = 'list' | 'suggestions' | 'manage'

const TABS: { key: Tab; label: string }[] = [
  { key: 'list', label: 'List' },
  { key: 'suggestions', label: 'Suggestions' },
  { key: 'manage', label: 'Manage' },
]

export default function ShoppingPage() {
  const [tab, setTab] = useState<Tab>('list')
  const [stores, setStores] = useState<ShoppingStore[]>([])

  useEffect(() => {
    fetchStores().then(setStores)
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 w-full">
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 bg-white shrink-0">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`text-sm px-3 py-1 rounded transition-colors ${
              tab === key ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
        {tab === 'list' ? (
          <ActiveListView stores={stores} />
        ) : tab === 'suggestions' ? (
          <SuggestionsView />
        ) : (
          <ManageView stores={stores} onStoresChange={setStores} />
        )}
      </div>
    </div>
  )
}
