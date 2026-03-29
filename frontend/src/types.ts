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
}

export interface LogSummary {
  id: number
  raw_text: string
  created_at: string
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
  indent: number
  section: string | null
}

export interface AdminStats {
  logs: number
  annotations: number
  entities: number
  embeddings: number
}
