from __future__ import annotations

from dataclasses import dataclass
from typing import cast

EVIDENCE_TYPES = ("chart", "flow", "risk", "macro", "sentiment", "data", "news")

_EVIDENCE_TYPE_SET = set(EVIDENCE_TYPES)


@dataclass(frozen=True)
class EvidenceEntry:
    evidence_type: str
    summary: str
    source: str | None = None
    metadata: dict[str, object] | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "evidence_type", _normalize_evidence_type(self.evidence_type))
        object.__setattr__(self, "summary", _require_non_empty(self.summary, "summary"))
        if self.source is not None:
            object.__setattr__(self, "source", _require_non_empty(self.source, "source"))
        if self.metadata is not None and not isinstance(self.metadata, dict):
            raise ValueError("metadata must be a dict when provided")

    @classmethod
    def from_dict(cls, data: object) -> "EvidenceEntry":
        if not isinstance(data, dict):
            raise ValueError("evidence entry must be a mapping")
        payload = cast(dict[str, object], data)
        return cls(
            evidence_type=str(payload.get("type") or payload.get("evidence_type") or ""),
            summary=str(payload.get("summary") or ""),
            source=_optional_str(payload.get("source")),
            metadata=_optional_metadata(payload.get("metadata")),
        )

    def to_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            "type": self.evidence_type,
            "summary": self.summary,
        }
        if self.source is not None:
            result["source"] = self.source
        if self.metadata is not None:
            result["metadata"] = dict(self.metadata)
        return result


def build_evidence(*entries: EvidenceEntry | dict[str, object]) -> list[dict[str, object]]:
    if not entries:
        raise ValueError("evidence must contain at least one entry")
    result: list[dict[str, object]] = []
    for entry in entries:
        if isinstance(entry, EvidenceEntry):
            result.append(entry.to_dict())
        elif isinstance(entry, dict):
            result.append(EvidenceEntry.from_dict(entry).to_dict())
        else:
            raise TypeError("evidence entries must be EvidenceEntry or dict")
    return result


def validate_evidence(evidence: object) -> list[dict[str, object]]:
    if not isinstance(evidence, (list, tuple)) or not evidence:
        raise ValueError("evidence must be a non-empty list")
    items: list[object] = list(cast(list[object] | tuple[object, ...], evidence))
    result: list[dict[str, object]] = []
    for item in items:
        if isinstance(item, EvidenceEntry):
            result.append(item.to_dict())
        elif isinstance(item, dict):
            result.append(EvidenceEntry.from_dict(cast(dict[str, object], item)).to_dict())
        else:
            raise TypeError("evidence entries must be EvidenceEntry or dict")
    return result


def _normalize_evidence_type(value: object) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        raise ValueError("evidence_type must be a non-empty string")
    if normalized not in _EVIDENCE_TYPE_SET:
        allowed = ", ".join(EVIDENCE_TYPES)
        raise ValueError(f"evidence_type must be one of: {allowed}")
    return normalized


def _require_non_empty(value: object, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} must be a non-empty string")
    return normalized


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _optional_metadata(value: object) -> dict[str, object] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("metadata must be a dict when provided")
    return dict(cast(dict[str, object], value))
