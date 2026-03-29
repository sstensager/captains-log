# Captain's Log

*You tell it what's on your mind. It remembers — and organizes — so you don't have to.*

---

## What It Is

Captain's Log is a personal knowledge system you talk to.

Your brain generates a constant stream of information worth keeping: restaurant recommendations, details about people, campsite ratings, tasks, ideas, opinions, plans. The problem isn't capturing it. The problem is that every tool for capturing it requires you to also organize it — and nobody does that consistently.

Captain's Log removes that step. You log in natural language, typed or spoken, polished or rambling, and the system figures out the rest. It detects structure without demanding it, builds a queryable index behind the scenes, and surfaces what you need later. You never see a schema. You never name a field. You just write.

The retrieval side is the payoff: *What restaurants did we like in Ojai? What are Jennifer's kids' names? What haven't we made for dinner in a while? What open ideas do I have about the app? Which campsites were good with a toddler?* The system knows because you told it, once, in passing, months ago.

---

## The Problem It Solves

Every existing solution to personal knowledge management puts the organizational burden on the user.

Notion requires you to design your schema upfront. Logseq requires you to maintain your graph. Apple Notes is a flat pile. Voice memos are unretrievable. Even AI assistants with memory features require you to manage what gets remembered and how.

The result: people either don't capture information at all, or they capture it into a system they eventually abandon because maintenance is the whole problem.

Captain's Log is built on the premise that the AI should be the librarian, not the user. Structure should emerge from use, not be imposed at write time.

---

## How It Works

### Design philosophy

**Write loosely. Index lightly. Structure progressively.**

Raw logs are always the source of truth and are never modified. Structure is a reversible layer on top. The parser annotates notes — it does not replace them. Nothing must be structured at entry time.

### Data model

Five tables:

```
Log             — every raw entry, timestamped and immutable
Annotation      — soft parser output tied to a log (suggestions, not commitments)
Entity          — a promoted, stable object (person, place, task, etc.)
EntityReference — a link from an entity back to every log that mentioned it, with a clipped excerpt
Attribute       — a promoted fact about an entity, traced back to the log it came from
```

`EntityReference` is the key structural primitive: every entity knows exactly which logs mentioned it and what they said. Entity pages are generated from these excerpts — no separate maintained profile required.

### Capture and parse

Notes are saved **immediately and unconditionally**. A failed or slow parse never loses a log.

Within a second or two of saving, a single LLM call runs in the background and produces soft annotations: candidate entities, tasks, dates, ratings, topics, relationship hints. Each annotation has a confidence score and a status (`suggested / accepted / rejected / corrected`).

Annotations appear in the UI as inline chips. The user can confirm, edit, link to an existing entity, or dismiss — but never has to. Mistakes can be corrected when noticed. There is no required audit step.

Users who want explicit linking can also invoke it while typing (`[[entity name]]` syntax), which creates an accepted annotation directly — same data model, higher trust signal.

### Entity pages

Tapping an entity shows every log that mentioned it, with the relevant excerpt from each note, in reverse chronological order. The page is generated from `EntityReference` rows — no maintained profile, no filled-out fields.

### Retrieval

Three composable layers:
1. **Full-text search** on raw log text
2. **Semantic embedding search** — catches meaning, not just keywords
3. **Entity / annotation index** — filter by entity, annotation type, date range, status

---

## Experiment Log

This section documents what we've tried, what we learned, and why the direction changed. Building in public means being honest about what didn't work.

---

### Experiment 1 — Graph Ingestion Pipeline *(v1, Jan–Mar 2026)*

**Hypothesis:** An LLM can reliably infer a structured knowledge graph from messy natural language at ingest time, and a committed graph is the best representation for later retrieval.

**What we built:** A 6-phase pipeline (primer → name extraction → entity extraction → attribute extraction → relationship extraction → QA reviewer). An EAV graph model: Log / Entity / Attribute / Relationship. A canonical schema (`CANONICAL_SCHEMA`) with enforced entity types, preferred attribute keys, and directional relationship labels with type constraints (`LABEL_CONSTRAINTS`). Fuzzy entity name matching to prevent duplicates. A narrator entity seeded at startup so first-person statements were attributed correctly.

The architecture was coherent and instincts were mostly right. But the approach broke under realistic notes.

**Why it didn't work:**

Every pipeline failure prompted a new guardrail. Label constraints. Implicit-trigger filters. Pre-deduplication passes before the QA step. Each fix exposed the next failure. The test suite required *exact graph structure* to pass — and exact graph structure is a fragile target when your input is a casual spoken note or a half-formed brain dump.

The root problem: the pipeline was trying to answer *"what is the canonical database truth implied by this note?"* — and that question cannot be reliably answered from a single pass over messy natural language. Demanding certainty from an uncertain process means you spend all your time patching the gap.

There was also a product problem underneath the technical one. A system that only works well if the notes decompose cleanly into entity/attribute/relationship rows is a hidden relational database. That's the failure mode we were explicitly trying to avoid.

**What we learned:**
- Raw logs as source of truth: correct. The log table was right.
- Structure should emerge from use: correct in principle, wrong in implementation — the pipeline was *imposing* structure at write time, not letting it emerge.
- The right question for the parser is *"what might be here?"* not *"what is definitively true?"*
- Testing for graph correctness measures pipeline fidelity, not product usefulness. The two are not the same.
- Six LLM calls per note is too expensive and too brittle. One well-designed call should do more.

