from __future__ import annotations

import json
from pathlib import Path

from src.advisory import AdvisoryJournalStore, JournalEntry
from src.agent.tools import BaseTool
from src.tools.path_utils import safe_user_path
from src.tools.redaction import redact_internal_paths


def _ok(entry: JournalEntry) -> str:
    return json.dumps(
        {
            "status": "ok",
            "advisory_only": True,
            "execution_performed": False,
            "decision_id": entry.decision.decision_id,
            "approval": entry.approval.to_dict(),
        },
        ensure_ascii=False,
    )


def _error(error: object) -> str:
    return json.dumps({"status": "error", "error": redact_internal_paths(error)}, ensure_ascii=False)


def _journal_path(raw: object) -> Path:
    path_text = str(raw or "")
    if not path_text:
        raise ValueError("journal_path is required")
    path = safe_user_path(path_text)
    if not path.is_file():
        raise ValueError("advisory journal file not found")
    return path


class ApprovePersistedAdvisoryDecisionTool(BaseTool):
    name: str = "approve_persisted_advisory_decision"
    description: str = (
        "Approve a pending advisory-only decision in a persisted journal file. "
        "Does not execute trades or call broker/exchange APIs."
    )
    is_readonly: bool = False
    repeatable: bool = True
    parameters: dict[str, object] = {
        "type": "object",
        "properties": {
            "journal_path": {"type": "string", "description": "Path to an allowed advisory journal JSON file."},
            "decision_id": {"type": "string", "description": "Decision ID to approve."},
            "reason": {"type": "string", "description": "Approval reason for audit trail."},
            "actor": {"type": "string", "description": "Human or system actor approving the decision."},
        },
        "required": ["journal_path", "decision_id", "reason", "actor"],
    }

    def execute(self, **kwargs: object) -> str:
        try:
            entry = AdvisoryJournalStore(_journal_path(kwargs.get("journal_path"))).approve(
                str(kwargs.get("decision_id") or ""),
                reason=str(kwargs.get("reason") or ""),
                actor=str(kwargs.get("actor") or ""),
            )
            return _ok(entry)
        except (ValueError, KeyError, OSError) as exc:
            return _error(exc)


class RejectPersistedAdvisoryDecisionTool(BaseTool):
    name: str = "reject_persisted_advisory_decision"
    description: str = (
        "Reject a pending advisory-only decision in a persisted journal file. "
        "Does not execute trades or call broker/exchange APIs."
    )
    is_readonly: bool = False
    repeatable: bool = True
    parameters: dict[str, object] = {
        "type": "object",
        "properties": {
            "journal_path": {"type": "string", "description": "Path to an allowed advisory journal JSON file."},
            "decision_id": {"type": "string", "description": "Decision ID to reject."},
            "reason": {"type": "string", "description": "Rejection reason for audit trail."},
            "actor": {"type": "string", "description": "Human or system actor rejecting the decision."},
        },
        "required": ["journal_path", "decision_id", "reason", "actor"],
    }

    def execute(self, **kwargs: object) -> str:
        try:
            entry = AdvisoryJournalStore(_journal_path(kwargs.get("journal_path"))).reject(
                str(kwargs.get("decision_id") or ""),
                reason=str(kwargs.get("reason") or ""),
                actor=str(kwargs.get("actor") or ""),
            )
            return _ok(entry)
        except (ValueError, KeyError, OSError) as exc:
            return _error(exc)
