"""
Natural Language Query (NLQ) for Captain's Log.

Pipeline: route_query → dispatch (engine handler) → synthesize_answer

Two gpt-4o-mini calls per query (~$0.0001 each).

Engines:
  lookup          — first/last/specific occurrence of an entity
  timeline        — sequence of events over a period
  aggregation     — count, rank, frequency across entries
  entity_centric  — summary of all logs mentioning a person/place
  pattern_mining  — habits, routines, recurring events (stub → fallback)
  state_tracking  — todos, open loops, commitments
  semantic_similar— "have I dealt with this before?" (stub → fallback)
  correlation     — triggers, causes, outcomes (stub → fallback)
  comparative     — before/after, trend analysis (stub → fallback)
  narrative       — period summary, life snapshot
"""
import json
import sqlite3
from typing import Optional

from openai import OpenAI
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class DateRange(BaseModel):
    start: str  # "YYYY-MM-DD"
    end: str    # "YYYY-MM-DD"


class RouterResult(BaseModel):
    engine: str                    # one of the 10 engine names
    entity_names: list[str]        # proper nouns to look up
    entity_type: Optional[str]     # "person" | "place" | None
    occurrence: Optional[str]      # "first" | "last" (for lookup engine)
    date_range: Optional[DateRange]
    keywords: list[str]
    tags: list[str]
    intent: str


# ---------------------------------------------------------------------------
# Stage 1: route_query
# ---------------------------------------------------------------------------

_ROUTER_SYSTEM = """\
You are a query router for a personal log app. Classify the user's question into one of these engines and extract structured parameters.

ENGINES:
- lookup: Finding first/last/specific occurrence of something. E.g. "When did I first visit Dario's?", "When was the last time I saw Matt?"
- timeline: Reconstructing a sequence of events over a period. E.g. "What did I do on my New York trip?", "Walk me through last week."
- aggregation: Counting, ranking, or frequency analysis. E.g. "How many times have I gone hiking?", "Which restaurant do I visit most?"
- entity_centric: Everything about a specific named person or place. E.g. "What's been going on with Sarah?", "Tell me about my visits to Disneyland."
- pattern_mining: Habits, routines, recurring behavior. E.g. "What do I usually do on Fridays?", "What restaurants do I go to regularly?"
- state_tracking: Todos, goals, open loops, commitments. E.g. "What am I still meaning to do?", "Did I finish the deck project?"
- semantic_similar: Finding analogous past situations. E.g. "Have I dealt with this before?", "When else did I feel like this?"
- correlation: Cause/effect or trigger analysis. E.g. "Does alcohol make my sleep worse?", "What tends to stress me out?"
- comparative: Before/after analysis or trend comparison. E.g. "Am I exercising more than last year?", "What changed after I switched jobs?"
- narrative: Broad synthesis over a period or life area. E.g. "Summarize my March vacation.", "What was life like in summer 2024?"

Return JSON:
- engine: one of the 10 engine names above
- entity_names: list of specific proper nouns to look up (people, places, things). Empty if none named.
- entity_type: "person" | "place" | null — only set if entity_names is non-empty and type is clear
- occurrence: "first" | "last" | null — only for lookup engine
- date_range: null OR {{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}}
- keywords: content keywords for full-text search, skip stop words
- tags: relevant tags from: restaurants, cooking, coffee, bars, wine, food, camping, hiking, road-trips, hotels, flights, travel, family, friends, kids, dates, social, fitness, medical, sleep, wellness, health, renovation, repairs, home, meetings, projects, decisions, work, expenses, budget, finance, movies, books, music, tv, sports, games, ideas, research, learning, planning, milestone, reflection, memory, shopping
- intent: one short sentence describing what the user wants

Today's date: {today}"""


