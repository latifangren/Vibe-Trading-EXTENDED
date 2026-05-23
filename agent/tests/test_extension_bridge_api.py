from __future__ import annotations

import importlib
import importlib.util
import os
import sys
from pathlib import Path
from types import ModuleType
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _load_api_server() -> ModuleType:
    existing = sys.modules.get("api_server")
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location("api_server", Path(__file__).parents[1] / "api_server.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("api_server module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules["api_server"] = module
    spec.loader.exec_module(module)
    return module


api_server = _load_api_server()


CONFIGURED_EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
UNCONFIGURED_EXTENSION_ORIGIN = "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
EXTENSION_CORS_ORIGINS = f"{CONFIGURED_EXTENSION_ORIGIN},http://127.0.0.1:5899"


def _remote_client() -> TestClient:
    app = cast(FastAPI, api_server.app)
    return TestClient(app, client=("203.0.113.10", 50000))


@pytest.fixture(autouse=True)
def clear_bridge_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("API_AUTH_KEY", raising=False)
    monkeypatch.delenv("ENABLE_SESSION_RUNTIME", raising=False)
    monkeypatch.setattr(api_server, "_API_KEY", "")
    monkeypatch.setattr(api_server, "_session_service", None)


def _restore_api_server_cors(monkeypatch: pytest.MonkeyPatch, original: str | None) -> None:
    if original is None:
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
    else:
        monkeypatch.setenv("CORS_ORIGINS", original)
    _ = importlib.reload(api_server)
    monkeypatch.setattr(api_server, "_API_KEY", os.getenv("API_AUTH_KEY") or "")
    monkeypatch.setattr(api_server, "_session_service", None)


def _test_client_for_current_app() -> TestClient:
    app = cast(FastAPI, api_server.app)
    return TestClient(app)


def test_configured_chrome_extension_origin_is_allowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_cors_origins = os.getenv("CORS_ORIGINS")
    monkeypatch.setenv("CORS_ORIGINS", EXTENSION_CORS_ORIGINS)
    try:
        _ = importlib.reload(api_server)
        response = _test_client_for_current_app().options(
            "/sessions",
            headers={
                "Origin": CONFIGURED_EXTENSION_ORIGIN,
                "Access-Control-Request-Method": "POST",
            },
        )

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == CONFIGURED_EXTENSION_ORIGIN
        assert response.headers["access-control-allow-credentials"] == "true"
    finally:
        _restore_api_server_cors(monkeypatch, original_cors_origins)


def test_unconfigured_chrome_extension_origin_is_not_echoed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_cors_origins = os.getenv("CORS_ORIGINS")
    monkeypatch.setenv("CORS_ORIGINS", EXTENSION_CORS_ORIGINS)
    try:
        _ = importlib.reload(api_server)
        response = _test_client_for_current_app().options(
            "/sessions",
            headers={
                "Origin": UNCONFIGURED_EXTENSION_ORIGIN,
                "Access-Control-Request-Method": "POST",
            },
        )

        assert response.status_code == 400
        assert response.headers.get("access-control-allow-origin") != UNCONFIGURED_EXTENSION_ORIGIN
    finally:
        _restore_api_server_cors(monkeypatch, original_cors_origins)


def test_wildcard_cors_origins_still_raise_on_reload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_cors_origins = os.getenv("CORS_ORIGINS")
    monkeypatch.setenv("CORS_ORIGINS", "*")
    try:
        with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
            _ = importlib.reload(api_server)
    finally:
        _restore_api_server_cors(monkeypatch, original_cors_origins)


def test_mvp_session_endpoint_contract_is_unchanged() -> None:
    routes: set[tuple[str, str]] = set()
    app = cast(FastAPI, api_server.app)
    for route in app.routes:
        path = getattr(route, "path", "")
        methods = getattr(route, "methods", ())
        if isinstance(path, str) and isinstance(methods, set):
            method_names = cast(set[object], methods)
            for method in method_names:
                if isinstance(method, str):
                    routes.add((method, path))

    assert ("POST", "/sessions") in routes
    assert ("POST", "/sessions/{session_id}/messages") in routes
    assert ("POST", "/sessions/{session_id}/cancel") in routes
    assert ("GET", "/sessions/{session_id}/messages") in routes
    assert ("GET", "/sessions/{session_id}/events") in routes


def test_json_session_endpoint_requires_bearer_when_api_key_is_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("API_AUTH_KEY", "secret")
    monkeypatch.setenv("ENABLE_SESSION_RUNTIME", "false")
    monkeypatch.setattr(api_server, "_API_KEY", "secret")
    client = _remote_client()

    missing = client.post("/sessions", json={})
    wrong = client.post("/sessions", json={}, headers={"Authorization": "Bearer wrong"})
    query_token = client.post("/sessions?api_key=secret", json={})
    correct = client.post("/sessions", json={}, headers={"Authorization": "Bearer secret"})

    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert query_token.status_code == 401
    assert correct.status_code == 501
    assert correct.json()["detail"] == "Session runtime not enabled"


def test_sse_session_endpoint_accepts_query_api_key_only_when_correct(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("API_AUTH_KEY", "secret")
    monkeypatch.setenv("ENABLE_SESSION_RUNTIME", "false")
    monkeypatch.setattr(api_server, "_API_KEY", "secret")
    client = _remote_client()

    missing = client.get("/sessions/missing/events")
    wrong = client.get("/sessions/missing/events?api_key=wrong")
    correct = client.get("/sessions/missing/events?api_key=secret")

    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert correct.status_code == 501
    assert correct.json()["detail"] == "Session runtime not enabled"
