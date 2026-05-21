# Captain's Log — TODO

*Last updated: 2026-05-20 (session 2)*

---

## Direction

**Core use case:** passive entity memory — write naturally, pull up everything about a person or place later.
- "What did we think about the campsites at Kirk Creek?"
- "What are Beth's kids' names?"
- "What did we order last time at Osteria Mozza?"

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

### P2 — Mobile polish

#### 6. General textarea scroll while typing
**What:** Beyond the new-line case, the textarea doesn't always keep the cursor in view while typing normally on mobile. The auto-grow + wrapper-div refactor likely fixed this — confirm on device and close out.

#### 9. Todo row tap target — entire row should check/uncheck
**What:** In the Todos page, you have to tap the small checkbox to toggle a todo. The whole row should be tappable. Small checkbox is too fiddly on mobile.
**Where:** `TasksPage/index.tsx` — the row rendering.

#### 10. Edit note from Todos page
**What:** No way to jump into editing the source note from the Todos page. Should be easy to navigate from a todo item to the note it lives in and enter edit mode.

#### 11. Entity picker shows all entities on open (scrollable, no typing required)
**What:** Tapping `[[]]` or typing `[[` shows "Type to search…" with an empty list. On mobile especially, you want to scroll existing entities without having to type. Fix: when query is empty, show all entities sorted by usage (same 20-item cap, scrollable).
**Where:** `filtered` memo in `SmartTextarea` — currently returns `[]` when `linkQuery.trim()` is empty.

---

### P3 — Features

#### 12. Parser should check existing confirmed entities before annotating
**What:** If "app" is already a confirmed entity node, the LLM annotation pass often misses it in new notes. The parser should be given the list of confirmed entity names as context so it can find them even when it wouldn't spontaneously tag them.
**Where:** `parser_v2.py` — pass confirmed entity list into the LLM prompt.

#### 7. Smart paste for bullets / lists
**What:** Pasting multi-line text from another app (e.g. a shopping list) doesn't preserve bullet or indentation formatting.

#### 8. Navigate from context pane → entity node page
**What:** No direct link from an entity in the context pane to its full node page. Currently requires closing context, opening Nodes, searching.
**Open design question:** Consider killing the context pane entirely and having entity taps navigate directly to the node page (log breadcrumb provides the back path).

---

## Backlog

### Editor / Note View
- [ ] WYSIWYG editor (Lexical) — checkboxes clickable while editing, entity highlights as you type
- [ ] Visually connect todos to their section title
- [ ] Quick-add todo on mobile: when a filter is active, ≤2 taps to add a new todo to a filtered entity/tag

### Entities
- [ ] Alias table — `EntityAlias(entity_id, alias_name)`; rename creates alias; old notes stay linked
- [ ] Date extraction — detect "last Tuesday", "March 15th" as time references
- [ ] Natural language query ("what did we think about Kirk Creek?")
- [ ] Semantic search (LogEmbedding table exists, not wired to UI)

### Infrastructure / Later
- [ ] Voice input — Whisper → same parse path as text
- [ ] Timeline / journal view — group log list by today / yesterday / this week / last week
- [ ] Slide-out nav drawer (Notion/Logseq style)
- [ ] Multi-user / spaces
- [ ] Supabase / Postgres migration
