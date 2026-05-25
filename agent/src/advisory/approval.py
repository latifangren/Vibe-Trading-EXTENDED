from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import cast

APPROVAL_STATUSES = ("pending", "approved", "rejected", "expired")

_STATUS_SET = set(APPROVAL_STATUSES)
_VALID_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"approved", "rejected", "expired"},
    "approved": set(),
    "rejected": set(),
    "expired": set(),
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class ApprovalEvent:
    from_status: str
    to_status: str
    reason: str
    actor: str
    timestamp: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, object]:
        return {
            "from_status": self.from_status,
            "to_status": self.to_status,
            "reason": self.reason,
            "actor": self.actor,
            "timestamp": self.timestamp,
        }


@dataclass(frozen=True)
class ApprovalState:
    decision_id: str
    status: str = "pending"
    audit_trail: tuple[ApprovalEvent, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "decision_id", _require_non_empty(self.decision_id, "decision_id"))
        object.__setattr__(self, "status", _validate_status(self.status))

    @classmethod
    def for_decision(cls, decision_id: str) -> "ApprovalState":
        return cls(decision_id=decision_id)

    def approve(self, *, reason: str, actor: str) -> "ApprovalState":
        return self._transition("approved", reason=reason, actor=actor)

    def reject(self, *, reason: str, actor: str) -> "ApprovalState":
        return self._transition("rejected", reason=reason, actor=actor)

    def expire(self, *, reason: str = "TTL exceeded", actor: str = "system") -> "ApprovalState":
        return self._transition("expired", reason=reason, actor=actor)

    @property
    def is_terminal(self) -> bool:
        return not _VALID_TRANSITIONS[self.status]

    @property
    def allowed_transitions(self) -> tuple[str, ...]:
        return tuple(sorted(_VALID_TRANSITIONS[self.status]))

    def to_dict(self) -> dict[str, object]:
        return {
            "decision_id": self.decision_id,
            "status": self.status,
            "is_terminal": self.is_terminal,
            "allowed_transitions": list(self.allowed_transitions),
            "audit_trail": [event.to_dict() for event in self.audit_trail],
        }

    @classmethod
    def from_dict(cls, data: object) -> "ApprovalState":
        if not isinstance(data, dict):
            raise ValueError("approval state payload must be a mapping")
        payload = cast(dict[str, object], data)
        decision_id = str(payload.get("decision_id") or "")
        status = str(payload.get("status") or "pending")
        raw_trail = payload.get("audit_trail", ())
        if not isinstance(raw_trail, (list, tuple)):
            raise ValueError("audit_trail must be a list")
        trail: list[ApprovalEvent] = []
        for item in cast(list[object], list(raw_trail)):
            if not isinstance(item, dict):
                raise ValueError("audit_trail entries must be mappings")
            entry = cast(dict[str, object], item)
            trail.append(
                ApprovalEvent(
                    from_status=str(entry.get("from_status") or ""),
                    to_status=str(entry.get("to_status") or ""),
                    reason=str(entry.get("reason") or ""),
                    actor=str(entry.get("actor") or ""),
                    timestamp=str(entry.get("timestamp") or _utc_now()),
                )
            )
        return cls(decision_id=decision_id, status=status, audit_trail=tuple(trail))

    def _transition(self, to_status: str, *, reason: str, actor: str) -> "ApprovalState":
        _require_non_empty(reason, "reason")
        _require_non_empty(actor, "actor")
        allowed = _VALID_TRANSITIONS[self.status]
        if to_status not in allowed:
            raise ValueError(
                f"cannot transition from '{self.status}' to '{to_status}'; "
                f"allowed: {sorted(allowed) or 'none (terminal state)'}"
            )
        event = ApprovalEvent(
            from_status=self.status,
            to_status=to_status,
            reason=reason,
            actor=actor,
        )
        return ApprovalState(
            decision_id=self.decision_id,
            status=to_status,
            audit_trail=self.audit_trail + (event,),
        )


def _validate_status(value: object) -> str:
    status = str(value or "").strip().lower()
    if status not in _STATUS_SET:
        allowed = ", ".join(APPROVAL_STATUSES)
        raise ValueError(f"status must be one of: {allowed}")
    return status


def _require_non_empty(value: object, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} must be a non-empty string")
    return normalized
