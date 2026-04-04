"""
Retrieval: FTS, semantic (embedding), and hybrid search over Log entries.

Three layers:
  fts_search      — keyword matching via SQLite FTS5 (porter stemming)
  semantic_search — cosine similarity over stored embeddings
  hybrid_search   — combines both; good default for product queries
  entity_search   — entity index path: all logs that mention a named entity
"""
import re
import struct
import sqlite3

from openai import OpenAI

EMBEDDING_MODEL = "text-embedding-3-small"


# ---------------------------------------------------------------------------
# Embedding helpers
# ---------------------------------------------------------------------------

def generate_embedding(client: OpenAI, text: str) -> list[float]:
    resp = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text.replace("\n", " "),
    )
    return resp.data[0].embedding


def embed_all_logs(con: sqlite3.Connection, client: OpenAI) -> int:
    """
    Generate and store embeddings for any logs that don't have one yet.
    Idempotent. Returns count of new embeddings created.
    """
    from db import get_logs_without_embeddings, store_embedding
    rows = get_logs_without_embeddings(con)
    for log_id, raw_text in rows:
        emb = generate_embedding(client, raw_text)
        store_embedding(con, log_id, emb, EMBEDDING_MODEL)
    return len(rows)


# ---------------------------------------------------------------------------
# FTS search
# ---------------------------------------------------------------------------

def _sanitize_fts_query(query: str) -> str:
    """
    Strip FTS5 special characters so natural-language queries don't error.
    Hyphens become spaces (avoid NOT operator), apostrophes/quotes removed.
    """
    cleaned = re.sub(r"[^\w\s]", " ", query)
    return " ".join(cleaned.split())


def fts_search(con: sqlite3.Connection, query: str, limit: int = 10) -> list[dict]:
    """
    Keyword search via FTS5. Uses porter stemming so 'camp' matches 'camping'.
    Sanitizes query to strip special chars (hyphens, apostrophes) that break FTS5 syntax.
    Returns list of result dicts sorted by relevance.
    """
    safe_query = _sanitize_fts_query(query)
    if not safe_query:
        return []
    try:
        rows = con.execute("""
            SELECT l.id, l.raw_text, l.created_at, rank
            FROM Log_fts
            JOIN Log l ON l.id = Log_fts.rowid
            WHERE Log_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        """, (safe_query, limit)).fetchall()
    except Exception:
        return []
    return [
        {"log_id": r[0], "raw_text": r[1], "created_at": r[2],
         "score": -r[3], "method": "fts"}
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Semantic search
# ---------------------------------------------------------------------------

def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na  = sum(x * x for x in a) ** 0.5
    nb  = sum(x * x for x in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


def semantic_search(
    con: sqlite3.Connection,
    query_embedding: list[float],
    limit: int = 10,
) -> list[dict]:
    """
    Cosine similarity search over all stored embeddings.
    Returns list of result dicts sorted by score descending.
    """
    from db import load_all_embeddings
    rows = load_all_embeddings(con)

    scored = []
    for log_id, raw_text, created_at, blob in rows:
        n   = len(blob) // 4
        emb = list(struct.unpack(f"{n}f", blob))
        score = _cosine(query_embedding, emb)
        scored.append({
            "log_id": log_id, "raw_text": raw_text, "created_at": created_at,
            "score": score, "method": "semantic",
        })

    scored.sort(key=lambda x: -x["score"])
    return scored[:limit]


# ---------------------------------------------------------------------------
# Hybrid search
# ---------------------------------------------------------------------------

def hybrid_search(
    con: sqlite3.Connection,
    query: str,
    client: OpenAI,
    limit: int = 5,
) -> list[dict]:
    """
    Combine FTS and semantic search. FTS handles keyword/name precision;
    semantic handles meaning and paraphrase. Results are merged and ranked
    by a weighted sum (40% FTS rank score, 60% semantic similarity).
    """
    fts_results = fts_search(con, query, limit=limit * 2)
    q_emb       = generate_embedding(client, query)
    sem_results = semantic_search(con, q_emb, limit=limit * 2)

    # Normalise FTS scores to [0,1]
    fts_scores = [r["score"] for r in fts_results]
    fts_max    = max(fts_scores, default=1.0) or 1.0
    fts_map    = {r["log_id"]: r["score"] / fts_max for r in fts_results}

    # Semantic scores are already cosine similarities ∈ [0,1]
    sem_map = {r["log_id"]: r["score"] for r in sem_results}

    all_ids = set(fts_map) | set(sem_map)
    merged  = []
    for lid in all_ids:
        f = fts_map.get(lid, 0.0)
        s = sem_map.get(lid, 0.0)
        method = "hybrid" if (f > 0 and s > 0) else ("fts" if f > 0 else "semantic")
        raw    = next(
            (r["raw_text"] for r in fts_results + sem_results if r["log_id"] == lid),
            "",
        )
        created_at = next(
            (r["created_at"] for r in fts_results + sem_results if r["log_id"] == lid),
            "",
        )
        merged.append({
            "log_id": lid, "raw_text": raw, "created_at": created_at,
            "score": 0.4 * f + 0.6 * s,
            "fts_score": f, "sem_score": s, "method": method,
        })

    merged.sort(key=lambda x: -x["score"])
    return merged[:limit]


# ---------------------------------------------------------------------------
# Entity index search
# ---------------------------------------------------------------------------

def entity_search(
    con: sqlite3.Connection,
    entity_name: str,
    entity_type: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """
    Return all logs that mention a named entity, with their excerpt.
    Uses the EntityReference layer — no LLM call needed.
    """
    from promote import find_entity

    etype = entity_type or "Person"
    entity_id = find_entity(con, entity_name, etype)
    if entity_id is None and entity_type is None:
        # Try other types
        for t in ("Place", "Organization", "Event"):
            entity_id = find_entity(con, entity_name, t)
            if entity_id is not None:
                break

    if entity_id is None:
        return []

    rows = con.execute("""
        SELECT er.log_id, l.raw_text, l.created_at, er.excerpt, er.confidence
        FROM EntityReference er
        JOIN Log l ON l.id = er.log_id
        WHERE er.entity_id = ?
        ORDER BY l.created_at DESC
        LIMIT ?
    """, (entity_id, limit)).fetchall()

    return [
        {"log_id": r[0], "raw_text": r[1], "created_at": r[2],
         "excerpt": r[3], "score": r[4] or 0.0, "method": "entity_index"}
        for r in rows
    ]
