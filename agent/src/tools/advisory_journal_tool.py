from __future__ import annotations

import json
from typing import cast

from src.advisory import AdvisoryDecision, ApprovalState, DecisionJournal, JournalEntry
from src.agent.tools import BaseTool


def _error(msg: str) -> str:
    return json.dumps({"status": "error", "error": msg}, ensure_ascii=False)


def _entry_to_dict(entry: JournalEntry) -> dict[str, object]:
    return entry.to_dict()


def _load_journal(payload: object) -> DecisionJournal:
    if not isinstance(payload, dict):
        raise ValueError("journal payload must be a mapping")

    raw_entries = cast(dict[str, object], payload).get("entries")
    if not isinstance(raw_entries, list):
        raise ValueError("journal.entries must be a list")

    journal = DecisionJournal()
    for raw_entry in cast(list[object], raw_entries):
        if not isinstance(raw_entry, dict):
            raise ValueError("journal entries must be mappings")
        entry = cast(dict[str, object], raw_entry)
        decision = AdvisoryDecision.from_dict(entry.get("decision"))
        approval = ApprovalState.from_dict(entry.get("approval"))
        _ = journal.append(decision, approval=approval)
    return journal


def _parse_limit(value: object) -> int:
    if isinstance(value, bool):
        raise ValueError("limit must be an integer")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return int(value)
    raise ValueError("limit must be an integer")


class QueryAdvisoryJournalTool(BaseTool):
    name: str = "query_advisory_journal"
    description: str = (
        "Query a caller-supplied advisory-only decision journal payload. Stateless: "
        "does not read persisted storage, execute trades, or call broker/exchange APIs."
    )
    is_readonly: bool = True
    repeatable: bool = True
    parameters: dict[str, object] = {
        "type": "object",
        "properties": {
            "journal": {
                "type": "object",
                "description": "DecisionJournal.to_dict() payload to query.",
            },
            "action": {
                "type": "string",
                "enum": ["buy", "sell", "hold", "avoid"],
                "description": "Optional advisory action filter.",
            },
            "approval_status": {
                "type": "string",
                "enum": ["pending", "approved", "rejected", "expired"],
                "description": "Optional approval status filter.",
            },
            "limit": {
                "type": "integer",
                "minimum": 0,
                "description": "Optional maximum number of entries to return.",
            },
        },
        "required": ["journal"],
    }

    def execute(self, **kwargs: object) -> str:
        try:
            journal = _load_journal(kwargs.get("journal"))
            entries = journal.entries
            filters: dict[str, str] = {}

            action = str(kwargs.get("action") or "").strip().lower()
            if action:
                entries = tuple(entry for entry in entries if entry.decision.action == action)
                filters["action"] = action

            approval_status = str(kwargs.get("approval_status") or "").strip().lower()
            if approval_status:
                entries = tuple(entry for entry in entries if entry.approval.status == approval_status)
                filters["approval_status"] = approval_status

            raw_limit = kwargs.get("limit")
            if raw_limit is not None:
                limit = _parse_limit(raw_limit)
                if limit < 0:
                    raise ValueError("limit must be non-negative")
                entries = entries[:limit]
                filters["limit"] = str(limit)

            return json.dumps(
                {
                    "status": "ok",
                    "advisory_only": True,
                    "execution_performed": False,
                    "filters": filters,
                    "count": len(entries),
                    "stats": journal.stats().to_dict(),
                    "entries": [_entry_to_dict(entry) for entry in entries],
                },
                ensure_ascii=False,
            )
        except (ValueError, TypeError) as exc:
            return _error(str(exc))
