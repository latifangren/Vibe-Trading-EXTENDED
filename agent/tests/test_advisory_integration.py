from __future__ import annotations

from typing import cast

from src.advisory import (
    AdvisoryDecision,
    ApprovalState,
    EvidenceEntry,
    MarketDataConfidence,
    build_evidence,
    redact_advisory_payload,
    score_advisory_decision,
    score_market_data_confidence,
    summarize_market_data_confidence,
)


def test_end_to_end_advisory_flow() -> None:
    # 1. Build structured evidence
    evidence = build_evidence(
        EvidenceEntry(evidence_type="chart", summary="Price broke above 200-day MA with volume confirmation."),
        EvidenceEntry(evidence_type="flow", summary="Spot CVD positive for 3 consecutive sessions."),
        EvidenceEntry(evidence_type="risk", summary="Invalidation at -3.2% below entry; R:R > 2.5."),
        EvidenceEntry(evidence_type="macro", summary="Fed pause priced in; no near-term rate shock expected."),
    )

    assert len(evidence) == 4
    assert all(isinstance(e, dict) and "type" in e for e in evidence)

    # 2. Summarize market data confidence
    data_confidence = summarize_market_data_confidence(
        requested_source="okx",
        resolved_source="okx",
        freshness="fresh",
    )

    confidence_score = score_market_data_confidence(data_confidence)
    assert confidence_score == 1.0

    # 3. Create advisory decision
    decision = AdvisoryDecision.from_dict(
        {
            "decision_id": "dec_integration_001",
            "action": "buy",
            "confidence": 0.88,
            "risk_level": "medium",
            "reason": "Strong multi-factor confluence with favorable macro backdrop.",
            "evidence": evidence,
            "data_confidence": data_confidence,
            "quality_score": 0.82,
        }
    )

    assert decision.action == "buy"
    assert decision.advisory_only is True

    # 4. Score signal quality
    quality = score_advisory_decision(decision)

    assert quality.final_score > 70
    assert quality.evidence_coverage_score == 1.0
    assert quality.evidence_diversity_score == 1.0
    assert quality.confidence_score == 0.88
    assert quality.model_quality_score == 0.82

    # 5. Approval workflow
    approval = ApprovalState.for_decision(decision.decision_id)

    assert approval.status == "pending"
    assert not approval.is_terminal

    approved = approval.approve(reason="Quality score above threshold; risk acceptable.", actor="risk_committee")

    assert approved.status == "approved"
    assert approved.is_terminal
    assert len(approved.audit_trail) == 1
    assert approved.audit_trail[0].actor == "risk_committee"

    # 6. Redact for export
    export_payload = decision.to_dict()
    export_payload["approval"] = approved.to_dict()
    export_payload["quality"] = quality.to_dict()

    # Inject a fake secret to prove redaction works
    export_payload["internal_api_key"] = "sk-secret-should-not-leak"

    redacted = cast(dict[str, object], redact_advisory_payload(export_payload))

    assert redacted["decision_id"] == "dec_integration_001"
    assert redacted["action"] == "buy"
    assert cast(dict[str, object], redacted["quality"])["final_score"] == quality.final_score
    assert cast(dict[str, object], redacted["approval"])["status"] == "approved"
    assert "sk-secret-should-not-leak" not in str(redacted)

    # 7. Verify MarketDataConfidence contract object also works
    confidence_obj = MarketDataConfidence("okx", "okx", "fresh")
    assert confidence_obj.confidence_score == 1.0
    assert confidence_obj.to_dict()["summary"] == "okx resolved via okx with fresh data"


def test_rejected_decision_flow() -> None:
    evidence = build_evidence(
        EvidenceEntry(evidence_type="chart", summary="No clear trend; choppy price action."),
    )

    data_confidence = summarize_market_data_confidence(
        requested_source="tushare",
        freshness="stale",
        fallback_used=False,
    )

    decision = AdvisoryDecision.from_dict(
        {
            "decision_id": "dec_integration_002",
            "action": "avoid",
            "confidence": 0.3,
            "risk_level": "high",
            "reason": "Insufficient signal clarity with stale data.",
            "evidence": evidence,
            "data_confidence": data_confidence,
        }
    )

    quality = score_advisory_decision(decision)
    assert quality.final_score < 50

    approval = ApprovalState.for_decision(decision.decision_id)
    rejected = approval.reject(reason="Quality score too low for any position.", actor="auto_gate")

    assert rejected.status == "rejected"
    assert rejected.is_terminal


def test_expired_decision_flow() -> None:
    approval = ApprovalState.for_decision("dec_integration_003")
    expired = approval.expire(reason="Decision window closed after 15 minutes.", actor="ttl_daemon")

    assert expired.status == "expired"
    assert expired.is_terminal
    assert expired.audit_trail[0].reason == "Decision window closed after 15 minutes."
