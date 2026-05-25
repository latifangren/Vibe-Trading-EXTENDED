from __future__ import annotations

import json

from src.advisory import (
    AdvisoryDecision,
    ApprovalState,
    DecisionJournal,
    EvidenceEntry,
    build_evidence,
    summarize_market_data_confidence,
)
from src.tools.advisory_journal_tool import QueryAdvisoryJournalTool


def _make_decision(
    decision_id: str,
    *,
    action: str = "buy",
    confidence: float = 0.8,
    risk_level: str = "medium",
) -> AdvisoryDecision:
    return AdvisoryDecision.from_dict(
        {
            "decision_id": decision_id,
            "action": action,
            "confidence": confidence,
            "risk_level": risk_level,
            "reason": f"Test decision {decision_id}.",
            "evidence": build_evidence(EvidenceEntry(evidence_type="chart", summary="Price above 200-day MA.")),
            "data_confidence": summarize_market_data_confidence(
                requested_source="okx", resolved_source="okx", freshness="fresh"
            ),
        }
    )


def _journal_payload() -> dict[str, object]:
    journal = DecisionJournal()
    _ = journal.append(
        _make_decision("dec_query_001", action="buy", confidence=0.9, risk_level="low"),
        approval=ApprovalState.for_decision("dec_query_001").approve(reason="ok", actor="pm"),
    )
    _ = journal.append(
        _make_decision("dec_query_002", action="sell", confidence=0.7, risk_level="high"),
        approval=ApprovalState.for_decision("dec_query_002").reject(reason="no", actor="risk"),
    )
    _ = journal.append(_make_decision("dec_query_003", action="buy", confidence=0.5, risk_level="medium"))
    return journal.to_dict()


def test_query_journal_tool_metadata() -> None:
    tool = QueryAdvisoryJournalTool()

    assert tool.name == "query_advisory_journal"
    assert tool.is_readonly is True
    assert "advisory-only" in tool.description


def test_query_journal_returns_entries_and_stats() -> None:
    tool = QueryAdvisoryJournalTool()

    result = json.loads(tool.execute(journal=_journal_payload()))

    assert result["status"] == "ok"
    assert result["advisory_only"] is True
    assert result["execution_performed"] is False
    assert result["filters"] == {}
    assert result["count"] == 3
    assert result["stats"]["total"] == 3
    assert result["stats"]["by_action"] == {"buy": 2, "sell": 1}
    assert len(result["entries"]) == 3


def test_query_journal_filters_by_action() -> None:
    tool = QueryAdvisoryJournalTool()

    result = json.loads(tool.execute(journal=_journal_payload(), action="buy"))

    assert result["status"] == "ok"
    assert result["filters"] == {"action": "buy"}
    assert result["count"] == 2
    assert all(entry["decision"]["action"] == "buy" for entry in result["entries"])


def test_query_journal_filters_by_approval_status() -> None:
    tool = QueryAdvisoryJournalTool()

    result = json.loads(tool.execute(journal=_journal_payload(), approval_status="approved"))

    assert result["status"] == "ok"
    assert result["filters"] == {"approval_status": "approved"}
    assert result["count"] == 1
    assert result["entries"][0]["approval"]["status"] == "approved"


def test_query_journal_applies_limit_after_filters() -> None:
    tool = QueryAdvisoryJournalTool()

    result = json.loads(tool.execute(journal=_journal_payload(), action="buy", limit=1))

    assert result["status"] == "ok"
    assert result["filters"] == {"action": "buy", "limit": "1"}
    assert result["count"] == 1
    assert result["entries"][0]["decision"]["decision_id"] == "dec_query_001"


def test_query_journal_rejects_malformed_payload() -> None:
    tool = QueryAdvisoryJournalTool()

    result = json.loads(tool.execute(journal={"entries": "bad"}))

    assert result["status"] == "error"
    assert "journal.entries must be a list" in result["error"]


def test_query_journal_rejects_negative_limit() -> None:
    tool = QueryAdvisoryJournalTool()

    result = json.loads(tool.execute(journal=_journal_payload(), limit=-1))

    assert result["status"] == "error"
    assert "limit must be non-negative" in result["error"]
