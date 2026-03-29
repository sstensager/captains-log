import React from 'react'
import type { Annotation } from '../types'
import { colorFor } from '../colors'

const ENTITY_TYPES = new Set(['person', 'place'])

export function buildHighlightedBody(
  rawText: string,
  annotations: Annotation[],
  onEntityClick: (name: string) => void,
): React.ReactNode {
  const spans = annotations
    .filter(a =>
      a.span_start != null &&
      a.span_end != null &&
      a.span_end > a.span_start! &&
      ENTITY_TYPES.has(a.type) &&
      a.status !== 'rejected'
    )
    .sort((a, b) => (a.span_start ?? 0) - (b.span_start ?? 0))

  if (spans.length === 0) return <>{rawText}</>

  const nodes: React.ReactNode[] = []
  let cursor = 0

  for (const ann of spans) {
    const start = ann.span_start!
    const end = ann.span_end!

    if (start < cursor) continue // skip overlapping
    if (start > cursor) nodes.push(rawText.slice(cursor, start))

    const c = colorFor(ann.type)
    const entityName = ann.corrected_value ?? ann.value ?? ''

    nodes.push(
      <mark
        key={ann.id}
        onClick={entityName ? () => onEntityClick(entityName) : undefined}
        style={{
          backgroundColor: c.bg,
          borderBottom: `2px solid ${c.border}`,
          cursor: entityName ? 'pointer' : 'default',
          borderRadius: '2px',
          padding: '0 1px',
          fontStyle: 'inherit',
        }}
      >
        {rawText.slice(start, end)}
      </mark>
    )
    cursor = end
  }

  if (cursor < rawText.length) nodes.push(rawText.slice(cursor))
  return <>{nodes}</>
}
