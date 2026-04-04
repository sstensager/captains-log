#!/usr/bin/env python3
"""
Captain's Log — FastAPI backend.

Start:  uvicorn server:app --reload --port 8000
"""
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
load_dotenv()

from db import DB_PATH, get_attributes, init_db, insert_log, rebuild_fts
from promote import extract_todos, extract_links, promote_all_mentions, write_suggested_markers

app = FastAPI(title="Captain's Log API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Type normalization ────────────────────────────────────────────────────────

_TYPE_MAP = {
    "candidate_person":       "person",
    "candidate_place":        "place",
    "candidate_pet":          "pet",
    "candidate_organization": "organization",
    "candidate_event":        "event",
    "candidate_thing":        "thing",
    "candidate_idea":         "idea",
}

VALID_ENTITY_TYPES = ["person", "place", "pet", "organization", "event", "thing", "idea"]


def norm_type(raw: str) -> str:
    return _TYPE_MAP.get(raw, raw)


# ── Pydantic models ───────────────────────────────────────────────────────────

class AnnotationOut(BaseModel):
    id: int
    log_id: int
    type: str
    value: Optional[str] = None
    confidence: Optional[float] = None
    status: str
    corrected_value: Optional[str] = None
    span_start: Optional[int] = None
    span_end: Optional[int] = None
    provenance: Optional[str] = None


class LogSummary(BaseModel):
    id: int
    raw_text: str
    created_at: str
    updated_at: Optional[str] = None
    source: str
    annotation_types: list[str]
    tags: list[str] = []


class LogDetail(BaseModel):
    id: int
    raw_text: str
    created_at: str
    updated_at: Optional[str] = None
    source: str
    annotations: list[AnnotationOut]
    tags: list[str] = []


class LogCreate(BaseModel):
    raw_text: str


class AnnotationPatch(BaseModel):
    status: str
    corrected_value: Optional[str] = None


class TaskEntityRef(BaseModel):
    name: str
    type: str  # 'person' | 'place'


class TaskOut(BaseModel):
    id: int
    title: str
    status: str
    source_log_id: Optional[int] = None
    tags: list[str] = []
    entities: list[TaskEntityRef] = []
    log_preview: Optional[str] = None
    log_created_at: Optional[str] = None
    indent: int = 0
    section: Optional[str] = None


class TaskPatch(BaseModel):
    status: str


class EntityPatch(BaseModel):
    canonical_name: Optional[str] = None
    user_notes: Optional[str] = None
    entity_type: Optional[str] = None  # 'person' | 'place'


class EntitySummary(BaseModel):
    id: int
    name: str
    type: str
    status: str
    ref_count: int


class AttributeOut(BaseModel):
    attr_type: str
    key: str
    value: str
    source_log_id: Optional[int] = None
    source_ts: Optional[str] = None


class MentionOut(BaseModel):
    log_id: int
    excerpt: str
    ts: str
    tags: list[str] = []


class RelationshipOut(BaseModel):
    label: str
    target_name: str
    target_type: str
    direction: str  # 'outgoing' | 'incoming'


class EntityDetail(BaseModel):
    id: int
    name: str
    type: str
    status: str
    user_notes: Optional[str] = None
    attributes: list[AttributeOut]
    mentions: list[MentionOut]
    relationships: list[RelationshipOut]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_con():
    return init_db()


def _row_to_annotation(row) -> AnnotationOut:
    # row columns (always 11): id, log_id, type, value, text_span, confidence, status,
    #                           corrected_value, start_char, end_char, provenance
    return AnnotationOut(
        id=row[0],
        log_id=row[1],
        type=norm_type(row[2]),
        value=row[3] or row[4],  # value first, fall back to text_span
        confidence=row[5],
        status=row[6],
        corrected_value=row[7],
        span_start=row[8],
        span_end=row[9],
        provenance=row[10],
    )

_ANNOTATION_SELECT = """
    SELECT id, log_id, type, value, text_span, confidence, status,
           corrected_value, start_char, end_char, provenance
    FROM Annotation
"""


def _annotation_types_for_log(con, log_id: int) -> list[str]:
    raw_types = ",".join(f"'{t}'" for t in _TYPE_MAP)
    rows = con.execute(
        f"SELECT DISTINCT type FROM Annotation WHERE log_id = ? AND type IN ({raw_types})",
        (log_id,),
    ).fetchall()
    return [norm_type(r[0]) for r in rows if norm_type(r[0]) in set(VALID_ENTITY_TYPES)]


def _log_summary(con, row) -> LogSummary:
    log_id, raw_text, created_at, updated_at, source_type, tags_json = row
    return LogSummary(
        id=log_id,
        raw_text=raw_text,
        created_at=created_at,
        updated_at=updated_at,
        source=source_type,
        annotation_types=_annotation_types_for_log(con, log_id),
        tags=json.loads(tags_json or '[]'),
    )


# ── Log endpoints ─────────────────────────────────────────────────────────────

@app.get("/api/logs", response_model=list[LogSummary])
def list_logs():
    con = _get_con()
    rows = con.execute(
        "SELECT id, raw_text, created_at, updated_at, source_type, tags FROM Log ORDER BY created_at DESC"
    ).fetchall()
    return [_log_summary(con, r) for r in rows]


@app.get("/api/logs/search", response_model=list[LogSummary])
def search_logs(q: str = ""):
    con = _get_con()
    if not q.strip():
        rows = con.execute(
            "SELECT id, raw_text, created_at, updated_at, source_type, tags FROM Log ORDER BY created_at DESC"
        ).fetchall()
        return [_log_summary(con, r) for r in rows]

    from retrieval import fts_search
    results = fts_search(con, q, limit=30)
    if not results:
        return []

    log_ids = [r["log_id"] for r in results]
    order = {lid: i for i, lid in enumerate(log_ids)}
    placeholders = ",".join("?" * len(log_ids))
    rows = con.execute(
        f"SELECT id, raw_text, created_at, updated_at, source_type, tags FROM Log WHERE id IN ({placeholders})",
        log_ids,
    ).fetchall()
    rows = sorted(rows, key=lambda r: order.get(r[0], 999))
    return [_log_summary(con, r) for r in rows]


@app.get("/api/logs/{log_id}", response_model=LogDetail)
def get_log(log_id: int):
    con = _get_con()
    row = con.execute(
        "SELECT id, raw_text, created_at, updated_at, source_type, tags FROM Log WHERE id = ?",
        (log_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Log not found")

    ann_rows = con.execute("""
        SELECT id, log_id, type, value, text_span, confidence, status,
               corrected_value, start_char, end_char, provenance
        FROM Annotation WHERE log_id = ?
        ORDER BY COALESCE(start_char, 99999), id
    """, (log_id,)).fetchall()

    return LogDetail(
        id=row[0],
        raw_text=row[1],
        created_at=row[2],
        updated_at=row[3],
        source=row[4],
        annotations=[_row_to_annotation(r) for r in ann_rows],
        tags=json.loads(row[5] or '[]'),
    )


@app.patch("/api/logs/{log_id}", response_model=LogDetail)
def update_log(log_id: int, body: LogCreate, background_tasks: BackgroundTasks):
    con = _get_con()
    row = con.execute("SELECT id, raw_text FROM Log WHERE id = ?", (log_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Log not found")

    text = body.raw_text.strip()
    if text == row[1]:
        return _get_log_detail(log_id)

    con.execute("UPDATE Log SET raw_text = ?, updated_at = datetime('now') WHERE id = ?", (text, log_id))
    con.execute("UPDATE Log_fts SET raw_text = ? WHERE rowid = ?", (text, log_id))
    con.commit()

    background_tasks.add_task(_bg_reparse, log_id, text)

    row2 = con.execute(
        "SELECT id, raw_text, created_at, updated_at, source_type, tags FROM Log WHERE id = ?", (log_id,)
    ).fetchone()
    return LogDetail(
        id=row2[0], raw_text=row2[1], created_at=row2[2], updated_at=row2[3], source=row2[4],
        annotations=[], tags=json.loads(row2[5] or '[]'),
    )


@app.post("/api/logs", response_model=LogDetail, status_code=201)
def create_log(body: LogCreate, background_tasks: BackgroundTasks):
    con = _get_con()
    text = body.raw_text.strip()
    log_id = insert_log(con, text)
    created_at = con.execute(
        "SELECT created_at FROM Log WHERE id = ?", (log_id,)
    ).fetchone()[0]

    background_tasks.add_task(_bg_parse_and_promote, log_id, text)

    return LogDetail(
        id=log_id,
        raw_text=text,
        created_at=created_at,
        source="text",
        annotations=[],
        tags=[],
    )


def _bg_parse_and_promote(log_id: int, raw_text: str) -> None:
    """Annotate a log and promote entity mentions. Runs in a background thread."""
    from parser import annotate_log
    con = init_db()
    try:
        extract_todos(log_id, raw_text, con)
        extract_links(log_id, raw_text, con)
        annotate_log(log_id, raw_text, con)
        # Write {Name} markers for LLM detections, then re-derive annotations from text
        new_text = write_suggested_markers(log_id, raw_text, con)
        if new_text != raw_text:
            con.execute(
                "DELETE FROM Annotation WHERE log_id = ? AND provenance NOT IN ('user', 'text')",
                (log_id,),
            )
            con.commit()
            extract_links(log_id, new_text, con)
        promote_all_mentions(con, min_confidence=0.7)
    except Exception as e:
        print(f"[bg_parse error] log {log_id}: {e}")


def _bg_reparse(log_id: int, raw_text: str) -> None:
    """Clear and re-run full pipeline after an edit."""
    from parser import annotate_log
    con = init_db()
    try:
        # Collect rejected names from prior non-text, non-user annotations
        prior = con.execute(
            "SELECT status, COALESCE(corrected_value, value) FROM Annotation "
            "WHERE log_id = ? AND provenance NOT IN ('user', 'text') AND value IS NOT NULL",
            (log_id,),
        ).fetchall()
        rejected_names = [r[1] for r in prior if r[0] == 'rejected']

        # confirmed_names: derived directly from text so {Name} and [[Name]] survive
        confirmed_names = (
            [m.group(1).strip() for m in re.finditer(r'\[\[([^\]]+)\]\]', raw_text)] +
            [m.group(1).strip() for m in re.finditer(r'\{([^}]+)\}', raw_text)]
        )

        con.execute("DELETE FROM EntityReference WHERE log_id = ?", (log_id,))
        con.execute("DELETE FROM Annotation WHERE log_id = ?", (log_id,))
        con.execute("DELETE FROM Task WHERE source_log_id = ?", (log_id,))
        con.commit()

        extract_todos(log_id, raw_text, con)
        extract_links(log_id, raw_text, con)   # recreates {Name} and [[Name]] annotations
        annotate_log(log_id, raw_text, con,
                     rejected_names=rejected_names or None,
                     confirmed_names=confirmed_names or None)

        # Write {Name} for any newly detected entities not already in text
        new_text = write_suggested_markers(log_id, raw_text, con)
        if new_text != raw_text:
            con.execute(
                "DELETE FROM Annotation WHERE log_id = ? AND provenance NOT IN ('user', 'text')",
                (log_id,),
            )
            con.commit()
            extract_links(log_id, new_text, con)

        promote_all_mentions(con, min_confidence=0.7)
    except Exception as e:
        print(f"[bg_reparse error] log {log_id}: {e}")


# ── Task endpoints ────────────────────────────────────────────────────────────

@app.get("/api/tasks", response_model=list[TaskOut])
def list_tasks(log_id: Optional[int] = None):
    con = _get_con()

    if log_id is not None:
        rows = con.execute(
            "SELECT id, title, status, source_log_id FROM Task WHERE source_log_id = ? ORDER BY id",
            (log_id,),
        ).fetchall()
        return [TaskOut(id=r[0], title=r[1], status=r[2], source_log_id=r[3]) for r in rows]

    rows = con.execute("""
        SELECT t.id, t.title, t.status, t.source_log_id, l.tags, l.raw_text,
               t.indent, t.section, l.created_at
        FROM Task t
        LEFT JOIN Log l ON l.id = t.source_log_id
        ORDER BY l.created_at DESC, t.id
    """).fetchall()

    # Entity name+type per log — confirmed (EntityReference) + suggested/accepted annotations
    log_ids = list({r[3] for r in rows if r[3]})
    entity_map: dict = {}
    if log_ids:
        ph = ",".join("?" * len(log_ids))
        # All Annotation.type values that correspond to entities
        _entity_ann_types = (
            list(_TYPE_MAP.keys()) +          # candidate_person, candidate_place, ...
            [t for t in VALID_ENTITY_TYPES]   # person, place, ... (from extract_links)
        )
        _ann_ph = ",".join("?" * len(_entity_ann_types))
        seen: set = set()
        for elog_id, ename, etype in con.execute(f"""
            SELECT DISTINCT er.log_id, e.canonical_name, e.entity_type
            FROM EntityReference er
            JOIN Entity e ON e.id = er.entity_id AND e.merged_into_id IS NULL
            WHERE er.log_id IN ({ph})
            UNION
            SELECT DISTINCT a.log_id, a.value, a.type
            FROM Annotation a
            WHERE a.log_id IN ({ph})
              AND a.status IN ('suggested', 'accepted')
              AND a.type IN ({_ann_ph})
        """, log_ids + log_ids + _entity_ann_types).fetchall():
            key = (elog_id, ename)
            if key not in seen:
                seen.add(key)
                entity_map.setdefault(elog_id, []).append(
                    TaskEntityRef(name=ename, type=etype.lower())
                )

    result = []
    for task_id, title, status, source_log_id, tags_json, raw_text, indent, section, log_created_at in rows:
        tags = json.loads(tags_json or "[]")
        preview = (raw_text or "").split("\n")[0][:80] or None
        result.append(TaskOut(
            id=task_id, title=title, status=status, source_log_id=source_log_id,
            tags=tags, entities=entity_map.get(source_log_id, []),
            log_preview=preview, log_created_at=log_created_at,
            indent=indent or 0, section=section,
        ))
    return result


@app.patch("/api/tasks/{task_id}", response_model=TaskOut)
def patch_task(task_id: int, body: TaskPatch):
    con = _get_con()
    if not con.execute("SELECT 1 FROM Task WHERE id = ?", (task_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Task not found")
    con.execute(
        "UPDATE Task SET status = ?, updated_at = datetime('now') WHERE id = ?",
        (body.status, task_id),
    )
    con.commit()
    row = con.execute(
        "SELECT id, title, status, source_log_id FROM Task WHERE id = ?", (task_id,)
    ).fetchone()
    return TaskOut(id=row[0], title=row[1], status=row[2], source_log_id=row[3])


# ── Annotation endpoints ──────────────────────────────────────────────────────

@app.patch("/api/annotations/{ann_id}", response_model=AnnotationOut)
def patch_annotation(ann_id: int, body: AnnotationPatch):
    con = _get_con()
    if not con.execute("SELECT 1 FROM Annotation WHERE id = ?", (ann_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Annotation not found")

    con.execute(
        "UPDATE Annotation SET status = ?, corrected_value = ? WHERE id = ?",
        (body.status, body.corrected_value, ann_id),
    )
    con.commit()

    if body.status == 'rejected':
        # Cascade: remove EntityReference tied to this annotation
        con.execute("DELETE FROM EntityReference WHERE annotation_id = ?", (ann_id,))
        con.commit()
        # Flag entities with no remaining references as orphaned
        orphan_rows = con.execute("""
            SELECT e.id FROM Entity e
            WHERE e.merged_into_id IS NULL AND e.status != 'orphaned'
              AND NOT EXISTS (SELECT 1 FROM EntityReference er WHERE er.entity_id = e.id)
        """).fetchall()
        if orphan_rows:
            ids_ph = ",".join("?" * len(orphan_rows))
            con.execute(
                f"UPDATE Entity SET status = 'orphaned' WHERE id IN ({ids_ph})",
                [r[0] for r in orphan_rows],
            )
            con.commit()

    row = con.execute("""
        SELECT id, log_id, type, value, text_span, confidence, status,
               corrected_value, start_char, end_char, provenance
        FROM Annotation WHERE id = ?
    """, (ann_id,)).fetchone()
    return _row_to_annotation(row)


@app.post("/api/annotations/{ann_id}/promote", response_model=LogDetail)
def promote_annotation(ann_id: int, background_tasks: BackgroundTasks):
    """
    Promote an LLM annotation to an explicit [[Name]] link.
    Rewrites raw_text to wrap the detected span, then triggers a background reparse.
    """
    con = _get_con()
    row = con.execute(
        "SELECT log_id, start_char, end_char, COALESCE(corrected_value, value) "
        "FROM Annotation WHERE id = ?", (ann_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Annotation not found")
    log_id, start_char, end_char, name = row[0], row[1], row[2], row[3]
    if start_char is None or end_char is None:
        raise HTTPException(status_code=400, detail="Annotation has no span — cannot promote")

    raw_text = con.execute("SELECT raw_text FROM Log WHERE id = ?", (log_id,)).fetchone()[0]
    span_text = raw_text[start_char:end_char]
    # Strip {..} wrapper if promoting a text-suggested marker
    inner = span_text[1:-1] if span_text.startswith('{') and span_text.endswith('}') else span_text
    new_text = raw_text[:start_char] + '[[' + inner + ']]' + raw_text[end_char:]

    con.execute("UPDATE Log SET raw_text = ? WHERE id = ?", (new_text, log_id))
    con.commit()

    # Delete the promoted annotation plus all stale text-provenance annotations —
    # their positions shift whenever text length changes, so recreate them fresh.
    con.execute("DELETE FROM EntityReference WHERE annotation_id = ?", (ann_id,))
    con.execute("DELETE FROM Annotation WHERE id = ?", (ann_id,))
    con.execute(
        "DELETE FROM Annotation WHERE log_id = ? AND provenance = 'text'", (log_id,)
    )
    con.commit()
    extract_links(log_id, new_text, con)

    background_tasks.add_task(_bg_reparse, log_id, new_text)

    return _get_log_detail(log_id)


class RelinkBody(BaseModel):
    target_name: str


@app.post("/api/annotations/{ann_id}/relink", response_model=LogDetail)
def relink_annotation(ann_id: int, body: RelinkBody, background_tasks: BackgroundTasks):
    """
    Re-assign an annotation to a different entity by rewriting its text marker.
    {Robert} or [[Robert]] → [[target_name]]. Always writes a hard link since
    this is a deliberate disambiguation by the user.
    """
    con = _get_con()
    row = con.execute(
        "SELECT log_id, start_char, end_char FROM Annotation WHERE id = ?", (ann_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Annotation not found")
    log_id, start_char, end_char = row
    if start_char is None or end_char is None:
        raise HTTPException(status_code=400, detail="Annotation has no span — cannot relink")

    target_name = body.target_name.strip()
    if not target_name:
        raise HTTPException(status_code=400, detail="target_name cannot be empty")

    raw_text = con.execute("SELECT raw_text FROM Log WHERE id = ?", (log_id,)).fetchone()[0]
    new_text = raw_text[:start_char] + '[[' + target_name + ']]' + raw_text[end_char:]

    con.execute("UPDATE Log SET raw_text = ? WHERE id = ?", (new_text, log_id))
    con.commit()

    # Clear stale annotations and recreate from updated text
    con.execute("DELETE FROM EntityReference WHERE annotation_id = ?", (ann_id,))
    con.execute("DELETE FROM Annotation WHERE id = ?", (ann_id,))
    con.execute("DELETE FROM Annotation WHERE log_id = ? AND provenance = 'text'", (log_id,))
    con.commit()
    extract_links(log_id, new_text, con)

    background_tasks.add_task(_bg_reparse, log_id, new_text)
    return _get_log_detail(log_id)


def _get_log_detail(log_id: int) -> LogDetail:
    """Return a LogDetail with current annotations (pre-reparse snapshot)."""
    con = _get_con()
    row = con.execute(
        "SELECT id, raw_text, created_at, updated_at, source_type, tags FROM Log WHERE id = ?", (log_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Log not found")
    ann_rows = con.execute(
        "SELECT id, log_id, type, value, text_span, confidence, status, corrected_value, start_char, end_char, provenance "
        "FROM Annotation WHERE log_id = ? ORDER BY id", (log_id,)
    ).fetchall()
    annotations = [_row_to_annotation(r) for r in ann_rows]
    return LogDetail(
        id=row[0], raw_text=row[1], created_at=row[2], updated_at=row[3], source=row[4],
        annotations=annotations, tags=json.loads(row[5] or '[]'),
    )


# ── Entity endpoints ──────────────────────────────────────────────────────────

@app.get("/api/entity-types", response_model=list[str])
def list_entity_types():
    return VALID_ENTITY_TYPES


@app.get("/api/entities", response_model=list[EntitySummary])
def list_entities():
    con = _get_con()
    rows = con.execute("""
        SELECT e.id, e.canonical_name, e.entity_type, e.status,
               COUNT(er.id) as ref_count
        FROM Entity e
        LEFT JOIN EntityReference er ON er.entity_id = e.id
        WHERE e.merged_into_id IS NULL AND e.status != 'archived'
        GROUP BY e.id
        ORDER BY ref_count DESC, e.canonical_name
    """).fetchall()
    return [
        EntitySummary(id=r[0], name=r[1], type=r[2].lower(), status=r[3], ref_count=r[4])
        for r in rows
    ]


@app.get("/api/entities/{entity_name}", response_model=EntityDetail)
def get_entity(entity_name: str):
    con = _get_con()
    row = con.execute(
        "SELECT id, canonical_name, entity_type, status, user_notes "
        "FROM Entity WHERE LOWER(canonical_name) = LOWER(?) "
        "AND merged_into_id IS NULL LIMIT 1",
        (entity_name,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Entity not found")

    entity_id, name, entity_type, status, user_notes = row

    # Attributes
    attr_rows = get_attributes(con, entity_id)
    attributes = []
    for _, attr_type, key, display_value, confidence, provenance, source_log_id in attr_rows:
        source_ts = None
        if source_log_id:
            ts_row = con.execute(
                "SELECT created_at FROM Log WHERE id = ?", (source_log_id,)
            ).fetchone()
            source_ts = ts_row[0] if ts_row else None
        attributes.append(AttributeOut(
            attr_type=attr_type, key=key, value=display_value,
            source_log_id=source_log_id, source_ts=source_ts,
        ))

    # Mentions
    mention_rows = con.execute("""
        SELECT er.log_id, er.excerpt, l.created_at, l.tags
        FROM EntityReference er
        JOIN Log l ON l.id = er.log_id
        WHERE er.entity_id = ?
        ORDER BY l.created_at DESC
    """, (entity_id,)).fetchall()
    mentions = [
        MentionOut(log_id=r[0], excerpt=r[1] or "", ts=r[2], tags=json.loads(r[3] or '[]'))
        for r in mention_rows
    ]

    # Relationships
    rel_rows = con.execute("""
        SELECT COALESCE(er.corrected_label, er.label),
               ea.canonical_name, ea.entity_type,
               eb.canonical_name, eb.entity_type,
               er.entity_a_id
        FROM EntityRelationship er
        JOIN Entity ea ON ea.id = er.entity_a_id
        JOIN Entity eb ON eb.id = er.entity_b_id
        WHERE er.entity_a_id = ? OR er.entity_b_id = ?
    """, (entity_id, entity_id)).fetchall()

    relationships = []
    for label, a_name, a_type, b_name, b_type, a_id in rel_rows:
        if a_id == entity_id:
            relationships.append(RelationshipOut(
                label=label, target_name=b_name,
                target_type=b_type.lower(), direction="outgoing",
            ))
        else:
            relationships.append(RelationshipOut(
                label=label, target_name=a_name,
                target_type=a_type.lower(), direction="incoming",
            ))

    return EntityDetail(
        id=entity_id, name=name, type=entity_type.lower(), status=status,
        user_notes=user_notes,
        attributes=attributes, mentions=mentions, relationships=relationships,
    )


class EntityCreate(BaseModel):
    canonical_name: str
    entity_type: str


@app.post("/api/entities", response_model=EntityDetail, status_code=201)
def create_entity(body: EntityCreate):
    name = body.canonical_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    if body.entity_type not in VALID_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid type: {body.entity_type}")
    con = _get_con()
    existing = con.execute(
        "SELECT canonical_name FROM Entity WHERE LOWER(canonical_name) = LOWER(?) AND status != 'archived'",
        (name,),
    ).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail=f"'{existing[0]}' already exists")
    con.execute(
        "INSERT INTO Entity (canonical_name, entity_type, status) VALUES (?, ?, 'tentative')",
        (name, body.entity_type),
    )
    con.commit()
    return get_entity(name)


@app.patch("/api/entities/{entity_id}", response_model=EntityDetail)
def patch_entity(entity_id: int, body: EntityPatch):
    con = _get_con()
    row = con.execute(
        "SELECT canonical_name FROM Entity WHERE id = ? AND merged_into_id IS NULL",
        (entity_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Entity not found")

    if body.canonical_name is not None:
        name = body.canonical_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        con.execute("UPDATE Entity SET canonical_name = ? WHERE id = ?", (name, entity_id))

    if body.user_notes is not None:
        con.execute("UPDATE Entity SET user_notes = ? WHERE id = ?", (body.user_notes, entity_id))

    if body.entity_type is not None:
        t = body.entity_type.strip().lower()
        if t not in set(VALID_ENTITY_TYPES):
            raise HTTPException(status_code=400, detail=f"entity_type must be one of: {', '.join(VALID_ENTITY_TYPES)}")
        con.execute("UPDATE Entity SET entity_type = ? WHERE id = ?", (t.capitalize(), entity_id))

    con.commit()

    new_name = con.execute(
        "SELECT canonical_name FROM Entity WHERE id = ?", (entity_id,)
    ).fetchone()[0]
    return get_entity(new_name)


@app.delete("/api/entities/{entity_id}", status_code=204)
def delete_entity(entity_id: int):
    con = _get_con()
    if not con.execute(
        "SELECT 1 FROM Entity WHERE id = ? AND merged_into_id IS NULL", (entity_id,)
    ).fetchone():
        raise HTTPException(status_code=404, detail="Entity not found")
    con.execute("UPDATE Entity SET status = 'archived' WHERE id = ?", (entity_id,))
    con.commit()


class MergeBody(BaseModel):
    target_id: int


@app.post("/api/entities/{entity_id}/merge")
def merge_entity(entity_id: int, body: MergeBody):
    """Merge entity_id into target_id. Repoints all EntityReferences from loser to winner."""
    if entity_id == body.target_id:
        raise HTTPException(status_code=400, detail="Cannot merge an entity into itself")
    con = _get_con()
    loser = con.execute(
        "SELECT id, canonical_name FROM Entity WHERE id = ? AND merged_into_id IS NULL AND status != 'archived'",
        (entity_id,),
    ).fetchone()
    if not loser:
        raise HTTPException(status_code=404, detail="Source entity not found")
    loser_id = loser[0]

    winner = con.execute(
        "SELECT id, canonical_name FROM Entity WHERE id = ? AND merged_into_id IS NULL AND status != 'archived'",
        (body.target_id,),
    ).fetchone()
    if not winner:
        raise HTTPException(status_code=404, detail="Target entity not found")
    winner_id = winner[0]

    loser_name = loser[1]
    winner_name_current = winner[1]

    # Repoint loser refs that don't already have a winner ref for that log
    con.execute(
        """
        UPDATE EntityReference SET entity_id = ?
        WHERE entity_id = ?
          AND log_id NOT IN (SELECT log_id FROM EntityReference WHERE entity_id = ?)
        """,
        (winner_id, loser_id, winner_id),
    )
    # Delete any remaining loser refs (duplicates that already have a winner ref)
    con.execute("DELETE FROM EntityReference WHERE entity_id = ?", (loser_id,))

    # Update annotation values so chips on log views show winner name
    con.execute(
        "UPDATE Annotation SET value = ? WHERE LOWER(value) = LOWER(?)",
        (winner_name_current, loser_name),
    )

    # Archive the loser, record merge
    con.execute(
        "UPDATE Entity SET status = 'archived', merged_into_id = ? WHERE id = ?",
        (winner_id, loser_id),
    )
    con.commit()

    winner_name = con.execute(
        "SELECT canonical_name FROM Entity WHERE id = ?", (winner_id,)
    ).fetchone()[0]
    return get_entity(winner_name)


# ── Admin / dev panel endpoints ───────────────────────────────────────────────

@app.get("/api/admin/stats")
def admin_stats():
    con = _get_con()
    return {
        "logs":        con.execute("SELECT COUNT(*) FROM Log").fetchone()[0],
        "annotations": con.execute("SELECT COUNT(*) FROM Annotation").fetchone()[0],
        "entities":    con.execute("SELECT COUNT(*) FROM Entity").fetchone()[0],
        "embeddings":  con.execute("SELECT COUNT(*) FROM LogEmbedding").fetchone()[0],
    }


@app.post("/api/admin/reset")
def admin_reset():
    """Wipe the database completely."""
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    init_db()
    return {"ok": True, "message": "Database wiped."}


@app.post("/api/admin/load-fixtures")
def admin_load_fixtures(background_tasks: BackgroundTasks, embeddings: bool = False):
    """Load the 37 fixture notes. Pass ?embeddings=true to also generate embeddings + LLM attributes."""
    background_tasks.add_task(_bg_load_fixtures, embeddings)
    return {
        "ok": True,
        "message": f"Loading fixtures {'with' if embeddings else 'without'} embeddings...",
    }


def _bg_load_fixtures(with_embeddings: bool) -> None:
    from parser import create_and_parse_log as _parse_log
    from repopulate import load_fixture_notes

    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    con = init_db()

    notes = load_fixture_notes()
    for text in notes:
        _parse_log(text, con)

    rebuild_fts(con)
    promote_all_mentions(con, min_confidence=0.7)

    if with_embeddings:
        from openai import OpenAI
        from retrieval import embed_all_logs
        client = OpenAI()
        embed_all_logs(con, client)

    print(f"[fixtures loaded] {'with' if with_embeddings else 'without'} embeddings")


@app.post("/api/admin/embed")
def admin_embed(background_tasks: BackgroundTasks):
    """Generate embeddings for all logs that don't have them yet."""
    background_tasks.add_task(_bg_embed)
    return {"ok": True, "message": "Embedding generation started..."}


def _bg_embed() -> None:
    from openai import OpenAI
    from retrieval import embed_all_logs
    con = init_db()
    client = OpenAI()
    n = embed_all_logs(con, client)
    print(f"[embed] {n} embeddings generated")
