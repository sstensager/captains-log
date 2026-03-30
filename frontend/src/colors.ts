export interface EntityColors {
  bg: string
  border: string
  text: string
  dot: string
}

const COLORS: Record<string, EntityColors> = {
  person:       { bg: '#E6F1FB', border: '#85B7EB', text: '#0C447C', dot: '#85B7EB' },
  place:        { bg: '#EAF3DE', border: '#97C459', text: '#27500A', dot: '#97C459' },
  task:         { bg: '#FAEEDA', border: '#EF9F27', text: '#633806', dot: '#EF9F27' },
  topic:        { bg: '#EEEDFE', border: '#AFA9EC', text: '#3C3489', dot: '#AFA9EC' },
  rating:       { bg: '#FAECE7', border: '#F0997B', text: '#712B13', dot: '#F0997B' },
  date:         { bg: '#E1F5EE', border: '#5DCAA5', text: '#085041', dot: '#5DCAA5' },
  organization: { bg: '#FEF3E7', border: '#F5A623', text: '#6B3A00', dot: '#F5A623' },
  event:        { bg: '#F3E8FF', border: '#C084FC', text: '#4C1D95', dot: '#C084FC' },
  pet:          { bg: '#FFF7ED', border: '#FB923C', text: '#7C2D12', dot: '#FB923C' },
  thing:        { bg: '#F8FAFC', border: '#94A3B8', text: '#1E293B', dot: '#94A3B8' },
  idea:         { bg: '#FEFCE8', border: '#FACC15', text: '#713F12', dot: '#FACC15' },
  age:          { bg: '#F0F9FF', border: '#7DD3FC', text: '#0C4A6E', dot: '#7DD3FC' },
}

const FALLBACK: EntityColors = {
  bg: '#F3F4F6', border: '#9CA3AF', text: '#374151', dot: '#9CA3AF',
}

export function colorFor(type: string): EntityColors {
  return COLORS[type.toLowerCase()] ?? FALLBACK
}
