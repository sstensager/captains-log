interface Props {
  onNewLog: () => void
  hasLogs: boolean
}

export default function EmptyState({ onNewLog, hasLogs }: Props) {
  if (!hasLogs) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8 max-w-sm mx-auto">
        <div className="text-4xl mb-4">📓</div>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Your personal knowledge log</h2>
        <p className="text-sm text-gray-500 mb-5 leading-relaxed">
          Write freely as things happen. The app automatically finds people, places, and action items — then helps you find them later.
        </p>
        <div className="w-full bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6 text-left space-y-2">
          <p className="text-sm text-gray-600 leading-relaxed">
            Had coffee with Sarah at Blue Bottle this morning. She mentioned the Johnson project is on hold. Need to follow up next week.
          </p>
          <p className="text-xs text-gray-400 pt-1 border-t border-gray-100">
            ↑ The app finds: Sarah (person) · Blue Bottle (place) · Johnson project (thing) · follow up (todo)
          </p>
        </div>
        <button
          onClick={onNewLog}
          className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 transition-colors"
        >
          Write your first log
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="text-4xl mb-4">📓</div>
      <h2 className="text-lg font-medium text-gray-700 mb-2">Nothing selected</h2>
      <p className="text-sm text-gray-400 mb-6">
        Pick a log from the list or start a new one.
      </p>
      <button
        onClick={onNewLog}
        className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 transition-colors"
      >
        New log
      </button>
    </div>
  )
}
