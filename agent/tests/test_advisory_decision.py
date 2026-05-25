from __future__ import annotations

import pytest

from src.advisory import AdvisoryDecision


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "decision_id": "dec_btc_001",
        "action": "hold",
        "confidence": 0.62,
        "risk_level": "medium",
        "reason": "Momentum is mixed and support has not broken.",
        "evidence": [
            {"type": "chart", "summary": "BTC remains above the prior swing low."},
        ],
        "data_confidence": {
            "requested_source": "okx",
            "resolved_source": "okx",
            "freshness": "fresh",
        },
        "advisory_only": True,
    }
    payload.update(overrides)
    return payload


def test_valid_hold_decision_roundtrips_to_dict() -> None:
    decision = AdvisoryDecision.from_dict(_payload())

    assert decision.action == "hold"
    assert decision.advisory_only is True
    assert decision.to_dict()["evidence"] == [
        {"type": "chart", "summary": "BTC remains above the prior swing low."},
    ]


@pytest.mark.parametrize("action", ["buy", "sell", "avoid"])
def test_valid_directional_actions(action: str) -> None:
    decision = AdvisoryDecision.from_dict(_payload(action=action, risk_level="high"))

    assert decision.action == action


def test_missing_risk_level_fails() -> None:
    payload = _payload()
    del payload["risk_level"]

    with pytest.raises(ValueError, match="missing required advisory decision fields: risk_level"):
        AdvisoryDecision.from_dict(payload)


def test_advisory_only_false_fails() -> None:
    with pytest.raises(ValueError, match="advisory_only must be True"):
        AdvisoryDecision.from_dict(_payload(advisory_only=False))


@pytest.mark.parametrize(
    "field_name",
    [
        "order_id",
        "broker_account",
        "broker_account_id",
        "exchange_api_key",
        "api_key",
        "secret",
        "signed_transaction",
        "transaction",
        "position_id",
    ],
)
def test_forbidden_execution_fields_fail(field_name: str) -> None:
    with pytest.raises(ValueError, match="must not include execution fields"):
        AdvisoryDecision.from_dict(_payload(**{field_name: "forbidden"}))


@pytest.mark.parametrize("confidence", [-0.1, 1.1, "not-a-number"])
def test_confidence_out_of_range_fails(confidence: object) -> None:
    with pytest.raises(ValueError, match="confidence must"):
        AdvisoryDecision.from_dict(_payload(confidence=confidence))


def test_quality_score_out_of_range_fails() -> None:
    with pytest.raises(ValueError, match="quality_score must be between 0 and 1"):
        AdvisoryDecision.from_dict(_payload(quality_score=1.2))


@pytest.mark.parametrize("field_name", ["reason", "decision_id"])
def test_required_text_fields_cannot_be_empty(field_name: str) -> None:
    with pytest.raises(ValueError, match=f"{field_name} must be a non-empty string"):
        AdvisoryDecision.from_dict(_payload(**{field_name: "  "}))


def test_evidence_must_be_non_empty_list() -> None:
    with pytest.raises(ValueError, match="evidence must be a non-empty list"):
        AdvisoryDecision.from_dict(_payload(evidence=[]))


def test_data_confidence_must_be_non_empty_mapping() -> None:
    with pytest.raises(ValueError, match="data_confidence must be a non-empty mapping"):
        AdvisoryDecision.from_dict(_payload(data_confidence={}))
