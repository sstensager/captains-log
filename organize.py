"""
AI task organizer — consolidates scattered todos into grouped sections.

One gpt-4o-mini structured output call per request (~$0.0001).
"""
import datetime
from typing import Optional

from openai import OpenAI
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------

class OrgSection(BaseModel):
    label: str
    description: str
    task_ids: list[int]


class OrgResult(BaseModel):
    title: str
    description: str
    sections: list[OrgSection]


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

_SYSTEM = """\
You are organizing a personal task list pulled from scattered notes.

Group the tasks into logical sections. For a shopping list, bias similar \
items together (produce, dairy, household, etc.). For a camping/travel list, \
group by activity or timing. For a general list, group by theme.

Rules:
- Every task_id in the input MUST appear in exactly one section. Do not drop any.
- 2–6 sections is ideal. Don't over-fragment.
- Each section gets a short label (2–4 words) and a one-sentence description \
  explaining what ties the items together.
- The top-level title should be a short, natural name for this list \
  (e.g. "Costco Run", "Camping Prep", "House Projects").
- The top-level description should be 1 sentence summarizing the list \
  (e.g. "8 open items from 5 notes over the past month").
"""


def organize_tasks(
    client: OpenAI,
    filter_label: str,
    tasks: list[dict],
) -> OrgResult:
    """
    tasks: list of {id, title, age, preview} dicts.
    filter_label: human-readable context, e.g. "Costco" or "tag: groceries".
    Returns OrgResult with title, description, and sections.
    """
    if not tasks:
        return OrgResult(
            title=filter_label,
            description="No open tasks found.",
            sections=[],
        )

    task_lines = "\n".join(
        f"[ID {t['id']}] {t['title']}"
        + (f" (added {t['age']})" if t.get("age") else "")
        + (f" — from: {t['preview']}" if t.get("preview") else "")
        for t in tasks
    )

    user_content = f"Filter context: {filter_label}\n\nTasks:\n{task_lines}"

    response = client.beta.chat.completions.parse(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": user_content},
        ],
        response_format=OrgResult,
        temperature=0.3,
    )

    return response.choices[0].message.parsed


def _task_age(created_at: str) -> str:
    """Return a human-readable age string like '3 wk ago' or '2 mo ago'."""
    try:
        dt = datetime.datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        days = (datetime.datetime.now(datetime.timezone.utc) - dt).days
        if days < 1:
            return "today"
        if days == 1:
            return "1 day ago"
        if days < 14:
            return f"{days} days ago"
        if days < 60:
            return f"{days // 7} wk ago"
        return f"{days // 30} mo ago"
    except Exception:
        return ""
