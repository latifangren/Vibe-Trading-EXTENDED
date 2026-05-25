"""Advisory decision tool: bridges LLM structured output to the advisory package.

The agent can call this tool to record a structured advisory decision from its
analysis. The tool validates the payload, scores signal quality, and optionally
creates an approval state. No live trading, no execution, no broker/exchange
interaction.
"""

from __future__ import annotations

import json
from typing import Any

from src.advisory import (
    AdvisoryDecision,
    ApprovalState,
    score_advisory_decision,
)
from src.agent.tools import BaseTool


def _ok(payload: dict[str, Any]) -> str:
    return json.dumps({"status": "ok", **payload}, ensure_ascii=False)


def _error(msg: str) -> str:
    return json.dumps({"status": "error", "error": msg}, ensure_ascii=False)


class CreateAdvisoryDecisionTool(BaseTool):
    """Record a structured advisory decision from LLM analysis output."""

    name = "create_advisory_decision"
    description = (
        "Record a structured advisory decision. Validates the payload, scores "
        "signal quality, and returns the decision with quality metrics. "
        "Advisory-only: does not place trades or call live trading APIs."
    )
    is_readonly = False
    repeatable = True
    parameters = {
        "type": "object",
        "properties": {
            "decision_id": {"type": "string", "description": "Unique decision identifier"},
            "action": {
                "type": "string",
                "enum": ["buy", "sell", "hold", "avoid"],
                "description": "Advisory action recommendation",
            },
            "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "Confidence level between 0 and 1",
            },
            "risk_level": {
                "type": "string",
                "enum": ["low", "medium", "high", "severe"],
                "description": "Assessed risk level",
            },
            "reason": {"type": "string", "description": "Rationale for the decision"},
            "evidence": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["chart", "flow", "risk", "macro", "sentiment", "data", "news"],
                        },
                        "summary": {"type": "string"},
                        "source": {"type": "string"},
                    },
                    "required": ["type", "summary"],
                },
                "description": "Supporting evidence entries",
            },
            "data_confidence": {
                "type": "object",
                "properties": {
                    "requested_source": {"type": "string"},
                    "resolved_source": {"type": "string"},
                    "freshness": {"type": "string", "enum": ["fresh", "current", "recent", "stale", "unknown"]},
                },
                "required": ["requested_source", "freshness"],
                "description": "Market data confidence metadata",
            },
            "quality_score": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "Optional model self-assessed quality score",
            },
            "linked_hypothesis_id": {
                "type": "string",
                "description": "Optional linked hypothesis identifier",
            },
        },
        "required": ["decision_id", "action", "confidence", "risk_level", "reason", "evidence", "data_confidence"],
    }

    def execute(self, **kwargs: Any) -> str:
        try:
            decision = AdvisoryDecision.from_dict(kwargs)
            quality = score_advisory_decision(decision)
            approval = ApprovalState.for_decision(decision.decision_id)
            return _ok(
                {
                    "decision": decision.to_dict(),
                    "quality": quality.to_dict(),
                    "approval": approval.to_dict(),
                }
            )
        except (ValueError, TypeError) as exc:
            return _error(str(exc))
