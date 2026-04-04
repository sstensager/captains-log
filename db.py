import os
import sqlite3

try:
    from config import DB_PATH as _CONFIG_DB_PATH
except ImportError:
    _CONFIG_DB_PATH = os.environ.get("DB_PATH", "data/captain_log.db")

# The on-disk database file (kept as _v2 suffix to match existing data)
DB_PATH = _CONFIG_DB_PATH.replace(".db", "_v2.db")

DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS Log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_text    TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT,
    source_type TEXT    NOT NULL DEFAULT 'text',
    tags        TEXT    NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS Annotation (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id          INTEGER NOT NULL REFERENCES Log(id) ON DELETE CASCADE,
    type            TEXT    NOT NULL,
    start_char      INTEGER,
    end_char        INTEGER,
    text_span       TEXT,
    value           TEXT,
    confidence      REAL,
    status          TEXT    NOT NULL DEFAULT 'suggested',
    corrected_value TEXT,
    provenance      TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_annotation_log_id ON Annotation(log_id);
CREATE INDEX IF NOT EXISTS idx_annotation_type   ON Annotation(type);
CREATE INDEX IF NOT EXISTS idx_annotation_status ON Annotation(status);

CREATE TABLE IF NOT EXISTS Entity (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name      TEXT    NOT NULL,
    entity_type         TEXT    NOT NULL,
    status              TEXT    NOT NULL DEFAULT 'tentative',  -- tentative|stable|merged
    merged_into_id      INTEGER REFERENCES Entity(id),
    created_from_log_id INTEGER REFERENCES Log(id),
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entity_name ON Entity(LOWER(canonical_name));
CREATE INDEX IF NOT EXISTS idx_entity_type ON Entity(entity_type);

CREATE TABLE IF NOT EXISTS EntityReference (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id     INTEGER NOT NULL REFERENCES Entity(id) ON DELETE CASCADE,
    log_id        INTEGER NOT NULL REFERENCES Log(id)    ON DELETE CASCADE,
    annotation_id INTEGER REFERENCES Annotation(id),
    excerpt       TEXT,    -- sentence-level clip from the log (key display primitive)
    confidence    REAL,
    role          TEXT,    -- subject|mentioned|location|etc.
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entityref_entity_id ON EntityReference(entity_id);
CREATE INDEX IF NOT EXISTS idx_entityref_log_id    ON EntityReference(log_id);

CREATE TABLE IF NOT EXISTS Task (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    task_type     TEXT    NOT NULL DEFAULT 'task',
    status        TEXT    NOT NULL DEFAULT 'todo',  -- user-defined; see config.TASK_STATUSES
    source_log_id INTEGER REFERENCES Log(id),
    annotation_id INTEGER REFERENCES Annotation(id),
    due_date      TEXT,    -- ISO 8601 or NULL
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_status ON Task(status);

CREATE TABLE IF NOT EXISTS EntityRelationship (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_a_id   INTEGER NOT NULL REFERENCES Entity(id),
    label         TEXT    NOT NULL,  -- free-text, no canonical constraints
    entity_b_id   INTEGER NOT NULL REFERENCES Entity(id),
    source_log_id INTEGER REFERENCES Log(id),
    annotation_id INTEGER REFERENCES Annotation(id),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entityrel_a ON EntityRelationship(entity_a_id);
CREATE INDEX IF NOT EXISTS idx_entityrel_b ON EntityRelationship(entity_b_id);

CREATE TABLE IF NOT EXISTS Attribute (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id     INTEGER NOT NULL REFERENCES Entity(id) ON DELETE CASCADE,
    attr_type     TEXT    NOT NULL DEFAULT 'fact',  -- 'rating' | 'age' | 'fact'
    key           TEXT    NOT NULL,
    value         TEXT    NOT NULL,
    corrected_value TEXT,
    source_log_id INTEGER REFERENCES Log(id),
    annotation_id INTEGER REFERENCES Annotation(id),
    confidence    REAL,
    provenance    TEXT,   -- 'user' | 'auto:candidate_age' | 'auto:candidate_rating' | 'llm:excerpt_extraction/v1'
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attribute_entity_id ON Attribute(entity_id);
CREATE INDEX IF NOT EXISTS idx_attribute_key       ON Attribute(key);

CREATE VIRTUAL TABLE IF NOT EXISTS Log_fts USING fts5(raw_text, tokenize='porter ascii');

CREATE TABLE IF NOT EXISTS LogEmbedding (
    log_id     INTEGER PRIMARY KEY REFERENCES Log(id) ON DELETE CASCADE,
    embedding  BLOB    NOT NULL,
    model      TEXT    NOT NULL DEFAULT 'text-embedding-3-small',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
"""


def _run_migrations(con: sqlite3.Connection) -> None:
    """Apply additive schema changes to existing databases. Safe to re-run."""
    migrations = [
        "ALTER TABLE Entity ADD COLUMN user_notes TEXT",
        "ALTER TABLE EntityRelationship ADD COLUMN confirmed INTEGER DEFAULT 0",
        "ALTER TABLE EntityRelationship ADD COLUMN corrected_label TEXT",
        "ALTER TABLE Attribute ADD COLUMN attr_type TEXT NOT NULL DEFAULT 'fact'",
        "ALTER TABLE Task ADD COLUMN task_type TEXT NOT NULL DEFAULT 'task'",
        "ALTER TABLE Log ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'",
        "ALTER TABLE Task ADD COLUMN indent INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE Task ADD COLUMN section TEXT",
        "ALTER TABLE Log ADD COLUMN updated_at TEXT",
    ]
    for sql in migrations:
        try:
            con.execute(sql)
            con.commit()
        except sqlite3.OperationalError:
            pass  # column already exists


def init_db() -> sqlite3.Connection:
    """Create tables and return an open connection. Safe to call repeatedly."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(DB_SCHEMA)
    con.commit()
    _run_migrations(con)
    return con


def insert_log(con: sqlite3.Connection, raw_text: str, source_type: str = "text") -> int:
    """Write a new log entry. Returns the new log_id."""
    cur = con.execute(
        "INSERT INTO Log (raw_text, source_type) VALUES (?, ?)",
        (raw_text, source_type),
    )
    log_id = cur.lastrowid
    con.execute("INSERT INTO Log_fts(rowid, raw_text) VALUES (?, ?)", (log_id, raw_text))
    con.commit()
    return log_id


def rebuild_fts(con: sqlite3.Connection) -> int:
    """Rebuild the FTS index from all existing Log rows. Returns count of rows indexed."""
    con.execute("DELETE FROM Log_fts")
    rows = con.execute("SELECT id, raw_text FROM Log").fetchall()
    for log_id, raw_text in rows:
        con.execute("INSERT INTO Log_fts(rowid, raw_text) VALUES (?, ?)", (log_id, raw_text))
    con.commit()
    return len(rows)


def store_embedding(con: sqlite3.Connection, log_id: int, embedding: list[float], model: str) -> None:
    """Serialize and store an embedding vector for a log entry."""
    import struct
    blob = struct.pack(f"{len(embedding)}f", *embedding)
    con.execute(
        "INSERT OR REPLACE INTO LogEmbedding (log_id, embedding, model) VALUES (?, ?, ?)",
        (log_id, blob, model),
    )
    con.commit()


def get_logs_without_embeddings(con: sqlite3.Connection) -> list[tuple]:
    """Return (log_id, raw_text) for logs that don't yet have embeddings."""
    return con.execute("""
        SELECT l.id, l.raw_text FROM Log l
        LEFT JOIN LogEmbedding e ON e.log_id = l.id
        WHERE e.log_id IS NULL
        ORDER BY l.id
    """).fetchall()


def load_all_embeddings(con: sqlite3.Connection) -> list[tuple]:
    """Return (log_id, raw_text, created_at, embedding_bytes) for all logs with embeddings."""
    return con.execute("""
        SELECT l.id, l.raw_text, l.created_at, e.embedding
        FROM LogEmbedding e
        JOIN Log l ON l.id = e.log_id
        ORDER BY l.id
    """).fetchall()


def insert_annotations(
    con: sqlite3.Connection,
    log_id: int,
    parse_result,        # ParseResult — avoid circular import
    provenance: str,
) -> int:
    """
    Write mentions and annotations from a ParseResult to the Annotation table.
    Returns count of rows written.
    """
    written = 0

    for m in parse_result.mentions:
        con.execute(
            """INSERT INTO Annotation
               (log_id, type, start_char, end_char, text_span, value, confidence, provenance)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (log_id, m.candidate_type, m.start_char, m.end_char,
             m.text, m.canonical_name_guess, m.confidence, provenance),
        )
        written += 1

    for a in parse_result.annotations:
        con.execute(
            """INSERT INTO Annotation
               (log_id, type, start_char, end_char, text_span, value, confidence, provenance)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (log_id, a.type, a.start_char, a.end_char,
             a.text_span, a.value, a.confidence, provenance),
        )
        written += 1

    con.commit()
    return written


def get_attributes(con: sqlite3.Connection, entity_id: int) -> list[tuple]:
    """Return all attributes for an entity, preferring corrected_value when present.
    Rows: (id, attr_type, key, display_value, confidence, provenance, source_log_id)
    """
    return con.execute("""
        SELECT id, attr_type, key, COALESCE(corrected_value, value) as display_value,
               confidence, provenance, source_log_id
        FROM Attribute
        WHERE entity_id = ?
        ORDER BY attr_type, key, created_at
    """, (entity_id,)).fetchall()


def set_attribute(
    con: sqlite3.Connection,
    entity_id: int,
    key: str,
    value: str,
    attr_type: str = "fact",
    provenance: str = "user",
    confidence: float | None = None,
    source_log_id: int | None = None,
    annotation_id: int | None = None,
) -> int:
    """
    Upsert an attribute by (entity_id, key, provenance).
    For 'user' provenance, updates corrected_value on existing rows.
    Returns the attribute id.
    """
    if provenance == "user":
        existing = con.execute(
            "SELECT id FROM Attribute WHERE entity_id = ? AND key = ?",
            (entity_id, key),
        ).fetchone()
        if existing:
            con.execute(
                "UPDATE Attribute SET corrected_value = ?, updated_at = datetime('now') WHERE id = ?",
                (value, existing[0]),
            )
            con.commit()
            return existing[0]

    cur = con.execute(
        "INSERT INTO Attribute (entity_id, attr_type, key, value, confidence, provenance, source_log_id, annotation_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (entity_id, attr_type, key, value, confidence, provenance, source_log_id, annotation_id),
    )
    con.commit()
    return cur.lastrowid


def get_entity_page(con: sqlite3.Connection, entity_id: int) -> list[tuple]:
    """
    Entity page query: all logs that reference this entity, with excerpt and log text.
    Returns rows of (log_id, created_at, excerpt, confidence, role, raw_text).
    """
    return con.execute("""
        SELECT er.log_id, l.created_at, er.excerpt, er.confidence, er.role, l.raw_text
        FROM EntityReference er
        JOIN Log l ON l.id = er.log_id
        WHERE er.entity_id = ?
        ORDER BY l.created_at DESC
    """, (entity_id,)).fetchall()


def get_all_entities(con: sqlite3.Connection) -> list[tuple]:
    """Return all non-merged entities with their reference counts."""
    return con.execute("""
        SELECT e.id, e.canonical_name, e.entity_type, e.status,
               COUNT(er.id) as ref_count
        FROM Entity e
        LEFT JOIN EntityReference er ON er.entity_id = e.id
        WHERE e.merged_into_id IS NULL
        GROUP BY e.id
        ORDER BY ref_count DESC, e.canonical_name
    """).fetchall()


def get_entity_relationships(con: sqlite3.Connection, entity_id: int) -> list[tuple]:
    """Return all relationships involving entity_id, with resolved names."""
    return con.execute("""
        SELECT er.id, ea.canonical_name, er.label, eb.canonical_name, er.source_log_id
        FROM EntityRelationship er
        JOIN Entity ea ON ea.id = er.entity_a_id
        JOIN Entity eb ON eb.id = er.entity_b_id
        WHERE er.entity_a_id = ? OR er.entity_b_id = ?
        ORDER BY er.created_at
    """, (entity_id, entity_id)).fetchall()
