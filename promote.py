"""
Promotion logic: converts accepted annotations into structured entity rows.

Entity/EntityReference:
- Dedup order: exact → substring → fuzzy (difflib 0.80)
- Excerpts are sentence-level clips
- Idempotent — safe to re-run
"""
import difflib
import re
import sqlite3

# ── Todo extraction ───────────────────────────────────────────────────────────

_TODO_LINE_RE = re.compile(r'^(\s*)(?:[-*]\s+)?\[[ xX]?\]\s*(.+)')


def _find_section(lines: list[str], line_index: int) -> str | None:
    """
    Scan backward from line_index to find the nearest non-empty, non-todo line.
    That line is treated as the section header for this todo.
    """
    for i in range(line_index - 1, -1, -1):
        stripped = lines[i].strip()
        if not stripped:
            continue  # skip blank lines
        if re.match(r'^\s*(?:[-*]\s+)?\[[ xX]?\]\s*.+', lines[i]):
            continue  # skip sibling todo lines
        return stripped
    return None


def extract_todos(log_id: int, raw_text: str, con: sqlite3.Connection) -> dict:
    """
    Extract [ ] / [x] lines from raw_text and create Task rows.
    Captures indent level and section header. Idempotent.
    """
    lines = raw_text.split('\n')
    created = 0

    for idx, line in enumerate(lines):
        m = _TODO_LINE_RE.match(line)
        if not m:
            continue
        indent_str, title = m.group(1), m.group(2).strip()
        if not title:
            continue

        checked = bool(re.match(r'^\s*(?:[-*]\s+)?\[[xX]\]', line))
        indent = len(indent_str) // 2
        section = _find_section(lines, idx)

        if con.execute(
            "SELECT 1 FROM Task WHERE source_log_id = ? AND title = ?",
            (log_id, title),
        ).fetchone():
            continue

        con.execute(
            "INSERT INTO Task (title, status, source_log_id, indent, section) "
            "VALUES (?, ?, ?, ?, ?)",
            (title, 'done' if checked else 'todo', log_id, indent, section),
        )
        created += 1

    if created:
        con.commit()
    return {"todos_created": created}


# Annotation types that map to Entity rows
MENTION_TYPE_TO_ENTITY_TYPE: dict[str, str] = {
    "candidate_person":       "Person",
    "candidate_place":        "Place",
    "candidate_pet":          "Pet",
    "candidate_organization": "Organization",
    "candidate_event":        "Event",
    "candidate_thing":        "Thing",
    "candidate_idea":         "Idea",
}


# ---------------------------------------------------------------------------
# Excerpt helpers
# ---------------------------------------------------------------------------

def clip_excerpt(raw_text: str, start_char: int | None, end_char: int | None,
                 window: int = 150) -> str:
    """
    Return a sentence-level clip centred on the mention span.
    Tries to snap to sentence boundaries; falls back to a character window.
    """
    if start_char is None or start_char >= len(raw_text):
        return raw_text[:window].strip()

    half = window // 2
    left  = max(0, start_char - half)
    right = min(len(raw_text), (end_char or start_char) + half)

    # Snap left boundary back to a sentence/line start
    for i in range(left, max(0, left - 60), -1):
        if raw_text[i] in ".!?\n" and i < start_char - 3:
            left = i + 1
            break

    # Snap right boundary forward to a sentence/line end
    for i in range(right, min(len(raw_text), right + 60)):
        if raw_text[i] in ".!?\n":
            right = i + 1
            break

    return raw_text[left:right].strip()


# ---------------------------------------------------------------------------
# Entity dedup
# ---------------------------------------------------------------------------

def find_entity(con: sqlite3.Connection, name: str, entity_type: str) -> int | None:
    """
    Return entity_id if a matching entity already exists, else None.
    Match order:
      1. Exact (case-insensitive)
      2. Substring: "Jen" ↔ "Jennifer", "Kirk Creek" ↔ "Kirk Creek Campground"
      3. Fuzzy (difflib, cutoff 0.80)
    """
    name_lower = name.strip().lower()

    # 1. Exact
    row = con.execute(
        "SELECT id FROM Entity WHERE LOWER(canonical_name) = ? AND entity_type = ?",
        (name_lower, entity_type),
    ).fetchone()
    if row:
        return row[0]

    # 2 & 3. Load all existing entities of this type
    existing = con.execute(
        "SELECT id, canonical_name FROM Entity WHERE entity_type = ? AND merged_into_id IS NULL",
        (entity_type,),
    ).fetchall()
    if not existing:
        return None

    # 2. Substring
    for eid, ename in existing:
        el = ename.lower()
        if name_lower in el or el in name_lower:
            return eid

    # 3. Fuzzy
    names_map = {ename: eid for eid, ename in existing}
    close = difflib.get_close_matches(name, list(names_map.keys()), n=1, cutoff=0.80)
    if close:
        return names_map[close[0]]

    return None


