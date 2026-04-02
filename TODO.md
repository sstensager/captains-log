# Captain's Log — TODO

*Last updated: 2026-04-01*

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

---

## Next Session: Make Todos Awesome

The Todos page works but isn't yet a reason to open the app. Two things would make it genuinely useful:

### 1. Entity-filtered task view (killer feature)
**What:** "Show me all open todos mentioning Costco" — cross-log task view filtered by entity.
**Why:** The current log-grouped layout buries the real value. Entity filter should be front-and-center, not an afterthought in the sidebar.
**How:** The sidebar already has entity chips (from `allEntities`). Selecting one should be the primary UX, not just a filter refinement. Consider making entity/tag filter the hero of the page rather than open/done tabs.

### 2. Tasks → log navigation with scroll-to-task
**What:** Tapping a task group's log source header should open that log AND scroll to / highlight the task section, not just open the top of the log.
**Why:** Right now tapping the log title just dumps you at the top. On a long note this is disorienting.
**How:** The log view (`CenterPane`) renders tasks as checkboxes inline. Need to: (a) pass a `focusTaskId` or `focusSection` prop to CenterPane, (b) scroll to that element after render, (c) add back navigation to return to Tasks. Back nav should be a chevron (same SVG as rest of app) in the CenterPane topbar that only appears when navigated from Tasks.

### 3. (Smaller) Done tab UX
**What:** "Done" tab shows fully-completed task groups. Currently a bit hard to parse since done items look the same as open ones.
**Consider:** Greying out the whole card more aggressively, or collapsing done groups by default.

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
