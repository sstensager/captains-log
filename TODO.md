# Captain's Log — TODO

*Last updated: 2026-05-25 (session 7)*

---

## Direction

**Core use case:** passive entity memory — write naturally, pull up everything about a person or place later.
- "What did we think about the campsites at Kirk Creek?"
- "What are Beth's kids' names?"
- "What did we order last time at Osteria Mozza?"

---

## ⬅ START HERE NEXT SESSION

**NLQ is at 26/27. Remaining known weakness (not a hard failure):**

- **Generic category queries** — "Which campsites have we been to?" surfaces Table Mountain but not Windwolves/Lake Arrowhead. Root cause: parser returns `entity_names=[]` for open-ended category questions because it doesn't know what's in the DB. Medium-term fix: pass top N entity names as context to `parse_query`.

**Next features:**
- Entity attribute enrichment (schemaless metadata) — design already in TODO.md
- WYSIWYG editor (Lexical)
- Voice input (Whisper)

---

## Recently Shipped (session 2026-05-25, session 7)

- **NLQ bug fixes — 23/27 → 26/27:**
  - Skip date hard-filter when `date_range.start > today` — fixes planning queries for future events (Juneteenth, 4th of July)
  - Strip FTS stop words before building FTS query — fixes "Where should we go for Mexican food?" (was matching "go" as required keyword)
  - Tag primary fallback (Pass 5) in `retrieve_for_query` — when entity+FTS passes return nothing, fall back to direct tag scan; fixes "What restaurants do we like?" and "Last time we went camping"
  - Prompt update: instruct parser to keep event/holiday names in `keywords` even when they appear in `date_range` — enables FTS to find Juneteenth/July logs

---

## Recently Shipped (session 2026-05-25, session 6)