def find_or_create_entity(
    con: sqlite3.Connection,
    canonical_name: str,
    entity_type: str,
    source_log_id: int | None = None,
) -> tuple[int, bool]:
    """
    Return (entity_id, was_created).
    Creates a new tentative Entity only if no match is found.
    """
    entity_id = find_entity(con, canonical_name, entity_type)
    if entity_id is not None:
        return entity_id, False

    cur = con.execute(
        "INSERT INTO Entity (canonical_name, entity_type, status, created_from_log_id) "
        "VALUES (?, ?, 'tentative', ?)",
        (canonical_name.strip(), entity_type, source_log_id),
    )
    con.commit()
    return cur.lastrowid, True


# ---------------------------------------------------------------------------
# Bulk auto-promotion
# ---------------------------------------------------------------------------

def promote_all_mentions(
    con: sqlite3.Connection,
    min_confidence: float = 0.7,
) -> dict:
    """
    Auto-promote all mention annotations at or above min_confidence.
    Skips narrator name. Returns summary dict: entities_created, refs_created, skipped.
    """
    from config import USER_NAME

    type_placeholders = ",".join("?" * len(MENTION_TYPE_TO_ENTITY_TYPE))
    rows = con.execute(f"""
        SELECT a.id, a.log_id, a.text_span, a.value, a.type,
               a.confidence, a.start_char, a.end_char, l.raw_text
        FROM   Annotation a
        JOIN   Log l ON l.id = a.log_id
        WHERE  a.type IN ({type_placeholders})
        AND    a.confidence >= ?
        ORDER  BY a.log_id, a.id
    """, (*MENTION_TYPE_TO_ENTITY_TYPE.keys(), min_confidence)).fetchall()

    entities_created = 0
    refs_created     = 0
    skipped          = 0

    for ann_id, log_id, text_span, canonical_name, ann_type, \
            confidence, start_char, end_char, raw_text in rows:

        name = (canonical_name or text_span or "").strip()
        if not name or name.lower() == USER_NAME.lower():
            skipped += 1
            continue

        entity_type = MENTION_TYPE_TO_ENTITY_TYPE[ann_type]
        _, entity_was_new = find_or_create_entity(con, name, entity_type, log_id)
        if entity_was_new:
            entities_created += 1

        entity_id = find_entity(con, name, entity_type)
        existing_ref = con.execute(
            "SELECT id FROM EntityReference WHERE entity_id = ? AND annotation_id = ?",
            (entity_id, ann_id),
        ).fetchone()
        if existing_ref:
            skipped += 1
            continue

        excerpt = clip_excerpt(raw_text, start_char, end_char)
        con.execute(
            "INSERT INTO EntityReference (entity_id, log_id, annotation_id, excerpt, confidence) "
            "VALUES (?, ?, ?, ?, ?)",
            (entity_id, log_id, ann_id, excerpt, confidence),
        )
        refs_created += 1

    con.commit()
    return {"entities_created": entities_created, "refs_created": refs_created, "skipped": skipped}


# ---------------------------------------------------------------------------
# [[Name]] and {Name} link extraction
# ---------------------------------------------------------------------------

_LINK_RE      = re.compile(r'\[\[([^\]]+)\]\]')
_SOFT_LINK_RE = re.compile(r'\{([^}]+)\}')


