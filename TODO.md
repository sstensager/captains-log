# Captain's Log — TODO

*Last updated: 2026-04-02*

---

## Direction

**Core use case:** passive entity memory — write naturally, pull up everything about a person or place later.
- "What did we think about the campsites at Kirk Creek?"
- "What are Beth's kids' names?"
- "What did we order last time at Osteria Mozza?"

---

## Recently Shipped

- Single-pass LLM parser (person + place → 7 entity types, false-positive heuristics)
- Annotation → Entity → EntityReference promotion pipeline with fuzzy dedup
- Full-text search (SQLite FTS5)
- React/Vite/Tailwind frontend: log list, compose, read view, right rail
- Entity browser with type filter + entity detail (rename, notes, merge, archive)
- Tags: LLM extracts 1–4 labels per note, filterable everywhere
- Todos: `[ ]`/`[x]` extraction → Task rows + live checkboxes in note view
- Todos page: grouped by source note, section headers, indentation, tag+entity filter, open/done tabs
- Note editing: smart textarea (Tab indent/dedent, bullet/todo auto-continue, `[[` autocomplete)
- Bullet rendering in read view
- Three-tier annotation model: suggested (LLM) → `{Name}` (persistent soft marker) → `[[Name]]` (confirmed)
- Inline entity marks with `▾` action menu: confirm, reject, relink to different entity
- Suggested vs. confirmed visual distinction (dashed/solid underline, hollow/filled dot)
- Entity management: create, rename, notes, merge, archive, type correction
- `updated_at` on Log; no-op edit short-circuits reparse
- **Mobile-responsive layout**: stacked panels, bottom tab nav, SVG chevron back buttons
- **Mobile polish pass**: card treatment, tap targets, entity breadcrumb, log context strip with entity snippet + tap-to-navigate, tag tap → navigate to filtered log list, task overflow fix (`min-w-0`), Nodes rename
- **Flat checklist view**: entity/tag filter → auto-switches to flat list; "Flat list / By log" toggle when filter active; section headers preserved as dividers; sidebar tags/entities scoped to current status tab; suggested + confirmed entities both included in filter matching
- **Todo polish**: grouped view sorted reverse-chronological with relative date; section headers link to source log; mobile filter sheet (tags + entities); `<AnnotatedText>` component with entity type cache renders colored entity names in all snippet surfaces (log list, todo headers, right rail, entity excerpts); UTC timezone fix for relative dates

---

## ⬅ START HERE NEXT SESSION: Deployment (Fly.io)

App is ready to dogfood. The core loop works: write logs → tap an entity/tag → see all open todos flat → check them off. Use it for a week and note friction before building more.

### Remaining Todos items

#### 1. Quick-add todo on mobile (closes the loop)
**What:** When a filter is active (e.g. Costco), a quick-add input at the top lets you type a new todo and hit Enter. It creates a minimal new log (e.g. "Costco" as the title + `[ ] your item`) and runs it through the parser so the entity gets linked automatically.
**Why:** Right now adding a todo requires: navigate to logs → compose → write a note → save. That's too many taps standing in a store. The quick-add should be ≤2 taps.
**How:**
- `POST /logs` with a minimal raw_text like `[ ] buy coffee filters` (entity context from the active filter)
- The parser will extract the todo and link the entity
- New task appears immediately in the filtered view
- Backend already handles this — it's purely a frontend addition

#### 2. Tasks → log navigation with scroll-to-task (secondary)
**What:** Tapping a task group's log source header should open that log AND scroll to the task, not just the top.
**How:** Pass a `focusTaskId` prop to CenterPane, scroll to that element after render. Add chevron back button to return to Tasks.

#### 3. (Minor) Done tab
Done groups are hard to parse — consider greying the whole card more aggressively or collapsing by default.

---

## Code Cleanup (pre-production)

### Backend — real bugs
- [x] **Annotation type list in task UNION query** — fixed; now built dynamically from `_TYPE_MAP` + `VALID_ENTITY_TYPES`
- [x] **`_row_to_annotation` fragile positional guard** — removed `len(row) > 10` check; SELECT always returns 11 columns

### Backend — dead code / naming
- [x] **`v2` suffix cleanup** — new canonical files: `db.py`, `promote.py`, `parser.py`, `schema.py`, `retrieval.py`; `_v2.py` files are now one-line compatibility stubs
- [x] **Dead functions in `db_v2.py`** — removed `get_tasks`, `delete_task`, `get_logs`, `get_annotations_for_log`
- [x] **`task_type` column** — removed vestigial `task_type` from `promote.py` insert; schema comment cleaned up
- [x] **`_UI_TYPES` duplicate** — removed; call sites use `set(VALID_ENTITY_TYPES)` directly
- [x] **Scattered `import json` / `import re`** — moved to module-level in `server.py`
- [x] **`parse_log` naming** — renamed to `create_and_parse_log` in `parser.py`; `parser_v2.py` stub re-exports it as `parse_log` for compat

### Frontend (pending audit of CenterPane / LeftRail / RightRail)
- [ ] Full frontend pass TBD

---

## Deployment (after Todos)

- [ ] **Fly.io deploy** — FastAPI + built frontend in one container, SQLite on persistent volume, `yourapp.fly.dev` URL
  - `fly launch` → set up `fly.toml`, Dockerfile
  - Mount persistent volume at `/data` for SQLite
  - `npm run build` output served as static files by FastAPI (`StaticFiles`)
  - Set `ANTHROPIC_API_KEY` as a Fly secret
- [ ] **Basic auth** — single shared password via FastAPI middleware; no per-user accounts yet
- [ ] **Timeline / journal view** — group log list by today / yesterday / this week / last week (pure frontend, data already there)

---

## Bigger / Needs Design

- [ ] **Slide-out nav drawer** — log list as a persistent drawer (Notion/Logseq style); tapping Logs tab when already on Logs opens it; replaces current mobile "list → detail" stacking
- [ ] **Entity split** — when one name maps to two real people/places, split mentions into separate entities; defer until it's a real pain point

---

## Backlog

### Editor / Note View
- [ ] WYSIWYG editor (Lexical) — checkboxes clickable while editing, entity highlights as you type
- [ ] Visually connect todos to their section title

### Entities
- [ ] Alias table — `EntityAlias(entity_id, alias_name)`; rename creates alias; old notes stay linked
- [ ] Reconcile — re-run entity matching (no LLM) after rename/merge/alias
- [ ] Date extraction — detect "last Tuesday", "March 15th" as time references

### Infrastructure / Later
- [ ] Natural language query ("what did we think about Kirk Creek?")
- [ ] Semantic search (LogEmbedding table exists, not wired to UI)
- [ ] Voice input — Whisper → same parse path as text
- [ ] Multi-user / spaces — shared entity graph with private + shared note spaces
- [ ] Supabase / Postgres migration (when SQLite stops being enough)
