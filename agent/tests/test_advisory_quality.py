from __future__ import annotations

import pytest

from src.advisory import AdvisoryDecision, SignalQualityScore, score_advisory_decision, score_advisory_payload


def _decision(**overrides: object) -> AdvisoryDecision:
    payload: dict[str, object] = {
        "decision_id": "dec_quality_001",
        "action": "hold",
        "confidence": 0.72,
        "risk_level": "medium",
        "reason": "Trend is constructive but confirmation is incomplete.",
        "evidence": [
            {"type": "chart", "summary": "Price reclaimed short-term moving average."},
            {"type": "flow", "summary": "Funding remains neutral."},
        ],
        "data_confidence": {
            "requested_source": "okx",
            "resolved_source": "okx",
            "freshness": "fresh",
        },
        "advisory_only": True,
    }
    payload.update(overrides)
    return AdvisoryDecision.from_dict(payload)


def test_high_confidence_fresh_signal_scores_above_weak_signal() -> None:
    strong = _decision(
        confidence=0.9,
        risk_level="low",
        evidence=[
            {"type": "chart", "summary": "Breakout confirmed."},
            {"type": "flow", "summary": "Spot demand rising."},
            {"type": "risk", "summary": "Invalidation level is nearby."},
        ],
    )
    weak = _decision(
        confidence=0.3,
        risk_level="severe",
        evidence=[{"summary": "Single untyped note."}],
        data_confidence={"freshness": "stale"},
    )

    assert score_advisory_decision(strong).final_score > score_advisory_decision(weak).final_score


def test_quality_score_blends_into_final_score_without_replacing_breakdown() -> None:
    without_quality = score_advisory_decision(_decision(confidence=0.4))
    with_quality = score_advisory_decision(_decision(confidence=0.4, quality_score=0.9))

    assert with_quality.final_score > without_quality.final_score
    assert with_quality.model_quality_score == 0.9
    assert with_quality.confidence_score == without_quality.confidence_score


def test_evidence_coverage_saturates_after_four_items() -> None:
    four_items = score_advisory_decision(
        _decision(
            evidence=[
                {"type": "chart", "summary": "one"},
                {"type": "flow", "summary": "two"},
                {"type": "risk", "summary": "three"},
                {"type": "macro", "summary": "four"},
            ]
        )
    )
    five_items = score_advisory_decision(
        _decision(
            evidence=[
                {"type": "chart", "summary": "one"},
                {"type": "flow", "summary": "two"},
                {"type": "risk", "summary": "three"},
                {"type": "macro", "summary": "four"},
                {"type": "sentiment", "summary": "five"},
            ]
        )
    )

    assert four_items.evidence_coverage_score == 1.0
    assert five_items.evidence_coverage_score == 1.0


def test_evidence_type_diversity_affects_score() -> None:
    repeated_type = score_advisory_decision(
        _decision(
            evidence=[
                {"type": "chart", "summary": "one"},
                {"type": "chart", "summary": "two"},
                {"type": "chart", "summary": "three"},
            ]
        )
    )
    diverse_types = score_advisory_decision(
        _decision(
            evidence=[
                {"type": "chart", "summary": "one"},
                {"type": "flow", "summary": "two"},
                {"type": "risk", "summary": "three"},
            ]
        )
    )

    assert diverse_types.evidence_diversity_score > repeated_type.evidence_diversity_score
    assert diverse_types.final_score > repeated_type.final_score


def test_data_confidence_freshness_affects_score() -> None:
    fresh = score_advisory_decision(
        _decision(data_confidence={"requested_source": "okx", "resolved_source": "okx", "freshness": "fresh"})
    )
    stale = score_advisory_decision(
        _decision(data_confidence={"requested_source": "okx", "resolved_source": "okx", "freshness": "stale"})
    )

    assert fresh.data_confidence_score > stale.data_confidence_score
    assert fresh.final_score > stale.final_score


def test_score_is_deterministic_for_same_input() -> None:
    decision = _decision()

    assert score_advisory_decision(decision) == score_advisory_decision(decision)


def test_score_advisory_payload_validates_then_scores() -> None:
    score = score_advisory_payload(_decision().to_dict())

    assert isinstance(score, SignalQualityScore)
    assert score.to_dict()["final_score"] == score.final_score


def test_score_requires_advisory_decision() -> None:
    with pytest.raises(TypeError, match="requires an AdvisoryDecision"):
        score_advisory_decision({"decision_id": "raw"})
