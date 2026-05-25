from __future__ import annotations

import re
from typing import cast

_SENTINEL = "<redacted>"
_SENSITIVE_KEYS = {
    "account_id",
    "account_number",
    "acct_no",
    "api_key",
    "api_token",
    "authorization",
    "bearer_token",
    "broker_account",
    "broker_account_id",
    "client_id",
    "client_secret",
    "exchange_api_key",
    "password",
    "private_key",
    "refresh_token",
    "secret",
    "token",
    "access_token",
    "x-api-key",
    "x_api_key",
}
_NORMALIZED_SENSITIVE_KEYS = {item.replace("-", "_") for item in _SENSITIVE_KEYS}
_AUTHORIZATION_RE = re.compile(
    r"(?P<prefix>\bauthorization\s*[:=]\s*)(?P<quote>[\"']?)"
    + r"(?P<value>(?:[A-Za-z][A-Za-z0-9_-]*\s+)?[^\s,;\"']+)(?P=quote)",
    re.IGNORECASE,
)
_ASSIGNED_SECRET_RE = re.compile(
    r"(?P<prefix>\b(?:api[_-]?key|x-api-key|access_token|refresh_token|bearer_token|client_secret|"
    + r"private_key|password|secret|token|broker_account(?:_id)?|account_id|account_number|"
    + r"acct_no|client_id)\s*[:=]\s*)"
    + r"(?P<quote>[\"']?)(?P<value>[^\s,;\"']+)(?P=quote)",
    re.IGNORECASE,
)
_STANDALONE_CREDENTIAL_RES = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bghp_[A-Za-z0-9]{20,}\b"),
)


def redact_advisory_text(text: object) -> str:
    if text is None:
        return ""
    redacted = text if isinstance(text, str) else str(text)
    if not redacted:
        return redacted
    redacted = _AUTHORIZATION_RE.sub(_redact_assignment, redacted)
    redacted = _ASSIGNED_SECRET_RE.sub(_redact_assignment, redacted)
    for pattern in _STANDALONE_CREDENTIAL_RES:
        redacted = pattern.sub(_SENTINEL, redacted)
    return redacted


def redact_advisory_payload(payload: object) -> object:
    if isinstance(payload, dict):
        redacted: dict[object, object] = {}
        for key, value in cast(dict[object, object], payload).items():
            if isinstance(key, str) and _is_sensitive_key(key):
                redacted[key] = _SENTINEL
            else:
                redacted[key] = redact_advisory_payload(value)
        return redacted
    if isinstance(payload, list):
        return [redact_advisory_payload(value) for value in cast(list[object], payload)]
    if isinstance(payload, tuple):
        return tuple(redact_advisory_payload(value) for value in cast(tuple[object, ...], payload))
    if isinstance(payload, str):
        return redact_advisory_text(payload)
    return payload


def _is_sensitive_key(key: str) -> bool:
    return key.strip().lower().replace("-", "_") in _NORMALIZED_SENSITIVE_KEYS


def _redact_assignment(match: re.Match[str]) -> str:
    prefix = match.group("prefix")
    quote = match.group("quote")
    return f"{prefix}{quote}{_SENTINEL}{quote}"
