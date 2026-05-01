"""Tests for resolve_config() — priority order: CLI flag > env var > default."""
from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from send_event import DEFAULT_SERVER_URL, resolve_config


def _args(source_app=None, server_url=None):
    ns = argparse.Namespace()
    ns.source_app = source_app
    ns.server_url = server_url
    return ns


def test_cli_flag_overrides_env():
    """CLI flag beats env var for both source_app and server_url."""
    args = _args(source_app="cli-app", server_url="http://cli-host:9000")
    env = {"ECHO_SOURCE_APP": "env-app", "ECHO_SERVER_URL": "http://env-host:8000"}
    url, app = resolve_config(args, env)
    assert url == "http://cli-host:9000"
    assert app == "cli-app"


def test_env_used_when_no_flag():
    """Env vars used when CLI flags are absent."""
    args = _args()
    env = {"ECHO_SOURCE_APP": "my-backend", "ECHO_SERVER_URL": "http://remote:4000"}
    url, app = resolve_config(args, env)
    assert url == "http://remote:4000"
    assert app == "my-backend"


def test_default_server_url():
    """Default URL applied when neither flag nor env var is set."""
    args = _args()
    url, _ = resolve_config(args, {})
    assert url == DEFAULT_SERVER_URL


def test_missing_source_app_returns_none():
    """source_app is None when neither flag nor env var is set."""
    args = _args()
    _, app = resolve_config(args, {})
    assert app is None


def test_missing_source_app_warns_and_exits_zero(capsys, monkeypatch):
    """_main() warns to stderr and returns (without posting) when source_app is missing."""
    from send_event import _main

    monkeypatch.setattr("sys.argv", ["send_event.py", "--event-type", "SessionStart"])
    monkeypatch.delenv("ECHO_SOURCE_APP", raising=False)
    monkeypatch.delenv("ECHO_SERVER_URL", raising=False)

    with patch("sys.stdin", io.TextIOWrapper(io.BytesIO(b'{"session_id": "s1"}'))):
        with patch("send_event.post_envelope") as mock_post:
            _main()  # must return without raising
            mock_post.assert_not_called()

    captured = capsys.readouterr()
    assert "source_app" in captured.err
