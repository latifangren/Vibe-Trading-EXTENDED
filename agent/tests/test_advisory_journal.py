from __future__ import annotations

from collections.abc import Callable

from src.advisory import (
    AdvisoryDecision,
    ApprovalState,
    DecisionJournal,
    JournalEntry,
    JournalStats,
    build_evidence,
    EvidenceEntry,
    summarize_market_data_confidence,
)


def _assert_value_error(expected: str, callback: Callable[[], object]) -> None:
    try:
        _ = callback()
    except ValueError as exc:
        assert expected in str(exc)
        return
    raise AssertionError("expected ValueError")


def _assert_key_error(expected: str, callback: Callable[[], object]) -> None:
    try:
        _ = callback()
    except KeyError as exc:
        assert expected in str(exc)
        return
    raise AssertionError("expected KeyError")


def _make_decision(
    decision_id: str, action: str = "buy", confidence: float = 0.8, risk_level: str = "medium"
) -> AdvisoryDecision:
    return AdvisoryDecision.from_dict(
        {
            "decision_id": decision_id,
            "action": action,
            "confidence": confidence,
            "risk_level": risk_level,
            "reason": f"Test decision {decision_id}.",
            "evidence": build_evidence(EvidenceEntry(evidence_type="chart", summary="Test evidence.")),
            "data_confidence": summarize_market_data_confidence(
                requested_source="okx", resolved_source="okx", freshness="fresh"
            ),
        }
    )


def test_empty_journal_has_zero_stats() -> None:
    journal = DecisionJournal()

    assert len(journal) == 0
    assert journal.entries == ()

    stats = journal.stats()
    assert stats.total == 0
    assert stats.avg_confidence == 0.0
    assert stats.approval_rate == 0.0


def test_append_creates_entry_with_quality_score() -> None:
    journal = DecisionJournal()
    decision = _make_decision("dec_j_001")

    entry = journal.append(decision)

    assert isinstance(entry, JournalEntry)
    assert entry.decision is decision
    assert entry.quality.final_score > 0
    assert entry.approval.status == "pending"
    assert len(journal) == 1


def test_append_with_approval_state() -> None:
    journal = DecisionJournal()
    decision = _make_decision("dec_j_002")
    approval = ApprovalState.for_decision("dec_j_002").approve(reason="ok", actor="user")

    entry = journal.append(decision, approval=approval)

    assert entry.approval.status == "approved"


def test_append_rejects_mismatched_approval_decision_id() -> None:
    journal = DecisionJournal()
    decision = _make_decision("dec_j_003")
    wrong_approval = ApprovalState.for_decision("dec_j_other")

    _assert_value_error("must match", lambda: journal.append(decision, approval=wrong_approval))


def test_stats_computes_aggregates() -> None:
    journal = DecisionJournal()

    d1 = _make_decision("dec_j_010", action="buy", confidence=0.9, risk_level="low")
    d2 = _make_decision("dec_j_011", action="sell", confidence=0.7, risk_level="high")
    d3 = _make_decision("dec_j_012", action="hold", confidence=0.5, risk_level="medium")

    journal.append(d1, approval=ApprovalState.for_decision("dec_j_010").approve(reason="ok", actor="pm"))
    journal.append(d2, approval=ApprovalState.for_decision("dec_j_011").reject(reason="no", actor="pm"))
    journal.append(d3)

    stats = journal.stats()

    assert stats.total == 3
    assert stats.by_action == {"buy": 1, "sell": 1, "hold": 1}
    assert stats.by_risk_level == {"low": 1, "high": 1, "medium": 1}
    assert stats.by_approval_status == {"approved": 1, "rejected": 1, "pending": 1}
    assert abs(stats.avg_confidence - 0.7) < 0.001
    assert stats.approval_rate == 1 / 3


def test_filter_by_action() -> None:
    journal = DecisionJournal()
    journal.append(_make_decision("dec_j_020", action="buy"))
    journal.append(_make_decision("dec_j_021", action="sell"))
    journal.append(_make_decision("dec_j_022", action="buy"))

    buys = journal.filter_by_action("buy")

    assert len(buys) == 2
    assert all(e.decision.action == "buy" for e in buys)


def test_filter_by_status() -> None:
    journal = DecisionJournal()
    journal.append(
        _make_decision("dec_j_030"), approval=ApprovalState.for_decision("dec_j_030").approve(reason="ok", actor="u")
    )
    journal.append(_make_decision("dec_j_031"))

    approved = journal.filter_by_status("approved")
    pending = journal.filter_by_status("pending")

    assert len(approved) == 1
    assert len(pending) == 1


def test_replace_approval_updates_pending_to_approved() -> None:
    journal = DecisionJournal()
    _ = journal.append(_make_decision("dec_j_050"))
    approval = ApprovalState.for_decision("dec_j_050").approve(reason="confirmed", actor="pm")

    updated = journal.replace_approval("dec_j_050", approval)

    assert updated.approval.status == "approved"
    assert journal.entries[0].approval.status == "approved"
    assert journal.stats().by_approval_status == {"approved": 1}


def test_replace_approval_updates_pending_to_rejected() -> None:
    journal = DecisionJournal()
    _ = journal.append(_make_decision("dec_j_051"))
    approval = ApprovalState.for_decision("dec_j_051").reject(reason="risk too high", actor="risk")

    updated = journal.replace_approval("dec_j_051", approval)

    assert updated.approval.status == "rejected"
    assert journal.filter_by_status("rejected")[0].decision.decision_id == "dec_j_051"


def test_replace_approval_rejects_missing_decision_id() -> None:
    journal = DecisionJournal()
    _ = journal.append(_make_decision("dec_j_052"))

    _assert_key_error(
        "decision not found: dec_j_missing",
        lambda: journal.replace_approval("dec_j_missing", ApprovalState.for_decision("dec_j_missing")),
    )


def test_replace_approval_rejects_mismatched_approval() -> None:
    journal = DecisionJournal()
    _ = journal.append(_make_decision("dec_j_053"))

    _assert_value_error(
        "approval decision_id must match decision_id",
        lambda: journal.replace_approval("dec_j_053", ApprovalState.for_decision("dec_j_other")),
    )


def test_to_dict_includes_entries_and_stats() -> None:
    journal = DecisionJournal()
    journal.append(_make_decision("dec_j_040"))

    payload = journal.to_dict()

    assert "entries" in payload
    assert "stats" in payload
    assert isinstance(payload["entries"], list)
    assert isinstance(payload["stats"], dict)


def test_journal_stats_to_dict() -> None:
    stats = JournalStats(
        total=5,
        by_action={"buy": 3, "sell": 2},
        by_risk_level={"low": 2, "medium": 3},
        by_approval_status={"approved": 4, "pending": 1},
        avg_confidence=0.756,
        avg_quality_score=72.345,
        approval_rate=0.8,
    )

    result = stats.to_dict()

    assert result["total"] == 5
    assert result["avg_confidence"] == 0.756
    assert result["avg_quality_score"] == 72.34
    assert result["approval_rate"] == 0.8