def extract_links(log_id: int, raw_text: str, con: sqlite3.Connection) -> dict:
    """
    Find [[Name]] and {Name} patterns in raw_text and create annotations.

    [[Name]] → provenance='user',  status='accepted', confidence=1.0
               Auto-creates entity if needed. Creates EntityReference.

    {Name}   → provenance='text',  status='suggested', confidence=0.85
               Written by the backend after LLM annotation. Does NOT
               auto-create entities — promote_all_mentions handles that.
               Idempotent — skips spans already annotated at that position.
    """
    created = 0

    # ── [[Name]] hard links ───────────────────────────────────────────────
    for m in _LINK_RE.finditer(raw_text):
        name = m.group(1).strip()
        if not name:
            continue
        start_char = m.start()
        end_char   = m.end()

        if con.execute(
            "SELECT 1 FROM Annotation WHERE log_id = ? AND start_char = ? AND provenance = 'user'",
            (log_id, start_char),
        ).fetchone():
            continue

        row = con.execute(
            "SELECT id, entity_type FROM Entity "
            "WHERE LOWER(canonical_name) = LOWER(?) AND merged_into_id IS NULL AND status != 'archived'",
            (name,),
        ).fetchone()

        if row:
            entity_id, entity_type = row[0], row[1]
        else:
            cur = con.execute(
                "INSERT INTO Entity (canonical_name, entity_type, status, created_from_log_id) "
                "VALUES (?, 'person', 'tentative', ?)",
                (name, log_id),
            )
            entity_id   = cur.lastrowid
            entity_type = 'person'

        ann_type = entity_type.lower()

        cur = con.execute(
            "INSERT INTO Annotation "
            "  (log_id, type, value, confidence, status, provenance, start_char, end_char, text_span) "
            "VALUES (?, ?, ?, 1.0, 'accepted', 'user', ?, ?, ?)",
            (log_id, ann_type, name, start_char, end_char, name),
        )
        ann_id = cur.lastrowid

        if not con.execute(
            "SELECT 1 FROM EntityReference WHERE entity_id = ? AND log_id = ? AND annotation_id = ?",
            (entity_id, log_id, ann_id),
        ).fetchone():
            excerpt = clip_excerpt(raw_text, start_char, end_char)
            con.execute(
                "INSERT INTO EntityReference (entity_id, log_id, annotation_id, excerpt, confidence) "
                "VALUES (?, ?, ?, ?, 1.0)",
                (entity_id, log_id, ann_id, excerpt),
            )

        created += 1

    # ── {Name} soft links (written by backend after LLM annotation) ───────
    for m in _SOFT_LINK_RE.finditer(raw_text):
        name = m.group(1).strip()
        if not name:
            continue
        start_char = m.start()
        end_char   = m.end()

        if con.execute(
            "SELECT 1 FROM Annotation WHERE log_id = ? AND start_char = ? AND provenance = 'text'",
            (log_id, start_char),
        ).fetchone():
            continue

        # Get type from existing entity if possible, else default to 'person'
        row = con.execute(
            "SELECT entity_type FROM Entity "
            "WHERE LOWER(canonical_name) = LOWER(?) AND merged_into_id IS NULL AND status != 'archived'",
            (name,),
        ).fetchone()
        ann_type = row[0].lower() if row else 'person'

        con.execute(
            "INSERT INTO Annotation "
            "  (log_id, type, value, confidence, status, provenance, start_char, end_char, text_span) "
            "VALUES (?, ?, ?, 0.85, 'suggested', 'text', ?, ?, ?)",
            (log_id, ann_type, name, start_char, end_char, name),
        )
        created += 1

    con.commit()
    return {"links_created": created}


# ---------------------------------------------------------------------------
# Write {Name} markers into raw_text for LLM-detected spans
# ---------------------------------------------------------------------------

def write_suggested_markers(log_id: int, raw_text: str, con: sqlite3.Connection) -> str:
    """
    For each LLM annotation in DB (provenance not 'user' or 'text') that has a
    valid span, wrap the detected text with {..} if not already wrapped.
    Processes right-to-left so earlier insertions don't shift later offsets.
    Updates raw_text + FTS in DB. Returns the (possibly modified) text.
    """
    rows = con.execute(
        "SELECT start_char, end_char FROM Annotation "
        "WHERE log_id = ? AND provenance NOT IN ('user', 'text') "
        "AND start_char IS NOT NULL AND end_char IS NOT NULL",
        (log_id,),
    ).fetchall()

    if not rows:
        return raw_text

    # Right-to-left to keep earlier offsets valid
    spans = sorted(rows, key=lambda r: r[0], reverse=True)

    modified = raw_text
    for start, end in spans:
        if start < 0 or end > len(modified) or start >= end:
            continue
        # Already wrapped in [[..]] ?
        if start >= 2 and modified[start - 2:start] == '[[':
            continue
        # Already wrapped in {..} ?
        if start >= 1 and modified[start - 1] == '{' and end < len(modified) and modified[end] == '}':
            continue
        modified = modified[:start] + '{' + modified[start:end] + '}' + modified[end:]

    if modified != raw_text:
        con.execute("UPDATE Log SET raw_text = ? WHERE id = ?", (modified, log_id))
        try:
            con.execute("UPDATE Log_fts SET raw_text = ? WHERE rowid = ?", (modified, log_id))
        except Exception:
            pass
        con.commit()

    return modified
