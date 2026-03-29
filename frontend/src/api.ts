import type { AdminStats, EntityDetail, EntitySummary, LogDetail, LogSummary, TaskOut } from './types'

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

// ── Logs ──────────────────────────────────────────────────────────────────────

export const fetchLogs = (): Promise<LogSummary[]> =>
  get('/logs')

export const searchLogs = (q: string): Promise<LogSummary[]> =>
  get(`/logs/search?q=${encodeURIComponent(q)}`)

export const fetchLog = (id: number): Promise<LogDetail> =>
  get(`/logs/${id}`)

export const createLog = (raw_text: string): Promise<LogDetail> =>
  post('/logs', { raw_text })

export const updateLog = (id: number, raw_text: string): Promise<LogDetail> =>
  patch(`/logs/${id}`, { raw_text })

// ── Tasks ─────────────────────────────────────────────────────────────────────

export const fetchTasks = (logId: number): Promise<TaskOut[]> =>
  get(`/tasks?log_id=${logId}`)

export const fetchAllTasks = (): Promise<TaskOut[]> =>
  get('/tasks')

export const patchTask = (id: number, status: string): Promise<TaskOut> =>
  patch(`/tasks/${id}`, { status })

// ── Annotations ───────────────────────────────────────────────────────────────

export const patchAnnotation = (
  id: number,
  status: string,
  corrected_value?: string,
) => patch(`/annotations/${id}`, { status, corrected_value })

// ── Entities ──────────────────────────────────────────────────────────────────

export const fetchEntities = (): Promise<EntitySummary[]> =>
  get('/entities')

export const fetchEntity = (name: string): Promise<EntityDetail> =>
  get(`/entities/${encodeURIComponent(name)}`)

export const updateEntity = (
  id: number,
  data: { canonical_name?: string; user_notes?: string },
): Promise<EntityDetail> =>
  patch(`/entities/${id}`, data)

// ── Admin ─────────────────────────────────────────────────────────────────────

export const fetchStats = (): Promise<AdminStats> =>
  get('/admin/stats')

export const adminReset = (): Promise<{ ok: boolean; message: string }> =>
  post('/admin/reset')

export const adminLoadFixtures = (embeddings = false) =>
  post(`/admin/load-fixtures?embeddings=${embeddings}`)

export const adminEmbed = () =>
  post('/admin/embed')
