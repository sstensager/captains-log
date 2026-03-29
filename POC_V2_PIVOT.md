# Captain's Log — POC v2 Pivot

*Written March 2026. This document supersedes the v1 architecture for all new work.*

---

## What v1 taught us

v1 was a 6-call pipeline (primer → name extraction → entity extraction → attribute extraction → relationship extraction → QA reviewer) that tried to fully resolve a messy natural-language note into a correct knowledge graph at ingest time. Every guardrail added to the code — canonical labels, type constraints, hallucination filters — was a symptom of the same root problem: we were demanding certainty from a process that cannot be certain.

The result was brittle ingestion, hard-to-pass tests, and a product that felt like "hidden Notion" — structure was mandatory, just invisible to the user.

The core bet of v1 was right: logs should be the source of truth, structure should emerge from use, and the user should never maintain a schema. The mistake was trying to achieve that structure in one eager pass at write time.

v1 is a lightbulb that didn't work. That's useful.

---

## v2 thesis

**Write loosely. Index lightly. Structure progressively.**

- Raw logs are primary and immutable. Always.
- The parser annotates notes; it does not replace them.
- Structure is a reversible layer on top of the log, not a commitment made at ingest time.
- The system should never require the user to "keep it clean" to stay useful.
- The superpower is recall and retrieval, not ingestion.

---

## User flow

### Capture

The user writes or speaks a note. It can be polished or a brain dump. Format doesn't matter.

The note is saved to the database **immediately and unconditionally** — no parsing blocks capture. A failed or slow parse never loses a log.

### Parse (async, non-blocking)

Within 1-2 seconds of save, a single LLM pass runs in the background and produces soft annotations: detected entities, candidate tasks, dates, topics, ratings, relationship hints. These appear in the UI as inline chips or highlights — suggestions, not commitments.

For text input, a lightweight real-time layer (heuristics / regex) can highlight probable entities *as you type*, giving the feel of live recognition. The LLM pass on save confirms or refines those hints.

### Disambiguation

Annotation chips are interactive. Tapping one opens a small UI:

- **Confirm** — accept the suggestion as-is
- **Edit** — correct the entity name or type
- **Link** — connect to an existing entity instead of creating a new one
- **Dismiss** — reject this annotation

User actions write to `Annotation.status`. The original note text is never touched.

### Browse / entity pages

Every confirmed entity has a page. The entity page is a filtered view: all logs that reference this entity, each showing the relevant excerpt. No separate maintained profile — the page is generated from `EntityReference` rows.

Tapping "Jennifer" shows every note where Jennifer was mentioned, with the exact excerpt that triggered the link, in reverse chronological order.

### Retrieval / query

Two modes:

1. **Browse and filter** — scroll logs, filter by entity, date, annotation type, status
2. **Natural language query** — "what campsites did I rate highly?", "show me everything about my Tahoe trip", "what tasks are open?" — answered using raw text + semantic search + annotation index

### Background reconciliation (later)

An async background pass notices patterns: "Jennifer appears in 12 logs, all resolving to the same entity — promote to stable." Or: "These 3 notes all mention a place that looks like Kirk Creek — suggest linking them." This runs silently, surfaces as gentle suggestions. Never blocks anything.

---

## When does structure happen?


| Moment                | What happens                                       |
| --------------------- | -------------------------------------------------- |
| Keystroke (text)      | Lightweight heuristic hints (optional, no LLM)     |
| Save                  | Log written immediately; LLM parse triggered async |
| ~1-2s after save      | Annotations appear as chips in UI                  |
| User taps a chip      | Disambiguation: confirm / edit / link / dismiss    |
| Background (periodic) | Entity reconciliation, promotion suggestions       |
| Never                 | Forced schema entry, mandatory field completion    |


---

## Data model

Seven tables. The first five handle capture and annotation. The last two handle promoted structure.

