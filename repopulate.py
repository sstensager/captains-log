#!/usr/bin/env python3
"""
Wipe and rebuild the v2 DB from fixture notes.

Usage:
  python repopulate.py                                      # load fixtures/sample_notes.md
  python repopulate.py --source path/to/notes.md            # load a different file
  python repopulate.py --skip-embeddings                    # skip embedding generation
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
load_dotenv()

from db import DB_PATH, init_db, rebuild_fts
from parser import create_and_parse_log
from promote import extract_todos, promote_all_mentions


def load_fixture_notes(path: str = "fixtures/demo_notes.md") -> list[str]:
    raw = Path(path).read_text()
    if "# Suggested retrieval questions" in raw:
        raw = raw[: raw.index("# Suggested retrieval questions")]
    chunks = raw.split("\n---\n")
    notes = []
    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk.startswith("## Note"):
            continue
        lines = chunk.split("\n")
        content_start = 1
        if len(lines) > 1 and lines[1].startswith("Date:"):
            content_start = 3
        content = "\n".join(lines[content_start:]).strip()
        if content:
            notes.append(content)
    return notes


def main() -> None:
    parser = argparse.ArgumentParser(description="Repopulate the DB from fixture notes.")
    parser.add_argument(
        "--skip-embeddings", action="store_true",
        help="Skip embedding generation (faster dev runs)",
    )
    parser.add_argument(
        "--source", default="fixtures/demo_notes.md",
        help="Path to the notes file (default: fixtures/demo_notes.md)",
    )
    args = parser.parse_args()

    # Wipe existing DB
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"Deleted {DB_PATH}")

    con = init_db()
    print(f"Initialized fresh DB: {DB_PATH}\n")

    # Parse all fixture notes
    notes = load_fixture_notes(args.source)
    print(f"Parsing {len(notes)} fixture notes...")
    for i, text in enumerate(notes, 1):
        print(f"  [{i:02d}/{len(notes)}] ", end="", flush=True)
        log_id, result = create_and_parse_log(text, con)
        todos = extract_todos(log_id, text, con)
        print(f"log={log_id}  {len(result.mentions)} mentions  {todos['todos_created']} todos")

    # Rebuild FTS index
    fts_count = rebuild_fts(con)
    print(f"\nFTS index: {fts_count} logs indexed")

    # Promote mentions → Entity + EntityReference
    promo = promote_all_mentions(con, min_confidence=0.7)
    print(
        f"Entities:  {promo['entities_created']} created  "
        f"{promo['refs_created']} refs  "
        f"{promo['skipped']} skipped"
    )

    # Optionally generate embeddings
    if args.skip_embeddings:
        print("\nSkipping embeddings (--skip-embeddings)")
    else:
        from openai import OpenAI
        from retrieval import embed_all_logs
        client = OpenAI()
        print("\nGenerating embeddings...")
        new = embed_all_logs(con, client)
        print(f"Embeddings: {new} generated")

    # Summary
    log_count = con.execute("SELECT COUNT(*) FROM Log").fetchone()[0]
    ann_count = con.execute("SELECT COUNT(*) FROM Annotation").fetchone()[0]
    ent_count = con.execute("SELECT COUNT(*) FROM Entity").fetchone()[0]
    emb_count = con.execute("SELECT COUNT(*) FROM LogEmbedding").fetchone()[0]
    print(
        f"\nDone.\n"
        f"  Logs:        {log_count}\n"
        f"  Annotations: {ann_count}\n"
        f"  Entities:    {ent_count}\n"
        f"  Embeddings:  {emb_count}"
    )


if __name__ == "__main__":
    main()
