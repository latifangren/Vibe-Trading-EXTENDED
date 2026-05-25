from __future__ import annotations

from dataclasses import dataclass, field
from typing import cast

MARKET_DATA_FRESHNESS_LEVELS = ("fresh", "current", "recent", "stale", "unknown")

_FRESHNESS_SET = set(MARKET_DATA_FRESHNESS_LEVELS)
_FRESHNESS_SCORES = {
    "fresh": 1.0,
    "current": 1.0,
    "recent": 0.8,
    "stale": 0.3,
    "unknown": 0.1,
}


@dataclass(frozen=True)
class MarketDataConfidence:
    requested_source: str
    resolved_source: str | None = None
    freshness: str = "unknown"
    fallback_used: bool = False
    fallback_chain: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    confidence_score: float = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "requested_source", _normalize_required_source(self.requested_source, "requested_source")
        )
        object.__setattr__(self, "resolved_source", _normalize_optional_source(self.resolved_source, "resolved_source"))
        object.__setattr__(self, "freshness", _normalize_freshness(self.freshness))
        object.__setattr__(self, "fallback_chain", _normalize_string_sequence(self.fallback_chain, "fallback_chain"))
        object.__setattr__(self, "warnings", _normalize_warnings(self.warnings))
        object.__setattr__(self, "confidence_score", _score_components(self))

    @classmethod
    def from_dict(cls, data: object) -> "MarketDataConfidence":
        if not isinstance(data, dict):
            raise ValueError("market data confidence payload must be a mapping")
        payload = cast(dict[object, object], data)
        return cls(
            requested_source=_normalize_required_source(payload.get("requested_source", ""), "requested_source"),
            resolved_source=_normalize_optional_source(payload.get("resolved_source"), "resolved_source"),
            freshness=_normalize_freshness(payload.get("freshness", "unknown")),
            fallback_used=_validate_bool(payload.get("fallback_used", False), "fallback_used"),
            fallback_chain=_normalize_string_sequence(payload.get("fallback_chain", ()), "fallback_chain"),
            warnings=_normalize_warnings(payload.get("warnings", ())),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "requested_source": self.requested_source,
            "resolved_source": self.resolved_source,
            "freshness": self.freshness,
            "fallback_used": self.fallback_used,
            "fallback_chain": list(self.fallback_chain),
            "warnings": list(self.warnings),
            "confidence_score": self.confidence_score,
            "summary": _build_summary(self),
        }


def summarize_market_data_confidence(
    *,
    requested_source: object,
    resolved_source: object | None = None,
    freshness: object = "unknown",
    fallback_used: object = False,
    fallback_chain: object = (),
    warnings: object = (),
) -> dict[str, object]:
    return MarketDataConfidence(
        requested_source=str(requested_source or ""),
        resolved_source=None if resolved_source is None else str(resolved_source),
        freshness=str(freshness or "unknown"),
        fallback_used=_validate_bool(fallback_used, "fallback_used"),
        fallback_chain=_normalize_string_sequence(fallback_chain, "fallback_chain"),
        warnings=_normalize_warnings(warnings),
    ).to_dict()


def score_market_data_confidence(value: object) -> float:
    if isinstance(value, MarketDataConfidence):
        return value.confidence_score
    return MarketDataConfidence.from_dict(value).confidence_score


def _score_components(confidence: MarketDataConfidence) -> float:
    source_score = 1.0 if confidence.resolved_source else 0.0
    freshness_score = _FRESHNESS_SCORES[confidence.freshness]
    fallback_score = _score_fallback(confidence)
    warning_score = max(0.0, 1.0 - 0.15 * min(len(confidence.warnings), 4))
    return round(
        source_score * 0.40 + freshness_score * 0.35 + fallback_score * 0.15 + warning_score * 0.10,
        4,
    )


def _score_fallback(confidence: MarketDataConfidence) -> float:
    if not confidence.fallback_used:
        return 1.0
    return 0.75 if confidence.resolved_source else 0.0


def _build_summary(confidence: MarketDataConfidence) -> str:
    resolved = confidence.resolved_source or "unresolved"
    summary = f"{confidence.requested_source} resolved via {resolved} with {confidence.freshness} data"
    if confidence.fallback_used:
        summary += " using fallback"
    if confidence.warnings:
        summary += f"; {len(confidence.warnings)} warning(s)"
    return summary


def _normalize_required_source(value: object, field_name: str) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        raise ValueError(f"{field_name} must be a non-empty string")
    return normalized


def _normalize_optional_source(value: object, field_name: str) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if not normalized:
        raise ValueError(f"{field_name} must be a non-empty string when provided")
    return normalized


def _normalize_freshness(value: object) -> str:
    freshness = str(value or "").strip().lower()
    if freshness not in _FRESHNESS_SET:
        allowed = ", ".join(MARKET_DATA_FRESHNESS_LEVELS)
        raise ValueError(f"freshness must be one of: {allowed}")
    return freshness


def _validate_bool(value: object, field_name: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field_name} must be a bool")
    return value


def _read_sequence(value: object, field_name: str) -> tuple[object, ...]:
    if value is None:
        return ()
    if not isinstance(value, (list, tuple)):
        raise ValueError(f"{field_name} must be a list or tuple")
    return tuple(cast(list[object] | tuple[object, ...], value))


def _normalize_string_sequence(value: object, field_name: str) -> tuple[str, ...]:
    items = _read_sequence(value, field_name)
    normalized: list[str] = []
    for item in items:
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{field_name} entries must be non-empty strings")
        normalized.append(item.strip().lower())
    return tuple(normalized)


def _normalize_warnings(value: object) -> tuple[str, ...]:
    items = _read_sequence(value, "warnings")
    normalized: list[str] = []
    for item in items:
        if not isinstance(item, str):
            raise ValueError("warnings entries must be strings")
        warning = item.strip()
        if warning:
            normalized.append(warning)
    return tuple(normalized)
