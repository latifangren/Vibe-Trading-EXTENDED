from __future__ import annotations

from dataclasses import dataclass
from math import isfinite

from .decision import AdvisoryDecision

_EVIDENCE_COVERAGE_CAP = 4
_DATA_CONFIDENCE_KEYS = ("requested_source", "resolved_source", "freshness")
_FRESHNESS_SCORES = {
    "fresh": 1.0,
    "current": 1.0,
    "recent": 0.8,
    "stale": 0.3,
    "unknown": 0.1,
}
_RISK_LEVEL_SCORES = {
    "low": 1.0,
    "medium": 0.8,
    "high": 0.55,
    "severe": 0.25,
}
_BASE_WEIGHTS = {
    "confidence": 0.40,
    "evidence_coverage": 0.20,
    "evidence_diversity": 0.15,
    "data_confidence": 0.15,
    "risk_alignment": 0.10,
}
_MODEL_QUALITY_BLEND = 0.15


@dataclass(frozen=True)
class SignalQualityScore:
    final_score: float
    confidence_score: float
    evidence_coverage_score: float
    evidence_diversity_score: float
    data_confidence_score: float
    risk_alignment_score: float
    model_quality_score: float | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "final_score": self.final_score,
            "confidence_score": self.confidence_score,
            "evidence_coverage_score": self.evidence_coverage_score,
            "evidence_diversity_score": self.evidence_diversity_score,
            "data_confidence_score": self.data_confidence_score,
            "risk_alignment_score": self.risk_alignment_score,
            "model_quality_score": self.model_quality_score,
        }


def score_advisory_decision(decision: object) -> SignalQualityScore:
    if not isinstance(decision, AdvisoryDecision):
        raise TypeError("score_advisory_decision requires an AdvisoryDecision")

    confidence_score = _require_unit_interval(decision.confidence, "confidence")
    evidence_coverage_score = _score_evidence_coverage(decision.evidence)
    evidence_diversity_score = _score_evidence_diversity(decision.evidence)
    data_confidence_score = _score_data_confidence(decision.data_confidence)
    risk_alignment_score = _RISK_LEVEL_SCORES[decision.risk_level]

    base_score = (
        confidence_score * _BASE_WEIGHTS["confidence"]
        + evidence_coverage_score * _BASE_WEIGHTS["evidence_coverage"]
        + evidence_diversity_score * _BASE_WEIGHTS["evidence_diversity"]
        + data_confidence_score * _BASE_WEIGHTS["data_confidence"]
        + risk_alignment_score * _BASE_WEIGHTS["risk_alignment"]
    )
    final_score = base_score
    if decision.quality_score is not None:
        model_quality_score = _require_unit_interval(decision.quality_score, "quality_score")
        final_score = base_score * (1 - _MODEL_QUALITY_BLEND) + model_quality_score * _MODEL_QUALITY_BLEND
    else:
        model_quality_score = None

    return SignalQualityScore(
        final_score=round(final_score * 100, 2),
        confidence_score=confidence_score,
        evidence_coverage_score=evidence_coverage_score,
        evidence_diversity_score=evidence_diversity_score,
        data_confidence_score=data_confidence_score,
        risk_alignment_score=risk_alignment_score,
        model_quality_score=model_quality_score,
    )


def score_advisory_payload(data: object) -> SignalQualityScore:
    return score_advisory_decision(AdvisoryDecision.from_dict(data))


def _require_unit_interval(value: float, field_name: str) -> float:
    if not isfinite(value) or value < 0 or value > 1:
        raise ValueError(f"{field_name} must be a finite number between 0 and 1")
    return value


def _score_evidence_coverage(evidence: tuple[dict[str, object], ...]) -> float:
    return min(len(evidence), _EVIDENCE_COVERAGE_CAP) / _EVIDENCE_COVERAGE_CAP


def _score_evidence_diversity(evidence: tuple[dict[str, object], ...]) -> float:
    evidence_types = {
        str(item.get("type") or "").strip().lower() for item in evidence if str(item.get("type") or "").strip()
    }
    if not evidence_types:
        return 0.0
    return min(len(evidence_types), 3) / 3


def _score_data_confidence(data_confidence: dict[str, object]) -> float:
    present_ratio = sum(_has_value(data_confidence.get(key)) for key in _DATA_CONFIDENCE_KEYS) / len(
        _DATA_CONFIDENCE_KEYS
    )
    freshness = str(data_confidence.get("freshness") or "").strip().lower()
    freshness_score = _FRESHNESS_SCORES.get(freshness, 0.5 if freshness else 0.0)
    return round((present_ratio * 0.7) + (freshness_score * 0.3), 4)


def _has_value(value: object) -> bool:
    return bool(str(value or "").strip())
