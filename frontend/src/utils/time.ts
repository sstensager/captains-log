function parseUtc(isoString: string): Date {
  // SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' with no timezone marker.
  // Appending 'Z' ensures it's parsed as UTC rather than local time.
  const normalized = isoString.includes('T') ? isoString : isoString.replace(' ', 'T') + 'Z'
  return new Date(normalized)
}

export function relativeDate(isoString: string): string {
  const date = parseUtc(isoString)
  const now = new Date()

  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((todayOnly.getTime() - dateOnly.getTime()) / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'

  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    ...(!sameYear && { year: 'numeric' }),
  })
}

export function shortTime(isoString: string): string {
  const date = parseUtc(isoString)
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
