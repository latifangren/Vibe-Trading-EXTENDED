from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import cast

ADVISORY_ACTIONS = ("buy", "sell", "hold", "avoid")
ADVISORY_RISK_LEVELS = ("low", "medium", "high", "severe")

_ACTION_SET = set(ADVISORY_ACTIONS)
_RISK_LEVEL_SET = set(ADVISORY_RISK_LEVELS)
_FORBIDDEN_EXECUTION_FIELDS = {
    "api_key",
    "broker_account",
    "broker_account_id",
    "exchange_api_key",
    "order_id",
    "position_id",
    "secret",
    "signed_transaction",
    "transaction",
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _require_non_empty_string(value: object, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} must be a non-empty string")
    return normalized


def _validate_probability(value: object, field_name: str) -> float:
    if not isinstance(value, (int, float, str)):
        raise ValueError(f"{field_name} must be a number between 0 and 1")
    try:
        numeric = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be a number between 0 and 1") from exc
    if numeric < 0 or numeric > 1:
        raise ValueError(f"{field_name} must be between 0 and 1")
    return numeric


def _validate_action(value: object) -> str:
    action = str(value or "").strip().lower()
    if action not in _ACTION_SET:
        allowed = ", ".join(ADVISORY_ACTIONS)
        raise ValueError(f"action must be one of: {allowed}")
    return action


def _validate_risk_level(value: object) -> str:
    risk_level = str(value or "").strip().lower()
    if risk_level not in _RISK_LEVEL_SET:
        allowed = ", ".join(ADVISORY_RISK_LEVELS)
        raise ValueError(f"risk_level must be one of: {allowed}")
    return risk_level


def _copy_string_mapping(value: dict[object, object], field_name: str) -> dict[str, object]:
    copied: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not key.strip():
            raise ValueError(f"{field_name} keys must be non-empty strings")
        copied[key] = item
    if not copied:
        raise ValueError(f"{field_name} must be a non-empty mapping")
    return copied


def _validate_evidence(value: object) -> tuple[dict[str, object], ...]:
    if not isinstance(value, list) or not value:
        raise ValueError("evidence must be a non-empty list")
    evidence: list[dict[str, object]] = []
    for item in cast(list[object], value):
        if not isinstance(item, dict) or not item:
            raise ValueError("evidence entries must be non-empty mappings")
        evidence.append(_copy_string_mapping(cast(dict[object, object], item), "evidence entry"))
    return tuple(evidence)


def _validate_mapping(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict) or not value:
        raise ValueError(f"{field_name} must be a non-empty mapping")
    return _copy_string_mapping(cast(dict[object, object], value), field_name)


def _reject_forbidden_execution_fields(data: dict[str, object]) -> None:
    forbidden = sorted(_FORBIDDEN_EXECUTION_FIELDS.intersection(data))
    if forbidden:
        joined = ", ".join(forbidden)
        raise ValueError(f"advisory decisions must not include execution fields: {joined}")


def _validate_advisory_only(value: object) -> bool:
    if value is not True:
        raise ValueError("advisory_only must be True")
    return True


def _optional_string(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _optional_probability(value: object) -> float | None:
    if value is None:
        return None
    return _validate_probability(value, "quality_score")


@dataclass(frozen=True)
class AdvisoryDecision:
    decision_id: str
    action: str
    confidence: float
    risk_level: str
    reason: str
    evidence: tuple[dict[str, object], ...]
    data_confidence: dict[str, object]
    advisory_only: bool = True
    linked_hypothesis_id: str | None = None
    quality_score: float | None = None
    created_at: str = field(default_factory=_utc_now)

    def __post_init__(self) -> None:
        object.__setattr__(self, "decision_id", _require_non_empty_string(self.decision_id, "decision_id"))
        object.__setattr__(self, "action", _validate_action(self.action))
        object.__setattr__(self, "confidence", _validate_probability(self.confidence, "confidence"))
        object.__setattr__(self, "risk_level", _validate_risk_level(self.risk_level))
        object.__setattr__(self, "reason", _require_non_empty_string(self.reason, "reason"))
        object.__setattr__(self, "evidence", _validate_evidence(list(self.evidence)))
        object.__setattr__(self, "data_confidence", _validate_mapping(self.data_confidence, "data_confidence"))
        if self.advisory_only is not True:
            raise ValueError("advisory_only must be True")
        if self.quality_score is not None:
            object.__setattr__(self, "quality_score", _validate_probability(self.quality_score, "quality_score"))
        if self.linked_hypothesis_id is not None:
            linked_id = str(self.linked_hypothesis_id).strip()
            object.__setattr__(self, "linked_hypothesis_id", linked_id or None)
        object.__setattr__(self, "created_at", _require_non_empty_string(self.created_at, "created_at"))

    @classmethod
    def from_dict(cls, data: object) -> "AdvisoryDecision":
        if not isinstance(data, dict):
            raise ValueError("advisory decision payload must be a mapping")
        payload = _copy_string_mapping(cast(dict[object, object], data), "advisory decision payload")
        _reject_forbidden_execution_fields(payload)
        missing = [
            field_name
            for field_name in (
                "decision_id",
                "action",
                "confidence",
                "risk_level",
                "reason",
                "evidence",
                "data_confidence",
            )
            if field_name not in payload
        ]
        if missing:
            raise ValueError(f"missing required advisory decision fields: {', '.join(missing)}")
        return cls(
            decision_id=_require_non_empty_string(payload["decision_id"], "decision_id"),
            action=_validate_action(payload["action"]),
            confidence=_validate_probability(payload["confidence"], "confidence"),
            risk_level=_validate_risk_level(payload["risk_level"]),
            reason=_require_non_empty_string(payload["reason"], "reason"),
            evidence=_validate_evidence(payload["evidence"]),
            data_confidence=_validate_mapping(payload["data_confidence"], "data_confidence"),
            advisory_only=_validate_advisory_only(payload.get("advisory_only", True)),
            linked_hypothesis_id=_optional_string(payload.get("linked_hypothesis_id")),
            quality_score=_optional_probability(payload.get("quality_score")),
            created_at=str(payload.get("created_at") or _utc_now()),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "decision_id": self.decision_id,
            "action": self.action,
            "confidence": self.confidence,
            "risk_level": self.risk_level,
            "reason": self.reason,
            "evidence": [dict(item) for item in self.evidence],
            "data_confidence": dict(self.data_confidence),
            "advisory_only": self.advisory_only,
            "linked_hypothesis_id": self.linked_hypothesis_id,
            "quality_score": self.quality_score,
            "created_at": self.created_at,
        }
