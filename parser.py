import datetime
import json
import os
import sqlite3

from dotenv import load_dotenv
from openai import OpenAI

try:
    from config import USER_NAME
except ImportError:
    USER_NAME = os.environ.get("USER_NAME", "Steve")
from db import insert_log, insert_annotations
from schema import ParseResult

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

PARSER_MODEL   = "gpt-4o-mini"
PARSER_VERSION = "v2.0"


def create_and_parse_log(
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
    rejected_names: list[str] | None = None,
    confirmed_names: list[str] | None = None,
) -> ParseResult:
    """
    Run the parser against an already-inserted log row.
    Use this when the log was saved by other means (e.g. the API).
    Returns the ParseResult.

    rejected_names  — entity names the user has dismissed; LLM should skip them.
    confirmed_names — names already handled via [[]] links; LLM should skip them.
    """
    current_date = datetime.date.today().isoformat()

    messages = [
        {"role": "system", "content": _build_system_prompt(current_date)},
    ]
    if rejected_names or confirmed_names:
        context_lines = []
        if confirmed_names:
            context_lines.append(
                "Already linked (skip these, do not re-tag): "
                + ", ".join(f'"{n}"' for n in confirmed_names)
            )
        if rejected_names:
            context_lines.append(
                "Previously rejected by user (do not tag): "
                + ", ".join(f'"{n}"' for n in rejected_names)
            )
        messages.append({"role": "system", "content": "\n".join(context_lines)})

    messages.append({"role": "user", "content": raw_text})

    response = client.beta.chat.completions.parse(
        model=PARSER_MODEL,
        messages=messages,
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
    return f"""You are a personal log annotator. Extract every named entity mentioned \
in the note.

Today's date: {current_date}
Narrator: All entries are written by {USER_NAME}. "I", "me", "my", "we" = {USER_NAME}.

━━━ MENTIONS ━━━
Return one mention per named entity you can identify.

For each mention:
  text             — exact text as it appears in the note (used for highlighting)
  candidate_type   — one of the 7 types below
  canonical_name_guess — your best guess at the stable/full name
                         (e.g. "Jen" → "Jennifer", "Lucio's" → "Lucio's")
  confidence       — 0.0–1.0 (see rules below)

━━━ ENTITY TYPES ━━━

candidate_person — any human being named or clearly referred to
  e.g. "He" when only one man is mentioned → include at 0.75
  e.g. "He" when multiple men mentioned → omit or include at 0.30
  Do NOT include {USER_NAME} — the narrator is always implied.

candidate_place — any named location: restaurants, parks, cities, campgrounds, stores, venues
  Include informal names ("Lucio's", "the cabin", "LAX").
  Include store/place names used as list headers ("Costco extras:", "Target run").
  The test: would this name appear on a sign, map, or receipt? If yes, include it.
  Do NOT include generic descriptions ("the playground", "a restaurant", "home", "the office").

candidate_pet — any named animal belonging to or known by the narrator
  e.g. "Biscuit", "our dog Max", "the neighbor's cat Whiskers"

candidate_organization — companies, brands, institutions, teams, clubs
  e.g. "SyFy", "Kaiser", "the HOA", "the PTA", "Apple"
  Do NOT double-count: if Costco is already a place, don't also add it as an organization.
  Use place for physical locations you visit; use organization for companies you refer to abstractly.

candidate_event — named or recurring events with a distinct identity
  e.g. "Thanksgiving", "Face Off wrap party", "the Hendersons' annual BBQ", "our trip to Ojai"
  Do NOT include vague time references ("last week", "the other day").

candidate_thing — specific physical objects worth remembering
  e.g. "Mom's china", "the blue Le Creuset", "the Dyson", "my old Patagonia jacket"
  Must be specific enough to be uniquely identifiable. Not "a knife" — "the chef's knife we got in Japan".

candidate_idea — named concepts, plans, or recurring themes the narrator tracks
  e.g. "the bullet-based note structure", "the Synology server plan", "the kitchen remodel idea"
  High bar: must be something the narrator would want to look up later by name.

━━━ CONFIDENCE RULES ━━━
  0.85–0.95  clearly and directly stated
  0.65–0.80  stated but informal or paraphrased
  0.50–0.65  second-hand ("he said", "she told me", "I heard")
  0.30–0.50  speculative or uncertain ("I think", "might", "maybe")
  Never output 1.0 — nothing in a casual note is certain.

When uncertain between two types, pick the most specific one. When genuinely ambiguous, \
prefer lower confidence over wrong type.

━━━ TAGS ━━━
Return 1–4 lowercase tags describing what this note is about.
Focus on the activity or subject, not the people or places involved.
Examples: travel, family, health, food, shopping, work, kids, social, finance, home, memory, planning
Be consistent — notes about the same kind of thing should share tags.

Leave annotations as an empty list []."""
