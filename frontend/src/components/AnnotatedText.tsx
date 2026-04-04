import { useEntityTypes } from '../contexts/EntityTypeContext'
import { colorFor } from '../colors'

interface Props {
  text: string
  /** Max characters to show before truncating. Truncation happens on clean text. */
  maxLength?: number
  className?: string
}

// Matches [[Name]] (confirmed) and {Name} (suggested) markers
const MARKER_RE = /\[\[([^\]]+)\]\]|\{([^}]+)\}/g

export default function AnnotatedText({ text, maxLength, className }: Props) {
  const entityTypes = useEntityTypes()

  const segments: React.ReactNode[] = []
  let cursor = 0
  let cleanLength = 0
  let truncated = false

  for (const match of text.matchAll(MARKER_RE)) {
    const isHard = match[1] !== undefined  // [[Name]]
    const name = (match[1] ?? match[2]).trim()
    const matchStart = match.index!
    const matchEnd = matchStart + match[0].length

    // Plain text before this marker
    const before = text.slice(cursor, matchStart)
    if (maxLength !== undefined && cleanLength + before.length >= maxLength) {
      segments.push(before.slice(0, maxLength - cleanLength) + '…')
      truncated = true
      break
    }
    if (before) segments.push(before)
    cleanLength += before.length

    if (maxLength !== undefined && cleanLength + name.length > maxLength) {
      segments.push(name.slice(0, maxLength - cleanLength) + '…')
      truncated = true
      cursor = matchEnd
      break
    }

    // Colored entity span
    const type = entityTypes.get(name.toLowerCase())
    const c = type ? colorFor(type) : null
    segments.push(
      <span
        key={matchStart}
        style={c ? {
          color: c.text,
          textDecorationColor: c.border,
          textDecoration: isHard ? 'underline' : 'underline',
          textDecorationStyle: isHard ? 'solid' : 'dashed',
        } : undefined}
      >
        {name}
      </span>
    )
    cleanLength += name.length
    cursor = matchEnd
  }

  if (!truncated) {
    const tail = text.slice(cursor)
    if (maxLength !== undefined && cleanLength + tail.length > maxLength) {
      segments.push(tail.slice(0, maxLength - cleanLength) + '…')
    } else {
      segments.push(tail)
    }
  }

  return <span className={className}>{segments}</span>
}
