from __future__ import annotations

from dataclasses import dataclass, field
from typing import cast

from .approval import ApprovalState
from .decision import AdvisoryDecision
from .quality import SignalQualityScore, score_advisory_decision


@dataclass
class JournalEntry:
    decision: AdvisoryDecision
    quality: SignalQualityScore
    approval: ApprovalState

    def to_dict(self) -> dict[str, object]:
        return {
            "decision": self.decision.to_dict(),
            "quality": self.quality.to_dict(),
            "approval": self.approval.to_dict(),
        }


@dataclass
class JournalStats:
    total: int = 0
    by_action: dict[str, int] = field(default_factory=dict)
    by_risk_level: dict[str, int] = field(default_factory=dict)
    by_approval_status: dict[str, int] = field(default_factory=dict)
    avg_confidence: float = 0.0
    avg_quality_score: float = 0.0
    approval_rate: float = 0.0

    def to_dict(self) -> dict[str, object]:
        return {
            "total": self.total,
            "by_action": dict(self.by_action),
            "by_risk_level": dict(self.by_risk_level),
            "by_approval_status": dict(self.by_approval_status),
            "avg_confidence": round(self.avg_confidence, 4),
            "avg_quality_score": round(self.avg_quality_score, 2),
            "approval_rate": round(self.approval_rate, 4),
        }


class DecisionJournal:
    def __init__(self) -> None:
        self._entries: list[JournalEntry] = []

    @property
    def entries(self) -> tuple[JournalEntry, ...]:
        return tuple(self._entries)

    def __len__(self) -> int:
        return len(self._entries)

    def append(self, decision: AdvisoryDecision, approval: ApprovalState | None = None) -> JournalEntry:
        if not isinstance(decision, AdvisoryDecision):
            raise TypeError("decision must be an AdvisoryDecision")
        if decision.decision_id != (approval or ApprovalState.for_decision(decision.decision_id)).decision_id:
            raise ValueError("approval decision_id must match decision")
        quality = score_advisory_decision(decision)
        state = approval if approval is not None else ApprovalState.for_decision(decision.decision_id)
        entry = JournalEntry(decision=decision, quality=quality, approval=state)
        self._entries.append(entry)
        return entry

    def stats(self) -> JournalStats:
        if not self._entries:
            return JournalStats()

        total = len(self._entries)
        by_action: dict[str, int] = {}
        by_risk_level: dict[str, int] = {}
        by_approval_status: dict[str, int] = {}
        sum_confidence = 0.0
        sum_quality = 0.0
        approved_count = 0

        for entry in self._entries:
            action = entry.decision.action
            by_action[action] = by_action.get(action, 0) + 1

            risk = entry.decision.risk_level
            by_risk_level[risk] = by_risk_level.get(risk, 0) + 1

            status = entry.approval.status
            by_approval_status[status] = by_approval_status.get(status, 0) + 1
            if status == "approved":
                approved_count += 1

            sum_confidence += entry.decision.confidence
            sum_quality += entry.quality.final_score

        return JournalStats(
            total=total,
            by_action=by_action,
            by_risk_level=by_risk_level,
            by_approval_status=by_approval_status,
            avg_confidence=sum_confidence / total,
            avg_quality_score=sum_quality / total,
            approval_rate=approved_count / total,
        )

    def filter_by_action(self, action: str) -> tuple[JournalEntry, ...]:
        return tuple(e for e in self._entries if e.decision.action == action)

    def filter_by_status(self, status: str) -> tuple[JournalEntry, ...]:
        return tuple(e for e in self._entries if e.approval.status == status)

    def to_dict(self) -> dict[str, object]:
        return {
            "entries": [entry.to_dict() for entry in self._entries],
            "stats": self.stats().to_dict(),
        }

    @classmethod
    def from_dict(cls, data: object) -> "DecisionJournal":
        if not isinstance(data, dict):
            raise ValueError("decision journal payload must be a mapping")
        payload = cast(dict[str, object], data)
        raw_entries = payload.get("entries")
        if not isinstance(raw_entries, list):
            raise ValueError("journal.entries must be a list")

        journal = cls()
        for item in cast(list[object], raw_entries):
            if not isinstance(item, dict):
                raise ValueError("journal entries must be mappings")
            entry = cast(dict[str, object], item)
            decision = AdvisoryDecision.from_dict(entry.get("decision"))
            approval = ApprovalState.from_dict(entry.get("approval"))
            _ = journal.append(decision, approval=approval)
        return journal
