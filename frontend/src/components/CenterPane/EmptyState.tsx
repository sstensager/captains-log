interface Props {
  onNewLog: () => void
}

export default function EmptyState({ onNewLog }: Props) {
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
