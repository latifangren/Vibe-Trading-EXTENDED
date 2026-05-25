from __future__ import annotations

import json

from src.advisory import ApprovalState
from src.tools.advisory_approval_tool import ApproveAdvisoryDecisionTool, RejectAdvisoryDecisionTool


def test_approve_tool_metadata() -> None:
    tool = ApproveAdvisoryDecisionTool()

    assert tool.name == "approve_advisory_decision"
    assert tool.is_readonly is False
    assert "advisory-only" in tool.description


def test_reject_tool_metadata() -> None:
    tool = RejectAdvisoryDecisionTool()

    assert tool.name == "reject_advisory_decision"
    assert tool.is_readonly is False
    assert "advisory-only" in tool.description


def test_approve_tool_transitions_pending_approval() -> None:
    approval = ApprovalState.for_decision("dec_approve_001")
    tool = ApproveAdvisoryDecisionTool()

    result = json.loads(tool.execute(approval=approval.to_dict(), reason="setup confirmed", actor="pm"))

    assert result["status"] == "ok"
    assert result["advisory_only"] is True
    assert result["execution_performed"] is False
    assert result["approval"]["decision_id"] == "dec_approve_001"
    assert result["approval"]["status"] == "approved"
    event = result["approval"]["audit_trail"][0]
    assert event["from_status"] == "pending"
    assert event["to_status"] == "approved"
    assert event["reason"] == "setup confirmed"
    assert event["actor"] == "pm"


def test_reject_tool_transitions_pending_approval() -> None:
    approval = ApprovalState.for_decision("dec_reject_001")
    tool = RejectAdvisoryDecisionTool()

    result = json.loads(tool.execute(approval=approval.to_dict(), reason="risk too high", actor="risk"))

    assert result["status"] == "ok"
    assert result["advisory_only"] is True
    assert result["execution_performed"] is False
    assert result["approval"]["decision_id"] == "dec_reject_001"
    assert result["approval"]["status"] == "rejected"
    event = result["approval"]["audit_trail"][0]
    assert event["to_status"] == "rejected"
    assert event["reason"] == "risk too high"
    assert event["actor"] == "risk"


def test_approval_tool_rejects_terminal_transition() -> None:
    approval = ApprovalState.for_decision("dec_terminal_001").approve(reason="ok", actor="pm")
    tool = RejectAdvisoryDecisionTool()

    result = json.loads(tool.execute(approval=approval.to_dict(), reason="changed", actor="risk"))

    assert result["status"] == "error"
    assert "cannot transition" in result["error"]


def test_approval_tool_rejects_missing_actor() -> None:
    approval = ApprovalState.for_decision("dec_missing_actor")
    tool = ApproveAdvisoryDecisionTool()

    result = json.loads(tool.execute(approval=approval.to_dict(), reason="ok", actor=""))

    assert result["status"] == "error"
    assert "actor must be a non-empty string" in result["error"]
