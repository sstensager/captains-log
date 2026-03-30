# Captain's Log — TODO

*Last updated: 2026-03-28*

---

## Direction

**Core use case:** passive entity memory — write naturally, pull up everything about a person or place later.
- "What did we think about the campsites at Kirk Creek?"
- "What are Beth's kids' names?"
- "What did we order last time at Osteria Mozza?"

---

## Recently Shipped

- Single-pass LLM parser (person + place, false-positive heuristics)
- Annotation → Entity → EntityReference promotion pipeline with fuzzy dedup
- Full-text search (SQLite FTS5)
- React/Vite/Tailwind frontend: log list, compose, read view, right rail
- Entity browser ("People & Places") with type filter + entity detail
- Tags: LLM extracts 1–4 labels per note, filterable everywhere
- Todos: `[ ]`/`[x]` regex extraction → Task rows + live checkboxes in note view
- Todos page: grouped by source note, section headers, indentation, tag+entity filter, open/done tabs, snapshot pattern (no jumping on complete)
- Note editing with smart textarea (Tab indent/dedent, auto-continue bullets/todos on Enter)
- Bullet rendering in read view (`- item` → `• item` with indent levels)

---

## Active — Phase 1: Entity Management (Basic)

No new schema required. Low-hanging fruit that makes the system actually correctable.

- [x] `PATCH /api/entities/{id}` — rename + user_notes edit
- [x] Annotation rejection cascade — reject chip → delete EntityReference → flag orphan entity
- [x] EntityDetailView inline rename (click name → edit in place)
- [x] EntityDetailView user_notes inline edit
- [x] × button on entity chips in note view to dismiss false positives

---

## Active — Entity Management Backlog

### Phase 2: Triage (no new schema)
Quick wins that make the entity list trustworthy before adding infrastructure.

- [ ] **Entity type correction** — dropdown on entity card to flip person↔place; re-runs promote with corrected type
- [ ] **Delete / archive entity** — remove orphaned or wrong entities; soft-delete preferred (status='archived')
- [ ] **Entity merge UI** — pick two entities, one absorbs the other; EntityReferences repointed, loser archived
- [ ] **Manually create entity** — add a person/place not yet mentioned in any note

### Phase 3: Alias Table
Makes rename non-destructive — old notes stay linked after a rename.

- [ ] `EntityAlias (entity_id, alias_name)` table + migration
- [ ] Rename automatically creates an alias of the old name
- [ ] Dedup/matching checks aliases — old notes still link after rename
- [ ] Show aliases on entity card; allow add/remove

### Phase 4: `[[]]` Syntax
User-explicit linking — bypasses the LLM entirely for known entities.

- [ ] `extract_links()` regex: `[[Name]]` in raw_text → `provenance='user'` annotation, confidence 1.0
- [ ] Renderer: `[[Name]]` displays as clickable entity chip inline
- [ ] User annotations protected from reparse wipes (only delete `provenance='llm:*'` on edit)
- [ ] Wire into dedup so `[[Beth Walker]]` finds existing "Beth" entity

### Phase 5: Selection UI
Point-and-click entity creation without typing `[[]]`.

- [ ] Select text in read view → popover: "Mark as Person / Place"
- [ ] Creates user annotation at correct span + entity + ref

### Phase 6: Reconciliation
Keeps the graph consistent as it evolves.

- [ ] `reconcile(log_id)` — re-runs entity matching (no LLM) when entity graph changes
- [ ] Run after: note edit, entity rename, alias add, entity merge
- [ ] Keeps old notes consistent with renamed/merged entities

---

## Backlog

### Log Browsing
- [ ] **Date grouping in log list** — group entries by day with a date header (already roughly sorted, just needs visual separation)
- [ ] **Jump to date** — calendar picker or "jump to week" for navigating older entries

### Editor / Note View
- [ ] **Visually connect todos to their section title** — "Costco shopping list:" above `[ ] eggs`
      is the section header but there's no visual affordance connecting them in the note view.
      Could be subtle styling on any non-todo line that is immediately followed by todos.
- [ ] WYSIWYG editor (Lexical) — needed before this is truly usable as a daily driver.
      Checkboxes clickable while editing, entity highlights as you type.

### Todos
- [ ] Delete / archive individual todos
- [ ] Global todo full-text search
- [ ] "Named list" concept — group todos under a user-defined list name

### Infrastructure / Later
- [ ] Voice input — Whisper → same parse path as text
- [ ] Mobile layout
- [ ] Natural language query ("what did we think about Kirk Creek?")
- [ ] Semantic search (LogEmbedding table exists, embedding search not wired to UI)
- [ ] Supabase / Postgres migration
- [ ] Auth + sync
