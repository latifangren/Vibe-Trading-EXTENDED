from __future__ import annotations

from src.advisory import redact_advisory_payload, redact_advisory_text


def test_redact_text_handles_empty_and_non_string_values() -> None:
    assert redact_advisory_text(None) == ""
    assert redact_advisory_text(42) == "42"
    assert redact_advisory_text("") == ""


def test_redact_text_masks_inline_credentials_and_bearer_headers() -> None:
    text = (
        "Authorization: Bearer session-secret-value "
        "api_key=sk-abcdefghijklmnopqrst "
        "client_secret='oauth-private-value' "
        "broker_account_id=broker-001"
    )

    redacted = redact_advisory_text(text)

    assert "session-secret-value" not in redacted
    assert "sk-abcdefghijklmnopqrst" not in redacted
    assert "oauth-private-value" not in redacted
    assert "broker-001" not in redacted
    assert redacted.count("<redacted>") == 4


def test_redact_text_masks_strong_standalone_credential_shapes() -> None:
    redacted = redact_advisory_text("Keys found: sk-abcdefghijklmnopqrst and ghp_abcdefghijklmnopqrstuvwxyz123456")

    assert "sk-abcdefghijklmnopqrst" not in redacted
    assert "ghp_abcdefghijklmnopqrstuvwxyz123456" not in redacted
    assert redacted.count("<redacted>") == 2


def test_redact_text_masks_quoted_and_basic_authorization_headers() -> None:
    redacted = redact_advisory_text('Authorization="Bearer quoted-secret" authorization: Basic encoded-secret')

    assert redacted == 'Authorization="<redacted>" authorization: <redacted>'


def test_redact_payload_copies_nested_structures_and_sensitive_fields() -> None:
    payload: dict[str, object] = {
        "decision_id": "dec_safe_001",
        "api_key": "top-secret-key",
        "headers": {"Authorization": "Bearer auth-secret", "Content-Type": "application/json"},
        "evidence": [
            {"summary": "RSI remains neutral.", "access_token": "nested-access-token"},
            {"account_id": "ACC-9988", "confidence": 0.7},
        ],
        "metadata": ("safe", {"x-api-key": "nested-key"}),
    }

    redacted = redact_advisory_payload(payload)

    assert redacted == {
        "decision_id": "dec_safe_001",
        "api_key": "<redacted>",
        "headers": {"Authorization": "<redacted>", "Content-Type": "application/json"},
        "evidence": [
            {"summary": "RSI remains neutral.", "access_token": "<redacted>"},
            {"account_id": "<redacted>", "confidence": 0.7},
        ],
        "metadata": ("safe", {"x-api-key": "<redacted>"}),
    }
    assert payload["api_key"] == "top-secret-key"
    assert payload["headers"] == {"Authorization": "Bearer auth-secret", "Content-Type": "application/json"}


def test_redact_payload_is_idempotent() -> None:
    payload = {"refresh_token": "secret-refresh", "note": "Authorization: Bearer note-secret"}

    once = redact_advisory_payload(payload)

    assert redact_advisory_payload(once) == once


def test_redaction_preserves_normal_advisory_prose() -> None:
    text = "Account for risk before entry; tokenization is not token leakage; secret sauce is diversification."
    payload = {
        "summary": text,
        "symbol": "BTC-USDT",
        "confidence": 0.72,
        "token_usage": {"input_tokens": 25},
    }

    assert redact_advisory_text(text) == text
    assert redact_advisory_payload(payload) == payload
