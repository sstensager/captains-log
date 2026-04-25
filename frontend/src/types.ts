// Annotation states:
//   suggested  — LLM-detected, user has not reviewed
//   accepted   — user confirmed this reference is real (soft confirm, no text change)
//   corrected  — user supplied a corrected value
//   rejected   — user dismissed this reference
//
// provenance:
//   'user'     → confirmed link — user explicitly wrote [[Name]] in the log text
//   otherwise  → suggested — LLM-detected (e.g. 'gpt-4o-mini/v2.0')
//
// Visual rule: isSuggested = provenance !== 'user' && status !== 'accepted'
export interface Annotation {
  id: number
  log_id: number
  type: string
  value: string | null
  confidence: number | null
  status: 'suggested' | 'accepted' | 'rejected' | 'corrected'
  corrected_value: string | null
  span_start: number | null
  span_end: number | null
  provenance: string | null
}

export interface LogSummary {
  id: number
  raw_text: string
  created_at: string
  updated_at: string | null
  source: 'text' | 'voice'
  annotation_types: string[]
  tags: string[]
}

export interface LogDetail extends LogSummary {
  annotations: Annotation[]
  tags: string[]
}

export interface EntitySummary {
  id: number
  name: string
  type: string
  status: string
  ref_count: number
}

export interface AttributeOut {
  attr_type: string  // 'rating' | 'age' | 'fact'
  key: string
  value: string
  source_log_id: number | null
  source_ts: string | null
}

export interface MentionOut {
  log_id: number
  excerpt: string
  raw_text: string
  ts: string
  tags: string[]
}

export interface RelationshipOut {
  label: string
  target_name: string
  target_type: string
  direction: 'outgoing' | 'incoming'
}

export interface EntityDetail {
  id: number
  name: string
  type: string
  status: string
  user_notes: string | null
  attributes: AttributeOut[]
  mentions: MentionOut[]
  relationships: RelationshipOut[]
}

export interface TaskEntityRef {
  name: string
  type: string
}

export interface TaskOut {
  id: number
  title: string
  status: string
  source_log_id: number | null
  tags: string[]
  entities: TaskEntityRef[]
  log_preview: string | null
  log_created_at: string | null
  indent: number
  section: string | null
}

export interface AdminStats {
  logs: number
  annotations: number
  entities: number
  embeddings: number
}
