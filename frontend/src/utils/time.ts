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

  if (diffDays === 0) {
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    return `${Math.floor(diffMin / 60)}h ago`
  }
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

// Coarser than relativeDate() — stays relative indefinitely (days/weeks/months/years)
// instead of switching to an absolute date after a day. For contexts like "added to
// the list" where the rough age matters more than the exact date.
export function agoLabel(isoString: string): string {
  const date = parseUtc(isoString)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000)

  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) {
    const weeks = Math.round(diffDays / 7)
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
  }
  if (diffDays < 365) {
    const months = Math.round(diffDays / 30.44)
    return months <= 1 ? '1 month ago' : `${months} months ago`
  }
  const years = Math.round(diffDays / 365.25)
  return years <= 1 ? '1 year ago' : `${years} years ago`
}
