from __future__ import annotations

import json

from src.advisory import AdvisoryDecision, ApprovalState, DecisionJournal
from src.tools import build_registry


def _decision_payload(decision_id: str) -> dict[str, object]:
    return {
        "decision_id": decision_id,
        "action": "hold",
        "confidence": 0.65,
        "risk_level": "medium",
        "reason": "Advisory sample payload for registry coverage.",
        "evidence": [{"type": "chart", "summary": "Price remains inside prior range."}],
        "data_confidence": {
            "requested_source": "okx",
            "resolved_source": "okx",
            "freshness": "fresh",
        },
    }


def _journal_payload() -> dict[str, object]:
    journal = DecisionJournal()
    _ = journal.append(
        AdvisoryDecision.from_dict(_decision_payload("dec_registry_journal_001")),
        approval=ApprovalState.for_decision("dec_registry_journal_001").approve(reason="reviewed", actor="pm"),
    )
    return journal.to_dict()


def test_advisory_tools_are_auto_discovered() -> None:
    registry = build_registry()

    for expected in (
        "create_advisory_decision",
        "approve_advisory_decision",
        "reject_advisory_decision",
        "approve_persisted_advisory_decision",
        "reject_persisted_advisory_decision",
        "query_advisory_journal",
    ):
        assert expected in registry.tool_names, f"{expected} missing from registry"


def test_discovered_advisory_approval_tools_execute() -> None:
    registry = build_registry()
    approval = ApprovalState.for_decision("dec_registry_approval_001").to_dict()

    approved = json.loads(
        registry.execute(
            "approve_advisory_decision",
            {"approval": approval, "reason": "setup confirmed", "actor": "pm"},
        )
    )
    rejected = json.loads(
        registry.execute(
            "reject_advisory_decision",
            {
                "approval": ApprovalState.for_decision("dec_registry_approval_002").to_dict(),
                "reason": "risk too high",
                "actor": "risk",
            },
        )
    )

    assert approved["status"] == "ok"
    assert approved["approval"]["status"] == "approved"
    assert approved["execution_performed"] is False
    assert rejected["status"] == "ok"
    assert rejected["approval"]["status"] == "rejected"
    assert rejected["execution_performed"] is False


def test_discovered_advisory_journal_tool_executes() -> None:
    registry = build_registry()

    result = json.loads(
        registry.execute(
            "query_advisory_journal",
            {"journal": _journal_payload(), "approval_status": "approved"},
        )
    )

    assert result["status"] == "ok"
    assert result["advisory_only"] is True
    assert result["execution_performed"] is False
    assert result["count"] == 1
    assert result["entries"][0]["approval"]["status"] == "approved"