```sql
Log
  id              INTEGER PRIMARY KEY
  raw_text        TEXT NOT NULL
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  source_type     TEXT NOT NULL DEFAULT 'text'   -- 'text' | 'audio_transcript'
  embedding       BLOB                            -- added when retrieval is wired up

Annotation
  id              INTEGER PRIMARY KEY
  log_id          INTEGER NOT NULL REFERENCES Log(id)
  type            TEXT NOT NULL   -- see annotation types below
  start_char      INTEGER         -- span in raw_text (null = whole-log annotation)
  end_char        INTEGER
  text_span       TEXT            -- the literal matched text
  value           TEXT            -- normalized value (ISO date, canonical name guess, etc.)
  confidence      REAL            -- 0.0–1.0
  status          TEXT NOT NULL DEFAULT 'suggested'  -- 'suggested'|'accepted'|'rejected'|'corrected'
  corrected_value TEXT            -- if user edited the annotation
  provenance      TEXT            -- parser version / model used

Entity
  id              INTEGER PRIMARY KEY
  canonical_name  TEXT NOT NULL
  entity_type     TEXT NOT NULL   -- see entity types below
  status          TEXT NOT NULL DEFAULT 'tentative'  -- 'tentative'|'stable'|'merged'
  merged_into_id  INTEGER REFERENCES Entity(id)
  created_from_log_id INTEGER REFERENCES Log(id)
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))

EntityReference
  id              INTEGER PRIMARY KEY
  entity_id       INTEGER NOT NULL REFERENCES Entity(id)
  log_id          INTEGER NOT NULL REFERENCES Log(id)
  annotation_id   INTEGER REFERENCES Annotation(id)
  excerpt         TEXT            -- clipped span from the log (the key display primitive)
  confidence      REAL
  role            TEXT            -- optional: 'subject'|'mentioned'|'location'|etc.
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))

Attribute
  id              INTEGER PRIMARY KEY
  entity_id       INTEGER NOT NULL REFERENCES Entity(id)
  log_id          INTEGER NOT NULL REFERENCES Log(id)  -- provenance
  key             TEXT NOT NULL
  value           TEXT NOT NULL
  status          TEXT NOT NULL DEFAULT 'suggested'   -- same status enum as Annotation
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))

-- Promoted from candidate_task annotations. Checkboxes are first-class.
Task
  id              INTEGER PRIMARY KEY
  title           TEXT NOT NULL           -- short action title ("Buy diapers", "Book dentist")
  status          TEXT NOT NULL DEFAULT 'todo'  -- 'todo'|'in_progress'|'done'|'cancelled'
  due_date        TEXT                    -- ISO 8601, nullable
  source_log_id   INTEGER REFERENCES Log(id)
  source_annotation_id INTEGER REFERENCES Annotation(id)
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))

-- Soft entity-to-entity edges. Handles belonging, containment, membership.
-- Promoted from candidate_relationship_hint annotations or [[linking]] syntax.
EntityRelationship
  id              INTEGER PRIMARY KEY
  entity_a_id     INTEGER NOT NULL REFERENCES Entity(id)
  label           TEXT NOT NULL   -- free text, not canonical: "belongs to", "character in", "item on"
  entity_b_id     INTEGER NOT NULL REFERENCES Entity(id)
  status          TEXT NOT NULL DEFAULT 'suggested'  -- 'suggested'|'confirmed'
  source_log_id   INTEGER REFERENCES Log(id)
  source_annotation_id INTEGER REFERENCES Annotation(id)
  confidence      REAL
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
```

### What each table is for


| Table              | Created when                                     | Answers                              |
| ------------------ | ------------------------------------------------ | ------------------------------------ |
| Log                | Immediately on save                              | "What did I write?"                  |
| Annotation         | ~1s after save (parser)                          | "What might be in this note?"        |
| Entity             | User confirms a mention                          | "Who/what is this?"                  |
| EntityReference    | Entity confirmed                                 | "Which notes mention this entity?"   |
| Attribute          | User promotes a fact                             | "What do I know about this entity?"  |
| Task               | User promotes a task annotation                  | "What do I need to do?" + checkboxes |
| EntityRelationship | User confirms a relationship hint or uses `[[]]` | "How do these things relate?"        |


### Why EntityRelationship is not v1's Relationship table

v1 wrote relationship rows at ingest time from every note, with canonical labels enforced by type constraints. It was brittle because it demanded certainty at the wrong moment.

`EntityRelationship` is promoted, not inferred. It only gets written when:

- The user confirms a `candidate_relationship_hint` chip, or
- The user explicitly types `[[entity name]]` establishing a link

The label is **free text** — "belongs to", "character in", "item on", whatever fits. No CANONICAL_LABELS. No type constraints. The same table handles "Kirk Creek belongs to Big Sur" and "The Apostle is a character in Spaceship Story" and "Diapers is an item on the Costco list."

### Annotation types

```
candidate_person
candidate_place
candidate_organization
candidate_event
candidate_task         -- "need to", "must", "planning to"
candidate_date         -- any date/time expression
candidate_rating       -- "8/10", "loved it", "terrible"
candidate_topic        -- subject/theme label
candidate_relationship_hint  -- "my wife", "works with", "introduced me to"
candidate_artifact     -- umbrella for things that might be promoted later
```

