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

_TODO_LINE_RE = re.compile(r'^(\s*)\[[ xX]?\]\s*(.+)')


def _find_section(lines: list[str], line_index: int) -> str | None:
    """
    Scan backward from line_index to find the nearest non-empty, non-todo line.
    That line is treated as the section header for this todo.
    """
    for i in range(line_index - 1, -1, -1):
        stripped = lines[i].strip()
        if not stripped:
            continue  # skip blank lines
        if re.match(r'^\s*\[[ xX]?\]\s*.+', lines[i]):
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

        checked = bool(re.match(r'^\s*\[[xX]\]', line))
        indent = len(indent_str) // 2
        section = _find_section(lines, idx)

        if con.execute(
            "SELECT 1 FROM Task WHERE source_log_id = ? AND title = ?",
            (log_id, title),
        ).fetchone():
            continue

        con.execute(
            "INSERT INTO Task (title, task_type, status, source_log_id, indent, section) "
            "VALUES (?, 'todo', ?, ?, ?, ?)",
            (title, 'done' if checked else 'todo', log_id, indent, section),
        )
        created += 1

    if created:
        con.commit()
    return {"todos_created": created}


# Annotation types that map to Entity rows
MENTION_TYPE_TO_ENTITY_TYPE: dict[str, str] = {
    "candidate_person": "Person",
    "candidate_place":  "Place",
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

    rows = con.execute("""
        SELECT a.id, a.log_id, a.text_span, a.value, a.type,
               a.confidence, a.start_char, a.end_char, l.raw_text
        FROM   Annotation a
        JOIN   Log l ON l.id = a.log_id
        WHERE  a.type IN ('candidate_person', 'candidate_place')
        AND    a.confidence >= ?
        ORDER  BY a.log_id, a.id
    """, (min_confidence,)).fetchall()

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
