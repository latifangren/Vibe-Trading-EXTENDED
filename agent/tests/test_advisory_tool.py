"""Tests for the advisory decision tool adapter."""

from __future__ import annotations

import json

from src.tools.advisory_tool import CreateAdvisoryDecisionTool


def _valid_payload() -> dict[str, object]:
    return {
        "decision_id": "dec_tool_001",
        "action": "buy",
        "confidence": 0.85,
        "risk_level": "medium",
        "reason": "Strong breakout with volume confirmation.",
        "evidence": [
            {"type": "chart", "summary": "Price above 200-day MA."},
            {"type": "flow", "summary": "Spot CVD positive."},
        ],
        "data_confidence": {
            "requested_source": "okx",
            "resolved_source": "okx",
            "freshness": "fresh",
        },
    }


def test_tool_metadata() -> None:
    tool = CreateAdvisoryDecisionTool()

    assert tool.name == "create_advisory_decision"
    assert tool.is_readonly is False
    assert "advisory" in tool.description.lower()


def test_tool_creates_decision_with_quality_and_approval() -> None:
    tool = CreateAdvisoryDecisionTool()
    result = json.loads(tool.execute(**_valid_payload()))

    assert result["status"] == "ok"
    assert result["decision"]["decision_id"] == "dec_tool_001"
    assert result["decision"]["action"] == "buy"
    assert result["decision"]["advisory_only"] is True
    assert result["quality"]["final_score"] > 0
    assert result["approval"]["status"] == "pending"
    assert result["approval"]["decision_id"] == "dec_tool_001"


def test_tool_with_optional_quality_score() -> None:
    tool = CreateAdvisoryDecisionTool()
    payload = _valid_payload()
    payload["quality_score"] = 0.9

    result = json.loads(tool.execute(**payload))

    assert result["status"] == "ok"
    assert result["quality"]["model_quality_score"] == 0.9


def test_tool_with_linked_hypothesis() -> None:
    tool = CreateAdvisoryDecisionTool()
    payload = _valid_payload()
    payload["linked_hypothesis_id"] = "hyp_abc_123"

    result = json.loads(tool.execute(**payload))

    assert result["status"] == "ok"
    assert result["decision"]["linked_hypothesis_id"] == "hyp_abc_123"


def test_tool_rejects_invalid_action() -> None:
    tool = CreateAdvisoryDecisionTool()
    payload = _valid_payload()
    payload["action"] = "yolo"

    result = json.loads(tool.execute(**payload))

    assert result["status"] == "error"
    assert "action must be one of" in result["error"]


def test_tool_rejects_missing_required_fields() -> None:
    tool = CreateAdvisoryDecisionTool()
    result = json.loads(tool.execute(decision_id="dec_tool_002"))

    assert result["status"] == "error"
    assert "missing required" in result["error"] or "must be" in result["error"]


def test_tool_rejects_execution_fields() -> None:
    tool = CreateAdvisoryDecisionTool()
    payload = _valid_payload()
    payload["api_key"] = "secret-key"

    result = json.loads(tool.execute(**payload))

    assert result["status"] == "error"
    assert "execution fields" in result["error"]


def test_tool_rejects_confidence_out_of_range() -> None:
    tool = CreateAdvisoryDecisionTool()
    payload = _valid_payload()
    payload["confidence"] = 1.5

    result = json.loads(tool.execute(**payload))

    assert result["status"] == "error"
    assert "between 0 and 1" in result["error"]
