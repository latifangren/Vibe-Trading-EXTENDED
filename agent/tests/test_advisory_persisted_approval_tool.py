from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

from src.advisory import (
    AdvisoryDecision,
    AdvisoryJournalStore,
    ApprovalState,
    DecisionJournal,
    EvidenceEntry,
    build_evidence,
    summarize_market_data_confidence,
)
from src.tools.advisory_persisted_approval_tool import (
    ApprovePersistedAdvisoryDecisionTool,
    RejectPersistedAdvisoryDecisionTool,
)
from src.tools.redaction import _internal_roots


class MonkeyPatchFixture(Protocol):
    def setenv(self, name: str, value: str) -> None: ...

    def chdir(self, path: Path) -> None: ...


def _make_decision(decision_id: str) -> AdvisoryDecision:
    return AdvisoryDecision.from_dict(
        {
            "decision_id": decision_id,
            "action": "hold",
            "confidence": 0.7,
            "risk_level": "medium",
            "reason": f"Test decision {decision_id}.",
            "evidence": build_evidence(EvidenceEntry(evidence_type="chart", summary="Range held.")),
            "data_confidence": summarize_market_data_confidence(
                requested_source="okx", resolved_source="okx", freshness="fresh"
            ),
        }
    )


def _seed_journal(path: Path, decision_id: str, approval: ApprovalState | None = None) -> None:
    journal = DecisionJournal()
    _ = journal.append(_make_decision(decision_id), approval=approval)
    AdvisoryJournalStore(path).save(journal)


def test_persisted_approve_tool_metadata() -> None:
    tool = ApprovePersistedAdvisoryDecisionTool()

    assert tool.name == "approve_persisted_advisory_decision"
    assert tool.is_readonly is False
    assert "advisory-only" in tool.description


def test_persisted_reject_tool_metadata() -> None:
    tool = RejectPersistedAdvisoryDecisionTool()

    assert tool.name == "reject_persisted_advisory_decision"
    assert tool.is_readonly is False
    assert "advisory-only" in tool.description


def test_persisted_approve_updates_journal_file(tmp_path: Path, monkeypatch: MonkeyPatchFixture) -> None:
    monkeypatch.setenv("VIBE_TRADING_ALLOWED_FILE_ROOTS", str(tmp_path))
    path = tmp_path / "journal.json"
    _seed_journal(path, "dec_persist_approve_001")

    result = json.loads(
        ApprovePersistedAdvisoryDecisionTool().execute(
            journal_path=str(path),
            decision_id="dec_persist_approve_001",
            reason="setup confirmed",
            actor="pm",
        )
    )
    loaded = AdvisoryJournalStore(path).load()

    assert result["status"] == "ok"
    assert result["advisory_only"] is True
    assert result["execution_performed"] is False
    assert result["decision_id"] == "dec_persist_approve_001"
    assert result["approval"]["status"] == "approved"
    assert "path" not in result
    assert loaded.entries[0].approval.status == "approved"
    assert loaded.entries[0].approval.audit_trail[0].reason == "setup confirmed"


def test_persisted_reject_updates_journal_file(tmp_path: Path, monkeypatch: MonkeyPatchFixture) -> None:
    monkeypatch.setenv("VIBE_TRADING_ALLOWED_FILE_ROOTS", str(tmp_path))
    path = tmp_path / "journal.json"
    _seed_journal(path, "dec_persist_reject_001")

    result = json.loads(
        RejectPersistedAdvisoryDecisionTool().execute(
            journal_path=str(path),
            decision_id="dec_persist_reject_001",
            reason="risk too high",
            actor="risk",
        )
    )
    loaded = AdvisoryJournalStore(path).load()

    assert result["status"] == "ok"
    assert result["approval"]["status"] == "rejected"
    assert result["execution_performed"] is False
    assert loaded.entries[0].approval.status == "rejected"
    assert loaded.entries[0].approval.audit_trail[0].actor == "risk"


def test_persisted_tool_rejects_missing_journal_without_creating_file(
    tmp_path: Path, monkeypatch: MonkeyPatchFixture
) -> None:
    monkeypatch.setenv("VIBE_TRADING_ALLOWED_FILE_ROOTS", str(tmp_path))
    path = tmp_path / "missing.json"

    result = json.loads(
        ApprovePersistedAdvisoryDecisionTool().execute(
            journal_path=str(path),
            decision_id="dec_missing_journal",
            reason="ok",
            actor="pm",
        )
    )

    assert result["status"] == "error"
    assert "advisory journal file not found" in result["error"]
    assert not path.exists()