def route_query(client: OpenAI, question: str, today: str) -> RouterResult:
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _ROUTER_SYSTEM.format(today=today)},
            {"role": "user", "content": question},
        ],
        max_tokens=400,
        temperature=0,
    )
    data = json.loads(resp.choices[0].message.content)
    return RouterResult(
        engine=data.get("engine", "narrative"),
        entity_names=data.get("entity_names", []),
        entity_type=data.get("entity_type") or None,
        occurrence=data.get("occurrence") or None,
        date_range=DateRange(**data["date_range"]) if data.get("date_range") else None,
        keywords=data.get("keywords", []),
        tags=data.get("tags", []),
        intent=data.get("intent", ""),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fuzzy_match_entity(con: sqlite3.Connection, name: str) -> Optional[int]:
    row = con.execute(
        "SELECT id FROM Entity WHERE LOWER(canonical_name) = LOWER(?)", (name,)
    ).fetchone()
    if row:
        return row[0]
    row = con.execute(
        "SELECT id FROM Entity WHERE LOWER(canonical_name) LIKE LOWER(?)", (f"%{name}%",)
    ).fetchone()
    return row[0] if row else None


def _logs_for_entity(con: sqlite3.Connection, entity_id: int) -> list[tuple]:
    return con.execute("""
        SELECT er.log_id, l.raw_text, l.created_at, er.confidence
        FROM EntityReference er
        JOIN Log l ON l.id = er.log_id
        WHERE er.entity_id = ?
        ORDER BY l.created_at ASC
    """, (entity_id,)).fetchall()


def _apply_date_filter(
    scores: dict, meta: dict, date_range: DateRange, con: sqlite3.Connection, today: str
) -> tuple[dict, dict]:
    if date_range.start > today:
        return scores, meta
    start = date_range.start
    end = date_range.end + "T23:59:59"
    keep: set[int] = set()
    for log_id in list(scores.keys()):
        if start <= meta[log_id]["created_at"] <= end:
            keep.add(log_id)
        else:
            date_refs = con.execute("""
                SELECT value FROM Annotation
                WHERE log_id = ? AND type = 'date_ref' AND status != 'rejected'
            """, (log_id,)).fetchall()
            if any(start <= (r[0] or "") <= end for r in date_refs):
                keep.add(log_id)
    return {k: v for k, v in scores.items() if k in keep}, \
           {k: v for k, v in meta.items() if k in keep}


def _fts_pass(
    con: sqlite3.Connection,
    keywords: list[str],
    scores: dict,
    meta: dict,
    limit: int,
) -> tuple[dict, dict]:
    from retrieval import _sanitize_fts_query
    _STOP_WORDS = {
        'a','an','the','is','are','was','were','be','been','being',
        'have','has','had','do','does','did','will','would','could',
        'should','may','might','shall','can','go','get','make',
        'like','want','need','know','think','see','come','take',
        'use','find','give','tell','ask','seem','feel','try',
        'leave','call','keep','let','put','mean','become','show',
        'we','our','us','i','you','it','this','that','what','which',
        'who','how','when','where','why',
    }
    filtered = [k for k in keywords if k.lower() not in _STOP_WORDS]
    if not filtered:
        return scores, meta
    fts_query = " ".join(_sanitize_fts_query(k) for k in filtered if k.strip())
    if not fts_query.strip():
        return scores, meta
    try:
        rows = con.execute("""
            SELECT l.id, l.raw_text, l.created_at, rank
            FROM Log_fts
            JOIN Log l ON l.id = Log_fts.rowid
            WHERE Log_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        """, (fts_query, limit * 3)).fetchall()
        if rows:
            raw_scores = [-r[3] for r in rows]
            max_score = max(raw_scores) or 1.0
            for i, (log_id, raw_text, created_at, _rank) in enumerate(rows):
                scores[log_id] = scores.get(log_id, 0.0) + raw_scores[i] / max_score
                meta.setdefault(log_id, {"raw_text": raw_text, "created_at": created_at})
    except Exception:
        pass
    return scores, meta


def _tag_pass(
    con: sqlite3.Connection,
    tags: list[str],
    scores: dict,
    meta: dict,
) -> tuple[dict, dict]:
    if not tags:
        return scores, meta
    if scores:
        for log_id in scores:
            row = con.execute("SELECT tags FROM Log WHERE id = ?", (log_id,)).fetchone()
            if row:
                log_tags = json.loads(row[0] or "[]")
                if any(t in log_tags for t in tags):
                    scores[log_id] += 0.5
    else:
        rows = con.execute("SELECT id, raw_text, created_at, tags FROM Log").fetchall()
        for log_id, raw_text, created_at, tags_json in rows:
            log_tags = json.loads(tags_json or "[]")
            if any(t in log_tags for t in tags):
                scores[log_id] = 1.0
                meta[log_id] = {"raw_text": raw_text, "created_at": created_at}
    return scores, meta


def _scores_to_logs(scores: dict, meta: dict, limit: int) -> list[dict]:
    sorted_ids = sorted(scores, key=lambda x: -scores[x])[:limit]
    return [
        {
            "log_id": log_id,
            "raw_text": meta[log_id]["raw_text"],
            "created_at": meta[log_id]["created_at"],
            "score": scores[log_id],
        }
        for log_id in sorted_ids
    ]


# ---------------------------------------------------------------------------
# Engine handlers
# ---------------------------------------------------------------------------

def handle_lookup(
    con: sqlite3.Connection, result: RouterResult, today: str, limit: int = 10
) -> list[dict]:
    """First or last occurrence of a named entity."""
    scores: dict[int, float] = {}
    meta: dict[int, dict] = {}

    for name in result.entity_names:
        entity_id = _fuzzy_match_entity(con, name)
        if entity_id is None:
            continue
        rows = _logs_for_entity(con, entity_id)
        if not rows:
            continue
        # Pick first or last based on occurrence flag
        target_rows = [rows[0]] if result.occurrence == "first" else [rows[-1]]
        for log_id, raw_text, created_at, confidence in target_rows:
            scores[log_id] = scores.get(log_id, 0.0) + 3.0 * (confidence or 0.8)
            meta.setdefault(log_id, {"raw_text": raw_text, "created_at": created_at})

    # FTS fallback if no entity match
    if not scores:
        scores, meta = _fts_pass(con, result.keywords, scores, meta, limit)

    return _scores_to_logs(scores, meta, limit)


def handle_timeline(
    con: sqlite3.Connection, result: RouterResult, today: str, limit: int = 20
) -> list[dict]:
    """Sequence of events over a period, returned in chronological order."""
    scores: dict[int, float] = {}
    meta: dict[int, dict] = {}

    # Entity mentions as anchors
    for name in result.entity_names:
        entity_id = _fuzzy_match_entity(con, name)
        if entity_id is None:
            continue
        for log_id, raw_text, created_at, confidence in _logs_for_entity(con, entity_id):
            scores[log_id] = scores.get(log_id, 0.0) + 2.0 * (confidence or 0.8)
            meta.setdefault(log_id, {"raw_text": raw_text, "created_at": created_at})

    scores, meta = _fts_pass(con, result.keywords, scores, meta, limit)
    scores, meta = _tag_pass(con, result.tags, scores, meta)

    if result.date_range:
        scores, meta = _apply_date_filter(scores, meta, result.date_range, con, today)

    # For timeline queries, return chronologically rather than by score
    log_ids = list(scores.keys())
    if not log_ids:
        return []
    rows = con.execute(
        f"SELECT id, raw_text, created_at FROM Log WHERE id IN ({','.join('?' * len(log_ids))}) ORDER BY created_at ASC LIMIT ?",
        (*log_ids, limit)
    ).fetchall()
    return [
        {"log_id": r[0], "raw_text": r[1], "created_at": r[2], "score": scores.get(r[0], 1.0)}
        for r in rows
    ]


def handle_aggregation(
    con: sqlite3.Connection, result: RouterResult, today: str, limit: int = 10
) -> list[dict]:
    """Count/rank/frequency queries — surfaces the most-referenced entities of a type."""
    scores: dict[int, float] = {}
    meta: dict[int, dict] = {}

    # If entity type known, rank entities of that type by reference count
    if result.entity_type:
        entity_rows = con.execute("""
            SELECT e.id, e.canonical_name, COUNT(er.log_id) as ref_count
            FROM Entity e
            JOIN EntityReference er ON er.entity_id = e.id
            WHERE LOWER(e.entity_type) = LOWER(?)
            GROUP BY e.id
            ORDER BY ref_count DESC
            LIMIT ?
        """, (result.entity_type, limit)).fetchall()
        for entity_id, name, ref_count in entity_rows:
            for log_id, raw_text, created_at, confidence in _logs_for_entity(con, entity_id):
                scores[log_id] = scores.get(log_id, 0.0) + ref_count * (confidence or 0.8)
                meta.setdefault(log_id, {"raw_text": raw_text, "created_at": created_at})

    # Named entities
    for name in result.entity_names:
        entity_id = _fuzzy_match_entity(con, name)
        if entity_id is None:
            continue
        for log_id, raw_text, created_at, confidence in _logs_for_entity(con, entity_id):
            scores[log_id] = scores.get(log_id, 0.0) + 2.0 * (confidence or 0.8)
            meta.setdefault(log_id, {"raw_text": raw_text, "created_at": created_at})

    scores, meta = _fts_pass(con, result.keywords, scores, meta, limit)
    scores, meta = _tag_pass(con, result.tags, scores, meta)

    if result.date_range:
        scores, meta = _apply_date_filter(scores, meta, result.date_range, con, today)

    return _scores_to_logs(scores, meta, limit)


def handle_entity_centric(
    con: sqlite3.Connection, result: RouterResult, today: str, limit: int = 10
) -> list[dict]:
    """All logs mentioning a specific person or place."""
    scores: dict[int, float] = {}
    meta: dict[int, dict] = {}

    for name in result.entity_names:
        entity_id = _fuzzy_match_entity(con, name)
        if entity_id is None:
            continue
        for log_id, raw_text, created_at, confidence in _logs_for_entity(con, entity_id):
            scores[log_id] = scores.get(log_id, 0.0) + 3.0 * (confidence or 0.8)
            meta.setdefault(log_id, {"raw_text": raw_text, "created_at": created_at})

    # FTS + tags as fallback if no entity found
    if not scores:
        scores, meta = _fts_pass(con, result.keywords, scores, meta, limit)
        scores, meta = _tag_pass(con, result.tags, scores, meta)

    if result.date_range:
        scores, meta = _apply_date_filter(scores, meta, result.date_range, con, today)

    return _scores_to_logs(scores, meta, limit)


def handle_state_tracking(
    con: sqlite3.Connection, result: RouterResult, today: str, limit: int = 10
) -> list[dict]:
    """Todos, open loops, commitments, goal progress."""
    scores: dict[int, float] = {}
    meta: dict[int, dict] = {}

    # Pull open todos, optionally filtered by entity or keywords
    entity_ids = [
        _fuzzy_match_entity(con, name)
        for name in result.entity_names
    ]
    entity_ids = [e for e in entity_ids if e is not None]

    if entity_ids:
        placeholders = ",".join("?" * len(entity_ids))
        rows = con.execute(f"""
            SELECT DISTINCT l.id, l.raw_text, l.created_at
            FROM Todo t
            JOIN Log l ON l.id = t.log_id
            LEFT JOIN EntityReference er ON er.log_id = l.id
            WHERE t.status IN ('pending', 'in_progress')
              AND er.entity_id IN ({placeholders})
            ORDER BY l.created_at DESC
            LIMIT ?
        """, (*entity_ids, limit)).fetchall()
    else:
        rows = con.execute("""
            SELECT DISTINCT l.id, l.raw_text, l.created_at
            FROM Todo t
            JOIN Log l ON l.id = t.log_id
            WHERE t.status IN ('pending', 'in_progress')
            ORDER BY l.created_at DESC
            LIMIT ?
        """, (limit,)).fetchall()

    for log_id, raw_text, created_at in rows:
        scores[log_id] = 2.0
        meta[log_id] = {"raw_text": raw_text, "created_at": created_at}

    # Supplement with FTS if we have keywords
    if result.keywords:
        scores, meta = _fts_pass(con, result.keywords, scores, meta, limit)

    return _scores_to_logs(scores, meta, limit)


def handle_narrative(
    con: sqlite3.Connection, result: RouterResult, today: str, limit: int = 10
) -> list[dict]:
    """Broad period summary or life area synthesis."""
    scores: dict[int, float] = {}
    meta: dict[int, dict] = {}

    for name in result.entity_names:
        entity_id = _fuzzy_match_entity(con, name)
        if entity_id is None:
            continue
        for log_id, raw_text, created_at, confidence in _logs_for_entity(con, entity_id):
            scores[log_id] = scores.get(log_id, 0.0) + 2.0 * (confidence or 0.8)
            meta.setdefault(log_id, {"raw_text": raw_text, "created_at": created_at})

    scores, meta = _fts_pass(con, result.keywords, scores, meta, limit)
    scores, meta = _tag_pass(con, result.tags, scores, meta)

    if result.date_range:
        scores, meta = _apply_date_filter(scores, meta, result.date_range, con, today)

    return _scores_to_logs(scores, meta, limit)


def handle_fallback(
    con: sqlite3.Connection, result: RouterResult, today: str, limit: int = 10
) -> list[dict]:
    """
    Fallback for unimplemented engines (pattern_mining, comparative,
    semantic_similar, correlation). Uses full entity + FTS + tag pipeline.
    """
    scores: dict[int, float] = {}
    meta: dict[int, dict] = {}

    for name in result.entity_names:
        entity_id = _fuzzy_match_entity(con, name)
        if entity_id is None:
            continue
        for log_id, raw_text, created_at, confidence in _logs_for_entity(con, entity_id):
            scores[log_id] = scores.get(log_id, 0.0) + 3.0 * (confidence or 0.8)
            meta.setdefault(log_id, {"raw_text": raw_text, "created_at": created_at})

    scores, meta = _fts_pass(con, result.keywords, scores, meta, limit)
    scores, meta = _tag_pass(con, result.tags, scores, meta)

    if result.date_range:
        scores, meta = _apply_date_filter(scores, meta, result.date_range, con, today)

    return _scores_to_logs(scores, meta, limit)


# ---------------------------------------------------------------------------
# Stage 2: dispatch
# ---------------------------------------------------------------------------

_HANDLERS = {
    "lookup":          handle_lookup,
    "timeline":        handle_timeline,
    "aggregation":     handle_aggregation,
    "entity_centric":  handle_entity_centric,
    "state_tracking":  handle_state_tracking,
    "narrative":       handle_narrative,
    # Stubs — fall back to general retrieval
    "pattern_mining":  handle_fallback,
    "comparative":     handle_fallback,
    "semantic_similar":handle_fallback,
    "correlation":     handle_fallback,
}


def dispatch(
    con: sqlite3.Connection, result: RouterResult, today: str, limit: int = 10
) -> list[dict]:
    handler = _HANDLERS.get(result.engine, handle_fallback)
    return handler(con, result, today, limit)


# ---------------------------------------------------------------------------
# Stage 3: synthesize_answer
# ---------------------------------------------------------------------------

_SYNTH_SYSTEM = """\
You are a helpful assistant answering questions about someone's personal log notes.

Answer ONLY based on the log excerpts provided. Do not add information not found in the logs. \
If the logs don't contain enough to answer the question, say so briefly.

Query type: {engine}
Keep your answer to 2-3 sentences. Be specific — reference details and dates from the logs when helpful."""


def synthesize_answer(
    client: OpenAI,
    question: str,
    logs: list[dict],
    engine: str = "narrative",
) -> Optional[str]:
    if not logs:
        return None
    excerpts = []
    for log in logs[:8]:
        date_str = log["created_at"][:10]
        excerpts.append(f"[{date_str}] {log['raw_text'][:500]}")
    context = "\n\n".join(excerpts)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": _SYNTH_SYSTEM.format(engine=engine)},
            {"role": "user", "content": f"Question: {question}\n\nLog excerpts:\n{context}"},
        ],
        max_tokens=150,
        temperature=0.3,
    )
    answer = resp.choices[0].message.content.strip()
    return answer or None
