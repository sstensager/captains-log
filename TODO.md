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
- **Mobile-responsive layout**: stacked panels, bottom tab nav, back navigation

---

## Mobile Polish (from first dogfood pass)

Quick wins:
- [ ] **New entity cancel button** — "+ New" form on Entities page has no mobile-accessible cancel; add Cancel button or make the button toggle the form closed
- [ ] **Task row overflow** — checkbox rows with indentation overflow screen on mobile; reduce base indent and clamp max
- [ ] **Merge dropdown tap targets** — entity merge list items need ≥44px touch targets on mobile

Medium:
- [ ] **Log list visual distinction** — items blur together on mobile; add card treatment (border/shadow/divider) so each entry reads as tappable
- [ ] **Context panel log header** — when viewing context/entity panels, show a sticky header with the log date + preview so user knows which log they're in
- [ ] **Entity detail breadcrumb** — "‹ Context" back button exists but no forward breadcrumb header ("Context › Robert Smith"); add consistent heading
- [ ] **Tag tap feedback on mobile** — tapping a tag in log view silently filters the hidden log list; either navigate back with filter applied or show a visible confirmation
- [ ] **Rename "People & Places"** — now inaccurate with 7 entity types; candidates: "Entities", "People & Things"; needs a decision

Bigger / needs design:
- [ ] **Slide-out nav drawer** — "‹ Back to logs" feels wrong; log list should be a persistent drawer (Notion/Logseq style) that slides over the current view; tapping the Logs tab when already in logs should open the drawer
- [ ] **Tasks page rethink** — entity-filtered task view ("all todos mentioning Costco") is the killer feature; current log-grouped layout buries this; entity filter should be front-and-center
- [ ] **Tasks → log navigation** — tapping a task group's log source should scroll to that task in the log, not just open the top of the log; needs back navigation to return to Tasks

---

## Dogfooding / Deployment

- [ ] **Fly.io deploy** — FastAPI + built frontend in one container, SQLite on persistent volume, `yourapp.fly.dev` URL
- [ ] **Basic auth** — single shared password via FastAPI middleware; no per-user accounts yet
- [ ] **Timeline / journal view** — group log list by today / yesterday / this week / last week (data is already there, pure frontend)
- [ ] **Entity split** — when one entity name maps to two different real people/places, split mentions into separate entities; deferred until it becomes a real pain point in use

---

## Backlog

### Editor / Note View
- [ ] WYSIWYG editor (Lexical) — checkboxes clickable while editing, entity highlights as you type
- [ ] Visually connect todos to their section title — subtle styling on lines immediately followed by todos

### Entities
- [ ] Alias table — `EntityAlias(entity_id, alias_name)`; rename creates alias; old notes stay linked
- [ ] Reconcile — re-run entity matching (no LLM) after rename/merge/alias to keep old notes consistent
- [ ] Date extraction — detect "last Tuesday", "March 15th" as time references linked to logs

### Infrastructure / Later
- [ ] Natural language query ("what did we think about Kirk Creek?")
- [ ] Semantic search (LogEmbedding table exists, not wired to UI)
- [ ] Voice input — Whisper → same parse path as text
- [ ] Multi-user / spaces — shared entity graph with private + shared note spaces (Notion-style workspaces)
- [ ] Supabase / Postgres migration (when SQLite stops being enough)
