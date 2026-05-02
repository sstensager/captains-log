# Captain's Log — TODO

*Last updated: 2026-05-01*

---

## Direction

**Core use case:** passive entity memory — write naturally, pull up everything about a person or place later.
- "What did we think about the campsites at Kirk Creek?"
- "What are Beth's kids' names?"
- "What did we order last time at Osteria Mozza?"

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

### P0 — Editor bugs

#### 1. Todo insertion cursor jump
**Steps to reproduce:**
1. Type a line of text
2. Add 2–3 empty lines below it
3. Type another line of text further down
4. Go back to the first line
5. Use the ☐ toolbar button (or keyboard) to insert a todo on the line below it
**Result:** Cursor jumps to the next line that has text and inserts the todo prefix before it instead of on the blank line below the first line.

#### 2. Entity action menu won't close when tapping another entity
**Steps to reproduce:**
1. On desktop, click a confirmed entity `[[Name]]` — action menu opens
2. Try clicking elsewhere or another entity
**Result:** Menu stays open; clicking another entity doesn't close the first menu and may not open the second
**Note:** The X button close bug is fixed; this is a separate issue in `EntityMark`'s outside-click handler

---

### P1 — Suggested entity UX

#### 3. Removing `{suggested entity}` leaves `{}` in text
**What:** When you hit "Remove reference" on a `{Name}` entity mark, the annotation is rejected but the `{Name}` braces stay in the raw text as literal `{Name}`.
**Why skipped:** Stripping the `{}` requires saving new text, which triggers a full reparse, which re-annotates the entity and puts `{}` back. Needs a "permanently suppress this suggestion in this log" mechanism server-side.

#### 4. Ghost duplicate after confirming a suggested entity
**What:** After promoting a suggested `{Name}` → confirmed `[[Name]]`, both versions sometimes still appear simultaneously in Nodes and in the log view.
**Suspected cause:** The old suggested annotation record isn't fully cleaned up during promotion.

#### 5. Suggested entities should behave like confirmed in relink dropdown
**What:** When using "Different entity…" in the action menu, the search only surfaces confirmed entities. Suggested (tentative) entities should also appear.

---

### P2 — Mobile polish

#### 6. Wrap selected word in `[[brackets]]` on mobile
**What:** On desktop, selecting text and pressing `[` wraps it as `[[selection]]`. On mobile there's no equivalent — the `[[]]` toolbar button just inserts at cursor. Need a way to wrap a selected word.
**Possible approach:** If the toolbar `[[]]` button is tapped with a selection active, wrap the selection instead of inserting at cursor.

#### 7. Vertical scrolling to reach tabs / edit buttons on mobile
**What:** On longer notes, tabs and the Edit button require a lot of scrolling to reach.

#### 8. Auto-scroll when entering a new bullet below the fold
**What:** Typing a new bullet point below the visible area doesn't always scroll the textarea to keep the cursor in view on mobile.

---

### P3 — Features

#### 9. Smart paste for bullets / lists
**What:** Pasting multi-line text from another app (e.g. a shopping list) doesn't preserve bullet or indentation formatting.

#### 10. Navigate from context pane → entity node page
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
