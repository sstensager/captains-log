from pydantic import BaseModel
from typing import Literal, Optional


class Mention(BaseModel):
    """
    A named entity reference found in the note.
    text is the exact text as written — used for inline highlighting.
    canonical_name_guess is the model's best guess at a stable/full name.
    start_char / end_char are computed post-parse by resolving text against raw_text.
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
    A semantic observation about the note. Kept for ParseResult schema compatibility —
    the parser prompt instructs the model to always return an empty list for this field.
    """
    type: str
    text_span: str
    value: Optional[str] = None
    confidence: float
    start_char: Optional[int] = None
    end_char: Optional[int] = None


class ParseResult(BaseModel):
    """
    Full output of a single parser pass on one log entry.
    mentions: people and places referenced in the note.
    tags: 1-4 lowercase labels describing what the note is about.
    annotations: always empty — kept for LLM schema compatibility.
    """
    mentions: list[Mention]
    tags: list[str] = []
    annotations: list[AnnotationOutput] = []
