"""
Natural Language Query (NLQ) for Captain's Log.

Pipeline: parse_query → retrieve_for_query → synthesize_answer

Two gpt-4o-mini calls per query (~$0.0001 each).
"""
import json
import sqlite3
from typing import Optional

from openai import OpenAI
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# QueryPlan
# ---------------------------------------------------------------------------

class DateRange(BaseModel):
    start: str  # "YYYY-MM-DD"
    end: str    # "YYYY-MM-DD"


class QueryPlan(BaseModel):
    entity_names: list[str]
    date_range: Optional[DateRange]
    keywords: list[str]
    tags: list[str]
    intent: str


# ---------------------------------------------------------------------------
# Stage 1: parse_query
# ---------------------------------------------------------------------------

_PARSE_SYSTEM = """\
You are a query parser for a personal log system. Extract a structured query plan from the user's question.

Return JSON with these fields:
- entity_names: list of proper nouns (people, places, things) that should be looked up in an entity index. Empty list if none.
- date_range: null OR {{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}}. Only set for explicit time windows ("last month", "in March", "this week", named holidays). Do NOT set for "last time" or "most recent" — those are handled by sort order.
- keywords: list of content keywords for full-text search. IMPORTANT: always include event/holiday names in keywords even if they also appear in date_range (e.g. "Juneteenth" → keywords=["Juneteenth"], "4th of July" → keywords=["July"], "Christmas" → keywords=["Christmas"]). Skip generic stop words but keep meaningful nouns.
- tags: list of relevant topic tags from this vocabulary: restaurants, cooking, coffee, bars, wine, groceries, food, camping, hiking, road-trips, hotels, flights, travel, family, friends, kids, dates, social, fitness, medical, sleep, wellness, health, renovation, repairs, garden, chores, errands, home, meetings, projects, decisions, work, expenses, budget, investments, taxes, finance, movies, books, music, tv, sports, games, ideas, research, learning, planning, milestone, reflection, memory, shopping. Empty list if none apply.
- intent: one short sentence describing what the user wants to know.

Today's date: {today}"""


def parse_query(client: OpenAI, question: str, today: str) -> QueryPlan:
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _PARSE_SYSTEM.format(today=today)},
            {"role": "user", "content": question},
        ],
        max_tokens=300,
        temperature=0,
    )
    data = json.loads(resp.choices[0].message.content)
    return QueryPlan(
        entity_names=data.get("entity_names", []),
        date_range=DateRange(**data["date_range"]) if data.get("date_range") else None,
        keywords=data.get("keywords", []),
        tags=data.get("tags", []),
        intent=data.get("intent", ""),
    )


# ---------------------------------------------------------------------------
# Stage 2: retrieve_for_query
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


def retrieve_for_query(
    con: sqlite3.Connection,
    plan: QueryPlan,
    limit: int = 10,
    today: str = "",
) -> list[dict]:
    """
    Multi-pass retrieval:
      1. Entity index: logs mentioning plan.entity_names (+3.0 * confidence)
      2. FTS keywords: normalized score added
      3. Date hard-filter: drop logs outside plan.date_range (also checks date_ref annotations)
      4. Tag soft-boost: +0.5 for logs whose tags overlap plan.tags
    Returns list sorted by score descending.
    """
    from datetime import date as _date
    from retrieval import _sanitize_fts_query

    if not today:
        today = _date.today().isoformat()

    scores: dict[int, float] = {}
    meta: dict[int, dict] = {}

    # Pass 1 — entity index
    for name in plan.entity_names:
        entity_id = _fuzzy_match_entity(con, name)
        if entity_id is None:
            continue
        rows = con.execute("""
            SELECT er.log_id, l.raw_text, l.created_at, er.confidence
            FROM EntityReference er
            JOIN Log l ON l.id = er.log_id
            WHERE er.entity_id = ?
        """, (entity_id,)).fetchall()
        for log_id, raw_text, created_at, confidence in rows:
            scores[log_id] = scores.get(log_id, 0.0) + 3.0 * (confidence or 0.8)
            meta.setdefault(log_id, {"raw_text": raw_text, "created_at": created_at})

    # Pass 2 — FTS keywords (stop words removed to avoid FTS5 AND poisoning)
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
    filtered_keywords = [k for k in plan.keywords if k.lower() not in _STOP_WORDS]
    if filtered_keywords:
        fts_query = " ".join(_sanitize_fts_query(k) for k in filtered_keywords if k.strip())
        if fts_query.strip():
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

    # Pass 3 — date hard-filter (skip for future dates — those are planning queries about an event)
    if plan.date_range and plan.date_range.start <= today:
        start = plan.date_range.start
        end = plan.date_range.end + "T23:59:59"
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
        scores = {k: v for k, v in scores.items() if k in keep}
        meta   = {k: v for k, v in meta.items()   if k in keep}

    # Pass 4 — tag soft-boost (for already-scored logs)
    if plan.tags and scores:
        for log_id in scores:
            row = con.execute("SELECT tags FROM Log WHERE id = ?", (log_id,)).fetchone()
            if row:
                log_tags = json.loads(row[0] or "[]")
                if any(t in log_tags for t in plan.tags):
                    scores[log_id] += 0.5

    # Pass 5 — tag primary fallback (when no other signal found)
    if plan.tags and not scores:
        rows = con.execute("SELECT id, raw_text, created_at, tags FROM Log").fetchall()
        for log_id, raw_text, created_at, tags_json in rows:
            log_tags = json.loads(tags_json or "[]")
            if any(t in log_tags for t in plan.tags):
                scores[log_id] = 1.0
                meta[log_id] = {"raw_text": raw_text, "created_at": created_at}

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
# Stage 3: synthesize_answer
# ---------------------------------------------------------------------------

_SYNTH_SYSTEM = """\
You are a helpful assistant answering questions about someone's personal log notes.

Answer ONLY based on the log excerpts provided. Do not add information not found in the logs. \
If the logs don't contain enough to answer the question, say so briefly.

Keep your answer to 2-3 sentences. Be specific — reference details and dates from the logs when helpful."""


def synthesize_answer(
    client: OpenAI,
    question: str,
    logs: list[dict],
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
            {"role": "system", "content": _SYNTH_SYSTEM},
            {"role": "user", "content": f"Question: {question}\n\nLog excerpts:\n{context}"},
        ],
        max_tokens=150,
        temperature=0.3,
    )
    answer = resp.choices[0].message.content.strip()
    return answer or None
