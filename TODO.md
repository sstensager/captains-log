# Captain's Log — TODO

*Last updated: 2026-05-22 (session 4)*

---

## Direction

**Core use case:** passive entity memory — write naturally, pull up everything about a person or place later.
- "What did we think about the campsites at Kirk Creek?"
- "What are Beth's kids' names?"
- "What did we order last time at Osteria Mozza?"

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

No active items — see backlog below.

---

## Backlog

### Editor / Note View
- [ ] WYSIWYG editor (Lexical) — checkboxes clickable while editing, entity highlights as you type
- [ ] Visually connect todos to their section title
- [ ] Quick-add todo on mobile: when a filter is active, ≤2 taps to add a new todo to a filtered entity/tag

### Entities
- [ ] Date extraction — detect "last Tuesday", "March 15th" as time references
- [ ] Natural language query ("what did we think about Kirk Creek?")
- [ ] Semantic search (LogEmbedding table exists, not wired to UI)

### Infrastructure / Later
- [ ] Voice input — Whisper → same parse path as text
- [ ] Timeline / journal view — group log list by today / yesterday / this week / last week
- [ ] Slide-out nav drawer (Notion/Logseq style)
- [ ] Multi-user / spaces
- [ ] Supabase / Postgres migration
