export interface StoreColor {
  key: string
  bg: string
  border: string
  text: string
  dot: string
}

export const STORE_PALETTE: StoreColor[] = [
  { key: 'blue',   bg: '#E6F1FB', border: '#85B7EB', text: '#0C447C', dot: '#3B82F6' },
  { key: 'green',  bg: '#EAF3DE', border: '#97C459', text: '#27500A', dot: '#65A30D' },
  { key: 'orange', bg: '#FAEEDA', border: '#EF9F27', text: '#633806', dot: '#EA580C' },
  { key: 'purple', bg: '#EEEDFE', border: '#AFA9EC', text: '#3C3489', dot: '#7C3AED' },
  { key: 'red',    bg: '#FAECE7', border: '#F0997B', text: '#712B13', dot: '#DC2626' },
  { key: 'teal',   bg: '#E1F5EE', border: '#5DCAA5', text: '#085041', dot: '#0D9488' },
  { key: 'amber',  bg: '#FEF3E7', border: '#F5A623', text: '#6B3A00', dot: '#D97706' },
  { key: 'pink',   bg: '#FCE7F3', border: '#F472B6', text: '#831843', dot: '#DB2777' },
  { key: 'cyan',   bg: '#F0F9FF', border: '#7DD3FC', text: '#0C4A6E', dot: '#0891B2' },
  { key: 'slate',  bg: '#F1F5F9', border: '#94A3B8', text: '#1E293B', dot: '#475569' },
]

const FALLBACK: StoreColor = { key: 'gray', bg: '#F3F4F6', border: '#D1D5DB', text: '#374151', dot: '#9CA3AF' }

export function colorForStore(colorKey: string | null | undefined): StoreColor {
  return STORE_PALETTE.find(c => c.key === colorKey) ?? FALLBACK
}

// Picks the first palette color not already in use, so new stores look
// distinct by default; falls back to cycling once the palette is exhausted.
export function nextAvailableStoreColor(usedKeys: (string | null | undefined)[]): string {
  const used = new Set(usedKeys.filter(Boolean) as string[])
  const free = STORE_PALETTE.find(c => !used.has(c.key))
  return free ? free.key : STORE_PALETTE[usedKeys.length % STORE_PALETTE.length].key
}
