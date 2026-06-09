import type { AdminStats, EntityDetail, EntitySummary, GeneratedListOut, GeneratedListSummary, LogDetail, LogSummary, QueryHistoryItem, QueryResponse, TaskOut } from './types'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`)
  return res.json()
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`)
  return res.json()
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`)
  return res.json()
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export const fetchLogs = (): Promise<LogSummary[]> =>
  get('/logs')

export const searchLogs = (q: string): Promise<LogSummary[]> =>
  get(`/logs/search?q=${encodeURIComponent(q)}`)

export const fetchLog = (id: number): Promise<LogDetail> =>
  get(`/logs/${id}`)

export const createLog = (
  raw_text: string,
  latitude?: number | null,
  longitude?: number | null,
): Promise<LogDetail> =>
  post('/logs', { raw_text, latitude, longitude })

export const updateLog = (id: number, raw_text: string): Promise<LogDetail> =>
  patch(`/logs/${id}`, { raw_text })

export const patchLogTags = (id: number, user_tags: string[]): Promise<LogDetail> =>
  patch(`/logs/${id}/tags`, { user_tags })

export const reparseLog = (id: number): Promise<LogDetail> =>
  post(`/logs/${id}/reparse`)

export const deleteLog = (id: number): Promise<void> =>
  fetch(`/api/logs/${id}`, { method: 'DELETE' }).then(res => {
    if (!res.ok) throw new Error(`DELETE /logs/${id} → ${res.status}`)
  })

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const fetchTasks = (logId: number): Promise<TaskOut[]> =>
  get(`/tasks?log_id=${logId}`)

export const fetchAllTasks = (): Promise<TaskOut[]> =>
  get('/tasks')

export const patchTask = (id: number, status: string): Promise<TaskOut> =>
  patch(`/tasks/${id}`, { status })

export const quickAddTaskToLog = (logId: number, title: string): Promise<TaskOut> =>
  post(`/logs/${logId}/quick-task`, { title })

// ── Annotations ───────────────────────────────────────────────────────────────

export const patchAnnotation = (
  id: number,
  status: string,
  corrected_value?: string,
) => patch(`/annotations/${id}`, { status, corrected_value })

export const promoteAnnotation = (id: number): Promise<LogDetail> =>
  post(`/annotations/${id}/promote`)

export const relinkAnnotation = (id: number, targetName: string): Promise<LogDetail> =>
  post(`/annotations/${id}/relink`, { target_name: targetName })

// ── Entities ──────────────────────────────────────────────────────────────────

export const fetchEntityTypes = (): Promise<string[]> =>
  get('/entity-types')

export const fetchEntities = (): Promise<EntitySummary[]> =>
  get('/entities')

export const createEntity = (canonical_name: string, entity_type: string): Promise<EntityDetail> =>
  post('/entities', { canonical_name, entity_type })

export const fetchEntity = (name: string): Promise<EntityDetail> =>
  get(`/entities/${encodeURIComponent(name)}`)

export const updateEntity = (
  id: number,
  data: { canonical_name?: string; user_notes?: string; entity_type?: string },
): Promise<EntityDetail> =>
  patch(`/entities/${id}`, data)

export const deleteEntity = async (id: number): Promise<void> => {
  const res = await fetch(`${BASE}/entities/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE /entities/${id} → ${res.status}`)
}

export const mergeEntity = (id: number, targetId: number): Promise<EntityDetail> =>
  post(`/entities/${id}/merge`, { target_id: targetId })

export const addAttribute = (entityId: number, key: string, value: string): Promise<EntityDetail> =>
  post(`/entities/${entityId}/attributes`, { key, value })

export const updateAttribute = (attrId: number, data: { key?: string; value?: string }): Promise<EntityDetail> =>
  patch(`/attributes/${attrId}`, data)

export const deleteAttribute = (attrId: number): Promise<EntityDetail> =>
  del(`/attributes/${attrId}`)

// ── Admin ─────────────────────────────────────────────────────────────────────

export const fetchStats = (): Promise<AdminStats> =>
  get('/admin/stats')

export const adminReset = (): Promise<{ ok: boolean; message: string }> =>
  post('/admin/reset')

export const adminLoadFixtures = (embeddings = false) =>
  post(`/admin/load-fixtures?embeddings=${embeddings}`)

export const adminEmbed = () =>
  post('/admin/embed')

// ── NLQ ───────────────────────────────────────────────────────────────────────

export const naturalLanguageQuery = (q: string): Promise<QueryResponse> => {
  const today = new Date().toISOString().slice(0, 10)
  return get(`/query?q=${encodeURIComponent(q)}&today=${today}`)
}

export const fetchQueryHistory = (): Promise<QueryHistoryItem[]> =>
  get('/query/history')

// ── Generated Lists ───────────────────────────────────────────────────────────

export const createGeneratedList = (
  filter: { kind: 'entity' | 'tag'; value: string }
): Promise<GeneratedListOut> =>
  post('/generated-lists', { filter })

export const fetchGeneratedLists = (): Promise<GeneratedListSummary[]> =>
  get('/generated-lists')

export const fetchGeneratedList = (id: number): Promise<GeneratedListOut> =>
  get(`/generated-lists/${id}`)

export const patchGeneratedList = (
  id: number,
  body: {
    title?: string
    feedback?: string
    add_inline_task?: { text: string; section_index: number }
    toggle_inline_task?: { section_index: number; task_index: number; checked: boolean }
  },
): Promise<GeneratedListOut> =>
  patch(`/generated-lists/${id}`, body)

export const deleteGeneratedList = async (id: number): Promise<void> => {
  const res = await fetch(`/api/generated-lists/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`DELETE /generated-lists/${id} → ${res.status}`)
}
