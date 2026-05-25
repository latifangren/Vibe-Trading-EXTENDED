from __future__ import annotations

import pytest

from src.advisory import (
    EVIDENCE_TYPES,
    AdvisoryDecision,
    EvidenceEntry,
    build_evidence,
    score_advisory_decision,
    validate_evidence,
)


def test_evidence_types_constant() -> None:
    assert EVIDENCE_TYPES == ("chart", "flow", "risk", "macro", "sentiment", "data", "news")


def test_evidence_entry_normalizes_type_and_summary() -> None:
    entry = EvidenceEntry(evidence_type=" Chart ", summary="  RSI divergence detected.  ")

    assert entry.evidence_type == "chart"
    assert entry.summary == "RSI divergence detected."


def test_evidence_entry_from_dict_accepts_type_key() -> None:
    entry = EvidenceEntry.from_dict({"type": "flow", "summary": "Funding rate positive."})

    assert entry.evidence_type == "flow"
    assert entry.summary == "Funding rate positive."


def test_evidence_entry_from_dict_accepts_evidence_type_key() -> None:
    entry = EvidenceEntry.from_dict({"evidence_type": "risk", "summary": "Invalidation nearby."})

    assert entry.evidence_type == "risk"


def test_evidence_entry_to_dict_roundtrips() -> None:
    entry = EvidenceEntry(
        evidence_type="macro", summary="CPI data released.", source="bloomberg", metadata={"lag": "1d"}
    )
    result = entry.to_dict()

    assert result == {
        "type": "macro",
        "summary": "CPI data released.",
        "source": "bloomberg",
        "metadata": {"lag": "1d"},
    }


def test_evidence_entry_optional_fields_omitted_when_none() -> None:
    entry = EvidenceEntry(evidence_type="sentiment", summary="Fear index elevated.")
    result = entry.to_dict()

    assert "source" not in result
    assert "metadata" not in result


@pytest.mark.parametrize(
    "payload, match",
    [
        ({"type": "", "summary": "x"}, "evidence_type must be a non-empty string"),
        ({"type": "unknown_type", "summary": "x"}, "evidence_type must be one of"),
        ({"type": "chart", "summary": ""}, "summary must be a non-empty string"),
        ({"type": "chart", "summary": "x", "metadata": "bad"}, "metadata must be a dict"),
    ],
)
def test_evidence_entry_rejects_invalid_payloads(payload: dict[str, object], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        EvidenceEntry.from_dict(payload)


def test_evidence_entry_rejects_non_mapping() -> None:
    with pytest.raises(ValueError, match="evidence entry must be a mapping"):
        EvidenceEntry.from_dict(["chart", "summary"])


def test_build_evidence_from_mixed_entries() -> None:
    entry = EvidenceEntry(evidence_type="chart", summary="Breakout confirmed.")
    raw = {"type": "flow", "summary": "Spot demand rising."}

    result = build_evidence(entry, raw)

    assert len(result) == 2
    assert result[0]["type"] == "chart"
    assert result[1]["type"] == "flow"


def test_build_evidence_rejects_empty() -> None:
    with pytest.raises(ValueError, match="at least one entry"):
        build_evidence()


def test_validate_evidence_normalizes_list_of_dicts() -> None:
    raw_evidence = [
        {"type": "chart", "summary": "Price above MA."},
        {"type": "risk", "summary": "Stop loss tight."},
    ]

    result = validate_evidence(raw_evidence)

    assert len(result) == 2
    assert result[0]["type"] == "chart"
    assert result[1]["type"] == "risk"


def test_validate_evidence_rejects_empty_list() -> None:
    with pytest.raises(ValueError, match="non-empty list"):
        validate_evidence([])


def test_validate_evidence_rejects_non_list() -> None:
    with pytest.raises(ValueError, match="non-empty list"):
        validate_evidence("not a list")


def test_evidence_builder_output_compatible_with_advisory_decision() -> None:
    evidence = build_evidence(
        EvidenceEntry(evidence_type="chart", summary="Breakout confirmed."),
        EvidenceEntry(evidence_type="flow", summary="Spot demand rising."),
        EvidenceEntry(evidence_type="risk", summary="Invalidation level nearby."),
    )
    decision = AdvisoryDecision.from_dict(
        {
            "decision_id": "dec_evidence_001",
            "action": "buy",
            "confidence": 0.85,
            "risk_level": "medium",
            "reason": "Strong technical setup with diverse evidence.",
            "evidence": evidence,
            "data_confidence": {"requested_source": "okx", "resolved_source": "okx", "freshness": "fresh"},
        }
    )

    score = score_advisory_decision(decision)
    assert score.evidence_coverage_score == 0.75
    assert score.evidence_diversity_score == 1.0