- **NLQ (Natural Language Query)** — full parse→retrieve→synthesize pipeline. `nlq.py`: `QueryPlan`, `parse_query` (gpt-4o-mini structured output), `retrieve_for_query` (entity index → FTS → date hard-filter → tag soft-boost), `synthesize_answer` (grounded 2-3 sentence answer). `GET /api/query` endpoint in `server.py`. LeftRail UI: search box doubles as ask input, ↵ fires NLQ, ✦ button, ✕ clears, collapsible indigo answer panel + source log list.
- **Fix entity highlights in todo lines** — `renderBody` was rendering todo text as plain string; now calls `renderLineHighlights` with correct char offset (same as bullet lines already did).
- **NLQ test infrastructure** (gitignored, local-only, never ships):
  - `seed_dev_data.py` — 30 personal logs (Layla, Nora, Hunter, Sonya, Bob, Windwolves, Table Mountain, Dario's, etc.)
  - `seed_food_logs.py` — 14 restaurant/dish logs across cuisines
  - `seed_campsite_ratings.py` — 6 survey logs covering 215 campsite ratings across 4 campgrounds (zone-biased grades)
  - `test_nlq.py` — 27-query battery across 9 categories
  - `run_test_loop.py` — fully autonomous loop: reset → seed → poll parser → run queries → write `test_results/YYYY-MM-DD_HH-MM-SS.txt`
  - `TESTING.md` — full documentation of test suite, safety guarantees, how to interpret results
- **Baseline established:** 23/27 pass. All entity/fact/relationship queries excellent. 3 failures = date filter bug. 1 failure = FTS stop word bug.

---

## Recently Shipped (session 2026-05-22, session 5)

- **User tags** — separate `user_tags` column (parser never overwrites); TagEditor in both read and edit view; LLM tags (gray, clickable) + user tags (indigo, removable ×); `+ tag` dropdown autocomplete from ~40-tag vocabulary; LeftRail filter checks both columns
- **Expanded tag vocabulary** — parser prompt expanded from 12 → ~40 labels grouped by category (restaurants, camping, fitness, renovation, movies, etc.) with free-form escape hatch
- **Date extraction** — parser now emits `date_ref` annotations (type=date_ref, text_span="last Tuesday", value="2026-05-19"); resolution always anchored to `created_at`, not reparse date; invisible to existing chip/highlight UI — stored for NLQ use
- **Tasks filter persistence** — filter state (entity/tag/search + open/done) preserved when navigating Tasks → log → back
- **Entity context on log navigate** — navigating entity → log → back now re-selects the correct entity

---

## Recently Shipped (session 2026-05-22, session 4)

- **Entity rename rewrites raw text** — renaming an entity updates all affected log raw text (`\bOldName\b` → `NewName`, word-boundary regex), annotation values, annotation char spans, and FTS index in one transaction. Conflict check returns 409 if new name already exists. Frontend shows a confirmation banner ("Rename X → Y? This will rewrite N notes. Cannot be undone.") before firing for entities with any mentions; zero-mention entities rename silently.
- **Fix promote: accepted suggestion stays dashed** — stale LLM annotations shared `span_start` with new user annotation after promotion, occasionally rendering first (dashed) and blocking the user annotation. Fix: promote endpoint now clears all `provenance != 'user'` annotations (not just `provenance = 'text'`) before re-running `extract_links`.

---

## Recently Shipped (session 2026-05-21, session 3)

- **#13 Back navigation** — Back arrow always returns to the originating page with state restored: Nodes preserves the selected entity, Todos preserves the active filter (entity/tag/status)
- **#7 Smart paste** — pasting from other apps normalizes bullets (`•`, `1.`, `2)` → `- `) and tab indentation (→ 2-space); plain text falls through unchanged
- **Back arrow in edit mode** — when a note opens in edit mode from Todos, the back arrow is now visible and returns to Todos

---

## Recently Shipped (session 2026-05-21, session 2)

- **Todo row tap target** — entire row now toggles done/open, not just the checkbox
- **Entity picker shows all on open** — empty `[[` now shows all entities sorted by ref_count instead of blank list
- **Todos sidebar: Nodes above Tags** — sorted by todo count with count badge per node
- **Edit note from Todos** — tapping the section header in grouped view opens the source note directly in edit mode
- **Section header chevron** — clear tap affordance in both flat and grouped views
- **Global cursor: pointer** — all buttons now show hand cursor on desktop hover
- **#6 confirmed closed** — textarea scroll while typing resolved by prior refactor
- **#8 confirmed closed** — context pane → entity node page done in prior session
- **#12 confirmed closed** — known entity injection into parser done in prior session

---

## Recently Shipped (session 2026-05-20)

- **Todo insertion cursor jump fixed** — inserting a todo on a blank line below existing text no longer jumps to the next text line
- **Entity action menu closes correctly** — clicking another `[[entity]]` or elsewhere on desktop now closes the open action menu
- **`{suggested entity}` braces clear immediately on reject** — frontend now re-fetches log text after rejection instead of waiting for a manual refresh
- **`[[]]` toolbar button wraps selection on mobile** — tapping with a word selected wraps it as `[[word]]` instead of deleting it and opening the entity picker
- **Entity picker is now searchable** — empty `[[` shows "Type to search…" instead of 8 random entities; results capped at 20 in a scrollable list
- **Ghost duplicate after confirming suggested entity** — confirmed; can't reproduce, fixed by prior session
- **Suggested entities appear in relink dropdown** — confirmed working
- **Edit button sticky on mobile** — `min-h-0` + `shrink-0` on TopBar fix scroll containment so Edit button stays fixed at top
- **Bottom nav hidden while editing/composing** — nav tabs no longer visible (or eating space) while keyboard is up in edit mode
- **"Detected" chip bar hidden on mobile** — desktop-only now; preserves editing space on phone
- **Auto-scroll cursor when adding new line** — `useLayoutEffect` scrolls textarea to keep cursor in view after bullet/todo continuation

---

## Recently Shipped (session 2026-05-01)

- **"Copy all logs" on entity detail** — button in "Appears in" section copies all full log texts formatted as `--- date ---\ncontent` blocks; `raw_text` now included in `MentionOut`
- **Relative time for today's logs** — `relativeDate` now returns "2h ago" / "30m ago" / "Just now" instead of "Today"
- **Sticky save bar in EditView** — added `shrink-0` so save button doesn't get squeezed off screen when keyboard is up on mobile
- **Context pane X button fixed** — `onBack ?? onClose` always resolved to `onBack`; X now always calls `onClose` (which also resets mobile view state)
- **Entity type dedup fix** — `find_entity` was filtering `WHERE entity_type = ?`, causing "Ralphs" (Place) and "Ralphs" (Organization) to create two separate entities. Now searches all types; existing entity wins regardless of type mismatch
- **Entity type cascade** — changing entity type on the Nodes page now cascades to all linked `Annotation` rows so log view highlight colors stay in sync
- **Suggested `{Name}` entities now appear on Nodes page** — `extract_links` was creating Annotation records for soft links but no Entity or EntityReference; now creates both, so all `{Name}` entities are visible in the browser
- **Fly.io deploy pipeline documented** — `flyctl deploy` from project root; documented in CLAUDE.md and memory

---

## ⬅ START HERE NEXT SESSION

**Natural Language Query (NLQ)** — designed and ready to build. See design notes below.

**Entity attribute enrichment (schemaless metadata)** — designed and ready to build. See design notes below.

---

## Design Notes (carry into next session)

### Natural Language Query (NLQ)

**Architecture:** Parse → Retrieve → Synthesize. Two gpt-4o-mini calls per query, ~$0.0001.

**Stage 1 — `nlq.py` (new file):**
- `QueryPlan` Pydantic model: `entity_names: list[str]`, `date_range: {start, end} | None`, `keywords: list[str]`, `tags: list[str]`, `intent: str`
- `parse_query(question, today) → QueryPlan` — structured LLM output
- `synthesize_answer(question, logs) → str | None` — 2–3 sentence answer, `max_tokens=150`
- Rule: `"last time"` → `date_range=null` (sort handles it); `"last month"` → ISO interval

**Stage 2 — `retrieval.py` addition:**
- `retrieve_for_query(con, plan, limit=10) → list[dict]`
- Entity pass (score +3.0 + confidence) → FTS pass (score +normalized) → date hard-filter (Log.created_at OR date_ref annotation value in range) → tag hard-filter → sort DESC

**Stage 3 — `server.py`:**
- `GET /api/query?q=...&synthesize=true` → `QueryResponse { answer, logs, filters }`
- `QueryResponse` type in `types.ts`; `naturalLanguageQuery()` in `api.ts`

**UI — LeftRail:**
- "Ask" button (sparkle/✦ icon) appears when query looks like a question (contains `?` or starts with what/who/where/when/which)
- NLQ is explicit-submit (Enter), not debounced live search
- Results replace log list: synthesized answer panel at top (collapsible) + source logs below
- "Clear" restores normal mode

**Key design decisions already made:**
- Tags/synthesis handles the "Dario's is a restaurant" gap — entity type is `place`, retrieval uses `tags: ["restaurants"]`, synthesis reads context and filters to restaurant visits
- date_ref annotations (already shipping) power the date filter for notes like "went there last month" written today

---

### Entity Attribute Enrichment (schemaless metadata)

**The problem it solves:** The system knows Dario's is a `place` but not that it's a restaurant. NLQ uses tag+synthesis as a workaround, but the real fix is entity-level metadata: `venue_type: restaurant`, `cuisine: Italian`, `price: $$`. These attributes enable `WHERE entity.attributes INCLUDE venue_type=restaurant` in NLQ.

**Infrastructure already exists:** `Attribute` table has `entity_id, key, value, attr_type, provenance, source_log_id`. Entity detail page already shows attributes. The missing piece is the write path.

**Design:**
- **Async enrichment job** (preferred over parser-time): when entity page opens (or on a background cron), read all `EntityReference.excerpt` rows for that entity and run one gpt-4o-mini call:
  > "Based on these log excerpts, what key facts do you know about [Dario's]? Return as key:value pairs. Examples: venue_type, cuisine, price_range, neighborhood, hours, vibe."
- Store results as `Attribute` rows with `provenance='auto:enrichment'`, `confidence` score
- User can view, edit, or add attributes on the entity detail page (UI already shows attributes)
- NLQ can then filter by `WHERE EXISTS (SELECT 1 FROM Attribute WHERE entity_id=e.id AND key='venue_type' AND value='restaurant')`

**UI additions needed:**
- Entity detail: inline key/value editor for adding/editing attributes (user provenance)
- "Enrich" button on entity detail to trigger the enrichment job on demand
- NLQ filter: `type:restaurant` or `venue_type:restaurant` syntax in the query parser

**Files to touch:** `server.py` (enrichment endpoint), `db.py` (no schema change needed), frontend `EntitiesPage` (attribute edit UI)

---

## Backlog

### Editor / Note View
- [ ] WYSIWYG editor (Lexical) — checkboxes clickable while editing, entity highlights as you type
- [ ] Visually connect todos to their section title
- [ ] Quick-add todo on mobile: when a filter is active, ≤2 taps to add a new todo to a filtered entity/tag

### Entities
- [ ] Natural language query — see design notes above (next session priority)
- [ ] Entity attribute enrichment — schemaless metadata per entity; see design notes above
- [ ] Semantic search (LogEmbedding table exists, not wired to UI)
- [ ] Timeline / journal view — group log list by today / yesterday / this week (UI approach TBD)

### Infrastructure / Later
- [ ] Voice input — Whisper → same parse path as text
- [ ] Timeline / journal view — group log list by today / yesterday / this week / last week
- [ ] Slide-out nav drawer (Notion/Logseq style)
- [ ] Multi-user / spaces
- [ ] Supabase / Postgres migration
