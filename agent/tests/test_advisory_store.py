from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from src.advisory import (
    AdvisoryDecision,
    AdvisoryJournalStore,
    ApprovalState,
    DecisionJournal,
    EvidenceEntry,
    build_evidence,
    summarize_market_data_confidence,
)


def _assert_value_error(expected: str, callback: Callable[[], object]) -> None:
    try:
        _ = callback()
    except ValueError as exc:
        assert expected in str(exc)
        return
    raise AssertionError("expected ValueError")


def _make_decision(decision_id: str, *, action: str = "buy") -> AdvisoryDecision:
    return AdvisoryDecision.from_dict(
        {
            "decision_id": decision_id,
            "action": action,
            "confidence": 0.8,
            "risk_level": "medium",
            "reason": f"Test decision {decision_id}.",
            "evidence": build_evidence(EvidenceEntry(evidence_type="chart", summary="Range held.")),
            "data_confidence": summarize_market_data_confidence(
                requested_source="okx", resolved_source="okx", freshness="fresh"
            ),
        }
    )


def test_load_missing_store_returns_empty_journal_without_creating_file(tmp_path: Path) -> None:
    path = tmp_path / "advisory" / "journal.json"
    store = AdvisoryJournalStore(path)

    journal = store.load()

    assert len(journal) == 0
    assert not path.exists()


def test_save_and_load_round_trip_preserves_approval_audit_trail(tmp_path: Path) -> None:
    path = tmp_path / "advisory" / "journal.json"
    store = AdvisoryJournalStore(path)
    journal = DecisionJournal()
    approval = ApprovalState.for_decision("dec_store_001").approve(reason="reviewed", actor="pm")
    _ = journal.append(_make_decision("dec_store_001"), approval=approval)

    store.save(journal)
    loaded = store.load()

    assert path.exists()
    assert not path.with_suffix(".json.tmp").exists()
    assert len(loaded) == 1
    entry = loaded.entries[0]
    assert entry.decision.decision_id == "dec_store_001"
    assert entry.approval.status == "approved"
    assert entry.approval.audit_trail[0].actor == "pm"
    assert loaded.stats().by_approval_status == {"approved": 1}


def test_append_persists_entries_between_store_instances(tmp_path: Path) -> None:
    path = tmp_path / "journal.json"
    store = AdvisoryJournalStore(path)

    _ = store.append(_make_decision("dec_store_002"))
    _ = AdvisoryJournalStore(path).append(_make_decision("dec_store_003", action="sell"))

    loaded = AdvisoryJournalStore(path).load()
    assert [entry.decision.decision_id for entry in loaded.entries] == ["dec_store_002", "dec_store_003"]
    assert loaded.stats().by_action == {"buy": 1, "sell": 1}


def test_load_recomputes_derived_stats_instead_of_trusting_serialized_stats(tmp_path: Path) -> None:
    path = tmp_path / "journal.json"
    journal = DecisionJournal()
    _ = journal.append(_make_decision("dec_store_004"))
    payload = journal.to_dict()
    payload["stats"] = {"total": 999, "by_action": {"sell": 999}}
    _ = path.write_text(json.dumps(payload), encoding="utf-8")

    loaded = AdvisoryJournalStore(path).load()

    assert loaded.stats().total == 1
    assert loaded.stats().by_action == {"buy": 1}


def test_load_rejects_invalid_json(tmp_path: Path) -> None:
    path = tmp_path / "journal.json"
    _ = path.write_text("{broken", encoding="utf-8")

    _assert_value_error("invalid advisory journal JSON", lambda: AdvisoryJournalStore(path).load())


def test_from_dict_rejects_non_list_entries() -> None:
    _assert_value_error("journal.entries must be a list", lambda: DecisionJournal.from_dict({"entries": "bad"}))
