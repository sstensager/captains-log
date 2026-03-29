import datetime
import os
import sqlite3

from dotenv import load_dotenv
from openai import OpenAI

from config import USER_NAME
import json
from db_v2 import insert_log, insert_annotations
from schema_v2 import ParseResult

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

PARSER_MODEL   = "gpt-4o-mini"
PARSER_VERSION = "v2.0"


def parse_log(
    raw_text: str,
    con: sqlite3.Connection,
    source_type: str = "text",
) -> tuple[int, ParseResult]:
    """
    Save a log entry and run the single-pass parser.

    The log is written to the DB before the LLM call — a failed or slow
    parse never loses a note. Returns (log_id, parse_result).
    """
    current_date = datetime.date.today().isoformat()

    log_id = insert_log(con, raw_text, source_type)

    response = client.beta.chat.completions.parse(
        model=PARSER_MODEL,
        messages=[
            {"role": "system", "content": _build_system_prompt(current_date)},
            {"role": "user",   "content": raw_text},
        ],
        response_format=ParseResult,
    )

    result = response.choices[0].message.parsed

    _resolve_spans(raw_text, result)
    insert_annotations(con, log_id, result, provenance=f"{PARSER_MODEL}/{PARSER_VERSION}")
    _save_tags(con, log_id, result.tags)

    return log_id, result


def annotate_log(
    log_id: int,
    raw_text: str,
    con: sqlite3.Connection,
    source_type: str = "text",
) -> ParseResult:
    """
    Run the parser against an already-inserted log row.
    Use this when the log was saved by other means (e.g. the API).
    Returns the ParseResult.
    """
    current_date = datetime.date.today().isoformat()

    response = client.beta.chat.completions.parse(
        model=PARSER_MODEL,
        messages=[
            {"role": "system", "content": _build_system_prompt(current_date)},
            {"role": "user",   "content": raw_text},
        ],
        response_format=ParseResult,
    )

    result = response.choices[0].message.parsed
    _resolve_spans(raw_text, result)
    insert_annotations(con, log_id, result, provenance=f"{PARSER_MODEL}/{PARSER_VERSION}")
    _save_tags(con, log_id, result.tags)
    return result


def _save_tags(con, log_id: int, tags: list[str]) -> None:
    clean = [t.strip().lower() for t in tags if t.strip()]
    con.execute("UPDATE Log SET tags = ? WHERE id = ?", (json.dumps(clean), log_id))
    con.commit()


def _resolve_spans(raw_text: str, result: ParseResult) -> None:
    """
    Compute start_char / end_char by finding each text_span in raw_text.
    Modifies the ParseResult in place. The LLM returns the text but not
    the offsets — computing offsets here is more reliable than asking the
    model to count characters.
    """
    raw_lower = raw_text.lower()

    for mention in result.mentions:
        idx = raw_lower.find(mention.text.lower())
        if idx != -1:
            mention.start_char = idx
            mention.end_char   = idx + len(mention.text)

    for annotation in result.annotations:
        if annotation.text_span:
            idx = raw_lower.find(annotation.text_span.lower())
            if idx != -1:
                annotation.start_char = idx
                annotation.end_char   = idx + len(annotation.text_span)


def _build_system_prompt(current_date: str) -> str:
    return f"""You are a personal log annotator. Extract every person and place mentioned \
in the note — nothing else.

Today's date: {current_date}
Narrator: All entries are written by {USER_NAME}. "I", "me", "my", "we" = {USER_NAME}.

━━━ MENTIONS ━━━
Return one mention per named person or place you can identify.

For each mention:
  text             — exact text as it appears in the note (used for highlighting)
  candidate_type   — candidate_person OR candidate_place
  canonical_name_guess — your best guess at the stable/full name
                         (e.g. "Jen" → "Jennifer", "Lucio's" → "Lucio's")
  confidence       — 0.0–1.0 (see rules below)

PEOPLE: anyone named or clearly referred to by pronoun when the referent is unambiguous.
  e.g. "He" when only one man is mentioned → include at 0.75
  e.g. "He" when multiple men mentioned → omit or include at 0.30
  Do NOT include {USER_NAME} — the narrator is always implied.

PLACES: any named location — restaurants, parks, cities, campgrounds, stores, venues.
  Include informal names ("Lucio's", "the cabin", "LAX").
  Include store/place names used as list headers or labels ("Costco extras:", "Target run").
  The test: would this name appear on a sign, map, or receipt? If yes, extract it.
  Do NOT include generic descriptions without a proper name ("the playground", \
"a restaurant", "the lake", "home", "the office").

━━━ CONFIDENCE RULES ━━━
  0.85–0.95  clearly and directly stated
  0.65–0.80  stated but informal or paraphrased
  0.50–0.65  second-hand ("he said", "she told me", "I heard")
  0.30–0.50  speculative or uncertain ("I think", "might", "maybe")
  Never output 1.0 — nothing in a casual note is certain.

Confidence reflects certainty that the person/place is referenced — NOT certainty \
about facts attributed to them.

━━━ TAGS ━━━
Return 1–4 lowercase tags describing what this note is about.
Focus on the activity or subject, not the people or places involved.
Examples: travel, family, health, food, shopping, work, kids, social, finance, home, memory, planning
Be consistent — notes about the same kind of thing should share tags.

Leave annotations as an empty list []."""
