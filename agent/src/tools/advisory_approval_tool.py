from __future__ import annotations

import json

from src.advisory import ApprovalState
from src.agent.tools import BaseTool


def _ok(approval: ApprovalState) -> str:
    return json.dumps(
        {
            "status": "ok",
            "advisory_only": True,
            "execution_performed": False,
            "approval": approval.to_dict(),
        },
        ensure_ascii=False,
    )


def _error(msg: str) -> str:
    return json.dumps({"status": "error", "error": msg}, ensure_ascii=False)


class ApproveAdvisoryDecisionTool(BaseTool):
    name: str = "approve_advisory_decision"
    description: str = (
        "Approve a pending advisory-only decision approval state. Stateless: "
        "does not execute trades, persist records, or call broker/exchange APIs."
    )
    is_readonly: bool = False
    repeatable: bool = True
    parameters: dict[str, object] = {
        "type": "object",
        "properties": {
            "approval": {
                "type": "object",
                "description": "ApprovalState.to_dict() payload to transition from pending to approved.",
            },
            "reason": {"type": "string", "description": "Approval reason for audit trail."},
            "actor": {"type": "string", "description": "Human or system actor approving the decision."},
        },
        "required": ["approval", "reason", "actor"],
    }

    def execute(self, **kwargs: object) -> str:
        try:
            approval = ApprovalState.from_dict(kwargs.get("approval"))
            return _ok(approval.approve(reason=str(kwargs.get("reason") or ""), actor=str(kwargs.get("actor") or "")))
        except (ValueError, TypeError) as exc:
            return _error(str(exc))


class RejectAdvisoryDecisionTool(BaseTool):
    name: str = "reject_advisory_decision"
    description: str = (
        "Reject a pending advisory-only decision approval state. Stateless: "
        "does not execute trades, persist records, or call broker/exchange APIs."
    )
    is_readonly: bool = False
    repeatable: bool = True
    parameters: dict[str, object] = {
        "type": "object",
        "properties": {
            "approval": {
                "type": "object",
                "description": "ApprovalState.to_dict() payload to transition from pending to rejected.",
            },
            "reason": {"type": "string", "description": "Rejection reason for audit trail."},
            "actor": {"type": "string", "description": "Human or system actor rejecting the decision."},
        },
        "required": ["approval", "reason", "actor"],
    }

    def execute(self, **kwargs: object) -> str:
        try:
            approval = ApprovalState.from_dict(kwargs.get("approval"))
            return _ok(approval.reject(reason=str(kwargs.get("reason") or ""), actor=str(kwargs.get("actor") or "")))
        except (ValueError, TypeError) as exc:
            return _error(str(exc))