def test_persisted_tool_rejects_missing_decision_without_changing_journal(
    tmp_path: Path, monkeypatch: MonkeyPatchFixture
) -> None:
    monkeypatch.setenv("VIBE_TRADING_ALLOWED_FILE_ROOTS", str(tmp_path))
    path = tmp_path / "journal.json"
    _seed_journal(path, "dec_present")

    result = json.loads(
        ApprovePersistedAdvisoryDecisionTool().execute(
            journal_path=str(path),
            decision_id="dec_missing",
            reason="ok",
            actor="pm",
        )
    )
    loaded = AdvisoryJournalStore(path).load()

    assert result["status"] == "error"
    assert "decision not found: dec_missing" in result["error"]
    assert loaded.entries[0].approval.status == "pending"


def test_persisted_tool_rejects_terminal_transition_without_changing_journal(
    tmp_path: Path, monkeypatch: MonkeyPatchFixture
) -> None:
    monkeypatch.setenv("VIBE_TRADING_ALLOWED_FILE_ROOTS", str(tmp_path))
    path = tmp_path / "journal.json"
    approval = ApprovalState.for_decision("dec_terminal").approve(reason="ok", actor="pm")
    _seed_journal(path, "dec_terminal", approval=approval)

    result = json.loads(
        RejectPersistedAdvisoryDecisionTool().execute(
            journal_path=str(path),
            decision_id="dec_terminal",
            reason="changed",
            actor="risk",
        )
    )
    loaded = AdvisoryJournalStore(path).load()

    assert result["status"] == "error"
    assert "cannot transition from 'approved' to 'rejected'" in result["error"]
    assert loaded.entries[0].approval.status == "approved"
    assert len(loaded.entries[0].approval.audit_trail) == 1


def test_persisted_tool_rejects_empty_actor_and_reason(tmp_path: Path, monkeypatch: MonkeyPatchFixture) -> None:
    monkeypatch.setenv("VIBE_TRADING_ALLOWED_FILE_ROOTS", str(tmp_path))
    path = tmp_path / "journal.json"
    _seed_journal(path, "dec_empty_actor")

    empty_actor = json.loads(
        ApprovePersistedAdvisoryDecisionTool().execute(
            journal_path=str(path), decision_id="dec_empty_actor", reason="ok", actor=""
        )
    )
    empty_reason = json.loads(
        ApprovePersistedAdvisoryDecisionTool().execute(
            journal_path=str(path), decision_id="dec_empty_actor", reason="", actor="pm"
        )
    )

    assert empty_actor["status"] == "error"
    assert "actor must be a non-empty string" in empty_actor["error"]
    assert empty_reason["status"] == "error"
    assert "reason must be a non-empty string" in empty_reason["error"]


def test_persisted_tool_redacts_invalid_json_path(tmp_path: Path, monkeypatch: MonkeyPatchFixture) -> None:
    monkeypatch.chdir(tmp_path)
    _internal_roots.cache_clear()
    monkeypatch.setenv("VIBE_TRADING_ALLOWED_FILE_ROOTS", str(tmp_path))
    path = tmp_path / "journal.json"
    _ = path.write_text("{broken", encoding="utf-8")

    result = json.loads(
        ApprovePersistedAdvisoryDecisionTool().execute(
            journal_path=str(path), decision_id="dec_bad_json", reason="ok", actor="pm"
        )
    )

    assert result["status"] == "error"
    assert "invalid advisory journal JSON" in result["error"]
    assert str(tmp_path) not in result["error"]
    assert "<redacted>" in result["error"]


def test_persisted_tool_rejects_path_outside_allowed_roots(tmp_path: Path, monkeypatch: MonkeyPatchFixture) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside" / "journal.json"
    monkeypatch.setenv("VIBE_TRADING_ALLOWED_FILE_ROOTS", str(allowed))

    result = json.loads(
        ApprovePersistedAdvisoryDecisionTool().execute(
            journal_path=str(outside), decision_id="dec_outside", reason="ok", actor="pm"
        )
    )

    assert result["status"] == "error"
    assert "outside allowed user-file roots" in result["error"]


def test_persisted_tool_rejects_unc_path() -> None:
    result = json.loads(
        ApprovePersistedAdvisoryDecisionTool().execute(
            journal_path="\\\\server\\share\\journal.json",
            decision_id="dec_unc",
            reason="ok",
            actor="pm",
        )
    )

    assert result["status"] == "error"
    assert "UNC paths are not allowed" in result["error"]
