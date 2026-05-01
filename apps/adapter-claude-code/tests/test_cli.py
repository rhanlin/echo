"""Tests for main() / _main() CLI entry point."""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from send_event import _main, main

VALID_PAYLOAD = {"session_id": "sess-001", "cwd": "/repo"}


def _stdin(payload: dict) -> io.TextIOWrapper:
    return io.TextIOWrapper(io.BytesIO(json.dumps(payload).encode()))


def test_unknown_event_type_warns_zero(capsys):
    """Unknown --event-type logs a warning and returns (never raises)."""
    with patch("sys.argv", ["send_event.py", "--event-type", "Bogus",
                             "--source-app", "test"]):
        with patch("sys.stdin", _stdin(VALID_PAYLOAD)):
            _main()
    captured = capsys.readouterr()
    assert "unknown" in captured.err.lower() or "Bogus" in captured.err


def test_malformed_stdin_warns_zero(capsys):
    """Non-JSON on stdin logs a warning and returns (never raises)."""
    with patch("sys.argv", ["send_event.py", "--event-type", "SessionStart",
                             "--source-app", "test"]):
        with patch("sys.stdin", io.TextIOWrapper(io.BytesIO(b"not json at all"))):
            _main()
    captured = capsys.readouterr()
    assert "echo-adapter" in captured.err


def test_main_always_exits_zero(monkeypatch):
    """main() wrapper always calls sys.exit(0) even on unexpected errors."""
    monkeypatch.setattr("sys.argv", ["send_event.py", "--event-type", "SessionStart",
                                      "--source-app", "test"])
    with patch("sys.stdin", _stdin(VALID_PAYLOAD)):
        with patch("send_event.post_envelope", side_effect=RuntimeError("boom")):
            with pytest.raises(SystemExit) as exc:
                main()
    assert exc.value.code == 0


def test_full_pipeline_happy_path(capsys):
    """Full pipeline: valid payload → post called → no stderr."""
    with patch("sys.argv", ["send_event.py", "--event-type", "PreToolUse",
                             "--source-app", "test-app",
                             "--server-url", "http://localhost:4000"]):
        with patch("sys.stdin", _stdin({"session_id": "s1", "tool_name": "Bash", "cwd": "/x"})):
            with patch("send_event.post_envelope", return_value=True) as mock_post:
                _main()

    mock_post.assert_called_once()
    envelope = mock_post.call_args[0][1]
    assert envelope["event_type"] == "tool.pre_use"
    assert envelope["raw_event_type"] == "PreToolUse"
    assert envelope["source_app"] == "test-app"
    assert envelope["payload"]["tool_name"] == "Bash"
    captured = capsys.readouterr()
    assert captured.err == ""
