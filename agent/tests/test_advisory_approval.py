from __future__ import annotations

import pytest

from src.advisory import (
    APPROVAL_STATUSES,
    ApprovalEvent,
    ApprovalState,
)


def test_approval_statuses_constant() -> None:
    assert APPROVAL_STATUSES == ("pending", "approved", "rejected", "expired")


def test_new_approval_state_starts_pending() -> None:
    state = ApprovalState.for_decision("dec_001")

    assert state.decision_id == "dec_001"
    assert state.status == "pending"
    assert state.audit_trail == ()
    assert not state.is_terminal
    assert state.allowed_transitions == ("approved", "expired", "rejected")


def test_approve_transitions_to_terminal() -> None:
    state = ApprovalState.for_decision("dec_002")
    approved = state.approve(reason="Meets risk criteria.", actor="analyst_a")

    assert approved.status == "approved"
    assert approved.is_terminal
    assert approved.allowed_transitions == ()
    assert len(approved.audit_trail) == 1
    assert approved.audit_trail[0].from_status == "pending"
    assert approved.audit_trail[0].to_status == "approved"
    assert approved.audit_trail[0].reason == "Meets risk criteria."
    assert approved.audit_trail[0].actor == "analyst_a"


def test_reject_transitions_to_terminal() -> None:
    state = ApprovalState.for_decision("dec_003")
    rejected = state.reject(reason="Confidence too low.", actor="risk_mgr")

    assert rejected.status == "rejected"
    assert rejected.is_terminal
    assert len(rejected.audit_trail) == 1


def test_expire_transitions_to_terminal() -> None:
    state = ApprovalState.for_decision("dec_004")
    expired = state.expire()

    assert expired.status == "expired"
    assert expired.is_terminal
    assert expired.audit_trail[0].actor == "system"
    assert expired.audit_trail[0].reason == "TTL exceeded"


def test_terminal_state_rejects_further_transitions() -> None:
    approved = ApprovalState.for_decision("dec_005").approve(reason="ok", actor="user")

    with pytest.raises(ValueError, match="cannot transition"):
        approved.reject(reason="changed mind", actor="user")

    with pytest.raises(ValueError, match="cannot transition"):
        approved.expire()


def test_rejected_state_rejects_further_transitions() -> None:
    rejected = ApprovalState.for_decision("dec_006").reject(reason="bad", actor="user")

    with pytest.raises(ValueError, match="none \\(terminal state\\)"):
        rejected.approve(reason="retry", actor="user")


def test_transition_requires_non_empty_reason_and_actor() -> None:
    state = ApprovalState.for_decision("dec_007")

    with pytest.raises(ValueError, match="reason must be a non-empty string"):
        state.approve(reason="", actor="user")

    with pytest.raises(ValueError, match="actor must be a non-empty string"):
        state.approve(reason="ok", actor="")


def test_to_dict_roundtrips_through_from_dict() -> None:
    state = ApprovalState.for_decision("dec_008").approve(reason="Solid setup.", actor="pm")
    payload = state.to_dict()
    restored = ApprovalState.from_dict(payload)

    assert restored.decision_id == state.decision_id
    assert restored.status == state.status
    assert len(restored.audit_trail) == 1
    assert restored.audit_trail[0].reason == "Solid setup."
    assert restored.audit_trail[0].actor == "pm"


def test_from_dict_rejects_non_mapping() -> None:
    with pytest.raises(ValueError, match="approval state payload must be a mapping"):
        ApprovalState.from_dict(["bad"])


def test_from_dict_rejects_invalid_status() -> None:
    with pytest.raises(ValueError, match="status must be one of"):
        ApprovalState.from_dict({"decision_id": "dec_009", "status": "invalid"})


def test_original_state_is_immutable_after_transition() -> None:
    original = ApprovalState.for_decision("dec_010")
    _ = original.approve(reason="ok", actor="user")

    assert original.status == "pending"
    assert original.audit_trail == ()


def test_approval_event_to_dict() -> None:
    event = ApprovalEvent(
        from_status="pending", to_status="approved", reason="ok", actor="user", timestamp="2026-01-01T00:00:00Z"
    )

    assert event.to_dict() == {
        "from_status": "pending",
        "to_status": "approved",
        "reason": "ok",
        "actor": "user",
        "timestamp": "2026-01-01T00:00:00Z",
    }
