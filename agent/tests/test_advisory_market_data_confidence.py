from __future__ import annotations

import pytest

from src.advisory import (
    MARKET_DATA_FRESHNESS_LEVELS,
    AdvisoryDecision,
    MarketDataConfidence,
    score_advisory_decision,
    score_market_data_confidence,
    summarize_market_data_confidence,
)


def test_market_data_confidence_roundtrips_fresh_direct_source() -> None:
    confidence = MarketDataConfidence.from_dict(
        {
            "requested_source": " OKX ",
            "resolved_source": "OKX",
            "freshness": "fresh",
            "fallback_used": False,
            "fallback_chain": [],
            "warnings": [],
        }
    )

    assert MARKET_DATA_FRESHNESS_LEVELS == ("fresh", "current", "recent", "stale", "unknown")
    assert confidence.requested_source == "okx"
    assert confidence.resolved_source == "okx"
    assert confidence.confidence_score == 1.0
    assert confidence.to_dict() == {
        "requested_source": "okx",
        "resolved_source": "okx",
        "freshness": "fresh",
        "fallback_used": False,
        "fallback_chain": [],
        "warnings": [],
        "confidence_score": 1.0,
        "summary": "okx resolved via okx with fresh data",
    }


def test_summarize_market_data_confidence_outputs_decision_ready_dict() -> None:
    data_confidence = summarize_market_data_confidence(
        requested_source="tushare",
        resolved_source="akshare",
        freshness="recent",
        fallback_used=True,
        fallback_chain=["tushare", "akshare"],
        warnings=[" tushare unavailable ", ""],
    )
    decision = AdvisoryDecision.from_dict(
        {
            "decision_id": "dec_market_data_001",
            "action": "hold",
            "confidence": 0.71,
            "risk_level": "medium",
            "reason": "Signal is advisory-only because source fallback was used.",
            "evidence": [{"type": "data", "summary": "A-share history resolved through fallback."}],
            "data_confidence": data_confidence,
        }
    )

    assert decision.data_confidence["requested_source"] == "tushare"
    assert decision.data_confidence["resolved_source"] == "akshare"
    assert decision.data_confidence["warnings"] == ["tushare unavailable"]
    assert score_advisory_decision(decision).data_confidence_score > 0


@pytest.mark.parametrize(
    "payload, match",
    [
        ({}, "requested_source must be a non-empty string"),
        ({"requested_source": "okx", "freshness": "future"}, "freshness must be one of"),
        ({"requested_source": "okx", "fallback_used": "false"}, "fallback_used must be a bool"),
        ({"requested_source": "okx", "fallback_chain": ["okx", ""]}, "fallback_chain entries"),
        ({"requested_source": "okx", "warnings": [object()]}, "warnings entries"),
    ],
)
def test_market_data_confidence_rejects_invalid_payloads(payload: dict[str, object], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        MarketDataConfidence.from_dict(payload)


def test_market_data_confidence_rejects_non_mapping_payload() -> None:
    with pytest.raises(ValueError, match="market data confidence payload must be a mapping"):
        MarketDataConfidence.from_dict(["okx"])


def test_market_data_confidence_score_orders_source_quality() -> None:
    fresh_direct = summarize_market_data_confidence(requested_source="okx", resolved_source="okx", freshness="fresh")
    recent_fallback = summarize_market_data_confidence(
        requested_source="tushare",
        resolved_source="akshare",
        freshness="recent",
        fallback_used=True,
        fallback_chain=["tushare", "akshare"],
    )
    stale_fallback_warning = summarize_market_data_confidence(
        requested_source="tushare",
        resolved_source="akshare",
        freshness="stale",
        fallback_used=True,
        fallback_chain=["tushare", "akshare"],
        warnings=["quota exceeded"],
    )
    unresolved = summarize_market_data_confidence(requested_source="tushare", freshness="unknown")

    assert score_market_data_confidence(fresh_direct) > score_market_data_confidence(recent_fallback)
    assert score_market_data_confidence(recent_fallback) > score_market_data_confidence(stale_fallback_warning)
    assert score_market_data_confidence(stale_fallback_warning) > score_market_data_confidence(unresolved)


def test_warning_count_lowers_score_with_cap() -> None:
    no_warnings = summarize_market_data_confidence(requested_source="okx", resolved_source="okx", freshness="fresh")
    many_warnings = summarize_market_data_confidence(
        requested_source="okx",
        resolved_source="okx",
        freshness="fresh",
        warnings=["one", "two", "three", "four", "five"],
    )

    assert score_market_data_confidence(no_warnings) > score_market_data_confidence(many_warnings)
    assert many_warnings["warnings"] == ["one", "two", "three", "four", "five"]


def test_score_accepts_contract_object_or_mapping() -> None:
    confidence = MarketDataConfidence("okx", "okx", "fresh")

    assert score_market_data_confidence(confidence) == 1.0
    assert score_market_data_confidence(confidence.to_dict()) == 1.0