### Entity types

```
Person
Place
Organization
Event
Task
Topic          -- ideas, themes, recurring subjects
```

Dates are **not** entity types — they live as `candidate_date` annotations and `date` attributes on entities.

---

## Parser design (single pass)

Replace the entire v1 pipeline with **one structured LLM call**.

**Input:** raw_text, current_date, narrator_name

**Output (structured JSON):**

```json
{
  "mentions": [
    {
      "text": "Jennifer",
      "start": 5,
      "end": 13,
      "candidate_type": "candidate_person",
      "canonical_name_guess": "Jennifer",
      "confidence": 0.95
    }
  ],
  "annotations": [
    {
      "type": "candidate_task",
      "text_span": "need to call her back",
      "value": "Call Jennifer",
      "confidence": 0.85
    },
    {
      "type": "candidate_date",
      "text_span": "last Tuesday",
      "value": "2026-03-17",
      "confidence": 0.9
    },
    {
      "type": "candidate_rating",
      "text_span": "8/10",
      "value": "8/10",
      "confidence": 0.99
    }
  ]
}
```

**The key shift:** the model is answering "what might be here?" not "what is the canonical database truth?" It can be usefully right at 70-80% confidence. That was never achievable in v1 where the only passing state was exact correctness.

**Cost target:** one `gpt-4o-mini` call per log. ~$0.001–0.002 per note.

---

## Retrieval design

Three layers, composable:

1. **SQLite FTS** on `Log.raw_text` — fast keyword search
2. **Semantic embedding search** on `Log.embedding` — "what campsites did I like?" catches semantic variants
3. **Entity / annotation index** — filter by entity_id, annotation type, date range, status

Layer 3 improves entity-centric queries. Layers 1-2 are the minimum for useful retrieval. Embeddings go on `Log.raw_text` from day one.

---

## What we're de-scoping from v1


| v1 feature                                   | v2 disposition                                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| CANONICAL_SCHEMA at ingest                   | Removed — types are suggestions, not enforced constraints                                                                                     |
| LABEL_CONSTRAINTS enforcement                | Removed — relationships are annotations with confidence                                                                                       |
| Multi-phase pipeline                         | Replaced by single-pass parser                                                                                                                |
| Fuzzy entity dedup at ingest                 | Moved to background reconciliation step                                                                                                       |
| Graph-correctness tests                      | Replaced by annotation quality + retrieval usefulness tests                                                                                   |
| Relationship table (authoritative at ingest) | Replaced by `EntityRelationship` (promoted from annotations or `[[]]` links, user-confirmed, free-text labels — never written at ingest time) |


---

## Success criteria for POC v2

**Not:** does the graph look correct?

**Yes:**

1. Raw logs are always preserved and retrievable
2. Single-pass parser produces plausible annotations on realistic notes
3. Entity pages can be generated from `EntityReference` excerpts alone
4. Natural language queries return relevant logs (FTS + embeddings)
5. The system produces useful output on messy/fragmented/voice-style input without failing

---

## POC milestones

### M1 — Single-pass parser

- New schema: Log + Annotation tables
- Single LLM call → Annotation rows
- Test: given 5 realistic notes, do annotations look right?
- Establish annotation quality eval rubric (not graph correctness)

### M2 — Entity reference layer

- Entity + EntityReference tables
- Promotion: accepted annotations → EntityReference rows
- Test: entity page view from excerpts only (no attributes needed)

### M3 — Retrieval

- SQLite FTS on raw_text
- Log.embedding column + embedding on save
- Test: "what campsites did I like?" returns the right logs
- Measure: FTS vs embedding vs annotation index for different query types

### M4 — Promotion prototype

- Attribute table wired (promoted facts only)
- Tentative → stable entity promotion (manual trigger)
- Test: do promoted entities make retrieval better?

### M5 — End-to-end notebook demo

- Seed 10-15 realistic logs (people, places, tasks, ratings, brain dumps)
- Run M1–M4 against all of them
- Answer 5 product-style queries
- Evaluate: would a user trust this?

---

## What we are building toward (not now, but designing for)

- Mobile-first capture: text or voice memo, one tap
- Voice → Whisper transcript → same parse path as text
- Entity pages with excerpt-first display
- Query interface: natural language or filter UI
- Background reconciliation surfacing as gentle nudges
- No user-maintained schema, ever

