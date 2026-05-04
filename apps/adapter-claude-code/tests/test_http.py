"""Tests for adapter HTTP helpers."""
from __future__ import annotations

import io
import sys
import time
import urllib.error
import urllib.response
from http.client import HTTPMessage
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from send_event import create_event, post_envelope, wait_for_hitl_response

ENVELOPE = {
    "envelope_version": 1,
    "agent_kind": "claude-code",
    "agent_version": "0.1.0",
    "source_app": "test",
    "session_id": "s1",
    "event_type": "session.start",
    "raw_event_type": "SessionStart",
    "payload": {},
    "timestamp": 1000,
}


def _mock_response(status: int) -> MagicMock:
    """Return a context-manager mock whose .status == status."""
    resp = MagicMock()
    resp.__enter__ = lambda s: s
    resp.__exit__ = MagicMock(return_value=False)
    resp.status = status
    return resp


def test_success_path_silent(capsys):
    """200 response → returns True, no stderr output."""
    with patch("urllib.request.urlopen", return_value=_mock_response(200)):
        result = post_envelope("http://localhost:4000", ENVELOPE)
    assert result is True
    captured = capsys.readouterr()
    assert captured.err == ""


def test_connection_refused_warns_zero(capsys):
    """ConnectionRefusedError → returns False, stderr warning."""
    with patch(
        "urllib.request.urlopen",
        side_effect=urllib.error.URLError(ConnectionRefusedError()),
    ):
        result = post_envelope("http://localhost:4000", ENVELOPE)
    assert result is False
    captured = capsys.readouterr()
    assert "echo-adapter" in captured.err


def test_500_response_warns_zero(capsys):
    """HTTP 500 → returns False, stderr warning containing the status code."""
    headers = HTTPMessage()
    with patch(
        "urllib.request.urlopen",
        side_effect=urllib.error.HTTPError(
            url="http://localhost:4000/events",
            code=500,
            msg="Internal Server Error",
            hdrs=headers,
            fp=io.BytesIO(b""),
        ),
    ):
        result = post_envelope("http://localhost:4000", ENVELOPE)
    assert result is False
    captured = capsys.readouterr()
    assert "500" in captured.err


def test_non_200_2xx_returns_false(capsys):
    """Non-200 2xx (e.g. 204) is still treated as success."""
    with patch("urllib.request.urlopen", return_value=_mock_response(204)):
        result = post_envelope("http://localhost:4000", ENVELOPE)
    assert result is True


def test_timeout_within_six_seconds():
    """Adapter completes within 6 seconds even when server hangs (5s timeout)."""
    import socket

    def slow_urlopen(*args, **kwargs):
        raise urllib.error.URLError(socket.timeout("timed out"))

    start = time.monotonic()
    with patch("urllib.request.urlopen", side_effect=slow_urlopen):
        post_envelope("http://localhost:4000", ENVELOPE)
    elapsed = time.monotonic() - start
    assert elapsed < 6.0, f"Took {elapsed:.2f}s, expected < 6s"


def test_unexpected_exception_returns_false(capsys):
    """Any unexpected exception → returns False, stderr warning."""
    with patch("urllib.request.urlopen", side_effect=RuntimeError("surprise")):
        result = post_envelope("http://localhost:4000", ENVELOPE)
    assert result is False
    captured = capsys.readouterr()
    assert "echo-adapter" in captured.err


def test_create_event_returns_parsed_stored_event():
    resp = _mock_response(201)
    resp.read.return_value = b'{"id":42,"event_type":"hitl.request"}'
    with patch("urllib.request.urlopen", return_value=resp):
        result = create_event("http://localhost:4000", ENVELOPE)
    assert result == {"id": 42, "event_type": "hitl.request"}


def test_wait_for_hitl_response_retries_408_then_returns_body():
    with patch(
        "send_event._get_json",
        side_effect=[(408, None), (408, None), (200, {"permission": True})],
    ):
        status, body = wait_for_hitl_response(42, "http://localhost:4000", 5)
    assert status == "responded"
    assert body == {"permission": True}


def test_wait_for_hitl_response_timeout():
    with patch("send_event._get_json", side_effect=[(408, None), (408, None), (408, None)]):
        with patch("time.monotonic", side_effect=[0.0, 0.1, 1.1, 1.2, 2.2, 2.3, 3.3, 3.4]):
            status, body = wait_for_hitl_response(42, "http://localhost:4000", 3)
    assert status == "timeout"
    assert body is None
