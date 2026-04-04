import { useEffect, useRef } from 'react'
import { relativeDate } from '../../utils/time'
import type { LogSummary } from '../../types'
import AnnotatedText from '../AnnotatedText'

interface Props {
  log: LogSummary
  active: boolean
  activeTag: string | null
  onClick: () => void
  onTagClick: (tag: string | null) => void
}

export default function LogListItem({ log, active, activeTag, onClick, onTagClick }: Props) {
  const ref = useRef<HTMLButtonElement>(null)
  const previewText = log.raw_text.replace(/\n+/g, ' ')

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={`w-full text-left px-3 py-3 rounded-lg border transition-colors ${
        active
          ? 'bg-white border-gray-300 shadow-sm'
          : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-500">
          {relativeDate(log.created_at)}
        </span>
        {log.source === 'voice' && (
          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
            voice
          </span>
        )}
      </div>

      <p className="text-sm text-gray-800 leading-snug line-clamp-2 mb-2">
        <AnnotatedText text={previewText} maxLength={120} />
      </p>

      {log.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {log.tags.map(tag => (
            <span
              key={tag}
              onClick={e => { e.stopPropagation(); onTagClick(activeTag === tag ? null : tag) }}
              className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                activeTag === tag
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-400 bg-gray-100 hover:bg-gray-200'
              }`}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