---

### Current Direction — Annotation Overlay *(v2, Mar 2026–)*

**Hypothesis:** One cheap LLM pass producing soft annotations is more useful and more robust than six passes producing brittle graph facts. The superpower is retrieval, not ingestion. Testing should measure whether the system can answer real product questions, not whether it produced the correct graph.

**Key shifts from v1:**

| v1 | v2 |
|----|-----|
| 6-phase pipeline | Single-pass annotator |
| Committed graph edges at ingest | Soft annotations with confidence scores |
| Schema enforced at write time | Schema enforced at promotion time (user-initiated) |
| Test: graph structure correct? | Test: can you answer the product question? |
| Entity as authoritative record | Entity as excerpt-backed reference |
| Retrieval not yet built | Retrieval as primary design target |

The full architecture is in [POC_V2_PIVOT.md](./POC_V2_PIVOT.md).

---

## Design Principles

**Invisible structure.** The user never sees a table, names a field, or thinks about schema. Organization is a side effect of logging, not a task.

**Log-first.** The raw input is always preserved and never modified. Structured data is a derived artifact. If the system gets something wrong, the source is there to correct it.

**Annotations, not commitments.** Parser output is soft. Everything is a suggestion until the user confirms it or the system accumulates enough evidence to promote it. Confidence degrades gracefully; it doesn't fail hard.

**Excerpt-first.** Entity pages are built from clipped excerpts of real notes, not from maintained profiles. What you said about Jennifer is more useful than a flat list of her attributes.

**Structure earns its way in.** Promoted entities and attributes exist because they proved useful, not because the pipeline wrote them on first encounter.

**Emergence over planning.** The knowledge graph reflects how the user actually thinks, not how they intended to organize their thoughts at setup time.

---

## Current State

### Shipped (v2 — working app)

The v2 rewrite is complete and functional as a daily-driver prototype.

**Core pipeline**
- Single-pass LLM annotator (person + place detection with confidence + char spans)
- Annotation → Entity → EntityReference promotion with fuzzy dedup (exact → substring → difflib 0.80)
- Full-text search (SQLite FTS5)
- Background parse on save — log is always written first, parse never blocks

**Note features**
- Write and edit notes with smart textarea: Tab indentation, bullet/todo auto-continue on Enter
- Bullet rendering in read view (`- item` → `• item` with indent levels)
- Entity highlights inline in note body (colored by type, clickable)
- Inline annotation chip row below note body

**Todos**
- `[ ]`/`[x]` regex extraction → Task rows on save/edit
- Indent level and section header (nearest preceding non-todo line) captured per task
- Live checkboxes in note view
- Master Todos page: grouped by source note, sections preserved, Open/Done tabs
- Tag + entity filter on Todos page with snapshot pattern (groups don't jump on complete)

**Entity management**
- Entity browser ("People & Places") with type filter + detail panel
- Entity detail: excerpt-backed mention list, attributes, relationships
- Inline rename and user_notes editing on entity detail
- Annotation rejection with cascade: × on chip → deletes EntityReference → flags orphan entity

**UI**
- React/Vite/Tailwind SPA: log list (left), note view (center), context rail (right)
- Tags: LLM extracts 1–4 labels per note, filterable in log list and todos
- Right rail: entity context for current note; click chip → entity detail
- Entities page, Todos page as top-level nav items

---

## Roadmap

**Now — Entity Management Phase 2+**

Entity editing is working. Next phases make the graph self-correcting as the user refines it:
- Alias table: rename creates alias, old notes still link after rename
- `[[Name]]` syntax: user-explicit links, provenance-protected from re-parse
- Selection UI: select text → "Mark as Person / Place" popover
- Reconciliation: re-run entity matching (no LLM) after graph changes

**Near-term**
- WYSIWYG editor (Lexical) — checkboxes clickable while editing, entity highlights as you type
- Voice input — Whisper → same parse path as text
- Natural language query — *"What did we think about Kirk Creek?"*

**Later**
- Semantic search (LogEmbedding table exists, not yet wired to UI)
- Mobile layout
- Supabase / Postgres migration
- Auth + sync

---

## Stack

- **Python + FastAPI** — backend
- **SQLite** — local database (Supabase/Postgres for production)
- **React + Vite + Tailwind** — frontend SPA
- **OpenAI API** — LLM inference (gpt-4o-mini; cost-efficiency is a design constraint)
- **Cursor / Claude Code** — AI-assisted development

---

## About

Built by Steve Stensager — product manager, former TV producer (13 seasons of *Face Off*, SyFy), currently building things I actually want to use.

This project is an honest attempt to solve a problem I've had for years: I capture information constantly and can almost never find it later. Every PKM tool I've tried either requires too much upfront structure or eventually collapses under its own maintenance burden. The hypothesis here is that the AI should carry the organizational load, not the user.

The experiment log above is intentional. Good product thinking means being honest about what didn't work and precise about why.

[LinkedIn](https://www.linkedin.com/in/steven-stensager/) · [stevestensager.com](https://stevestensager.com)
