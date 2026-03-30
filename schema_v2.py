from pydantic import BaseModel
from typing import Literal, Optional


# All valid annotation types produced by the single-pass parser.
ANNOTATION_TYPES = frozenset({
    "candidate_person",
    "candidate_place",
    "candidate_pet",
    "candidate_organization",
    "candidate_event",
    "candidate_thing",
    "candidate_idea",
})

MENTION_TYPES = frozenset({
    "candidate_person",
    "candidate_place",
    "candidate_pet",
    "candidate_organization",
    "candidate_event",
    "candidate_thing",
    "candidate_idea",
})


class Mention(BaseModel):
    """
    A named entity reference found in the note.
    text_span is the exact text as written — used for inline highlighting.
    canonical_name_guess is the model's best guess at a stable/full name.
    start_char / end_char are computed post-parse by resolving text_span against raw_text.
    """
    text: str                          # exact text as written in the note
    candidate_type: Literal[
        "candidate_person",
        "candidate_place",
        "candidate_pet",
        "candidate_organization",
        "candidate_event",
        "candidate_thing",
        "candidate_idea",
    ]
    canonical_name_guess: str          # best guess at canonical form
    confidence: float                  # 0.0–1.0
    start_char: Optional[int] = None   # populated by _resolve_spans(), not the LLM
    end_char: Optional[int] = None     # populated by _resolve_spans(), not the LLM


class AnnotationOutput(BaseModel):
    """
    A semantic observation about the note.
    text_span is the exact supporting text — used for highlighting and excerpts.
    value is the normalized form (ISO date, task title, relationship description, etc.).
    start_char / end_char computed post-parse.
    """
    type: str                          # candidate_task | candidate_date | ...
    text_span: str                     # exact text from the note supporting this annotation
    value: Optional[str] = None        # normalized form — see parser prompt for per-type rules
    confidence: float                  # 0.0–1.0
    start_char: Optional[int] = None   # populated by _resolve_spans(), not the LLM
    end_char: Optional[int] = None     # populated by _resolve_spans(), not the LLM


class ParseResult(BaseModel):
    """
    Full output of a single parser pass on one log entry.
    mentions: people and places referenced in the note.
    tags: 1-4 lowercase labels describing what the note is about.
    """
    mentions: list[Mention]
    tags: list[str] = []
    annotations: list[AnnotationOutput] = []  # unused — kept for schema compatibility
