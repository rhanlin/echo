"""Unit tests for echo_hitl module.

All tests mock HTTP calls — no running server required.
"""

from __future__ import annotations

import sys
import os
import json
import time
from unittest.mock import patch, MagicMock

# Ensure we can import echo_hitl from parent directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import echo_hitl
from echo_hitl import (
    HitlOutcome,
    _build_envelope,
    _poll_response,
    ask_permission,
    ask_question,
    ask_choice,
)


# ---------------------------------------------------------------------------
# 3.2 Envelope structure
# ---------------------------------------------------------------------------

class TestBuildEnvelope:
    def test_required_top_level_fields(self):
        env = _build_envelope(
            question="Allow?",
            hitl_type="permission",
            choices=None,
            source_app="my-app",
            session_id="sess-1",
            agent_kind="claude-code",
            timeout=300,
        )
        assert env["envelope_version"] == 1
        assert env["agent_kind"] == "claude-code"
        assert env["agent_version"] == echo_hitl.AGENT_VERSION
        assert env["source_app"] == "my-app"
        assert env["session_id"] == "sess-1"
        assert env["event_type"] == "hitl.request"
        assert env["raw_event_type"] == "HumanInTheLoop"
        assert isinstance(env["timestamp"], int)
        assert env["payload"] == {}

    def test_human_in_the_loop_block(self):
        env = _build_envelope("Allow?", "permission", None, "app", "s1", "claude-code", 60)
        hitl = env["human_in_the_loop"]
        assert hitl["question"] == "Allow?"
        assert hitl["type"] == "permission"
        assert hitl["timeout"] == 60
        assert hitl["callback"] == {"kind": "polling"}
        assert "choices" not in hitl

    def test_choices_included_when_provided(self):
        env = _build_envelope("Pick?", "choice", ["A", "B"], "app", "s1", "claude-code", 60)
        hitl = env["human_in_the_loop"]
        assert hitl["choices"] == ["A", "B"]

    def test_callback_has_no_url(self):
        env = _build_envelope("Allow?", "permission", None, "app", "s1", "claude-code", 60)
        callback = env["human_in_the_loop"]["callback"]
        assert callback == {"kind": "polling"}
        assert "url" not in callback


# ---------------------------------------------------------------------------
# 4.2 Poll loop — 408 twice then 200
# ---------------------------------------------------------------------------

class TestPollResponse:
    def _make_response(self, status: int, body: dict | None):
        """Create a mock (status, body) pair for _get_json."""
        return (status, body)

    def test_retries_408_then_returns_200(self):
        responses = [
            (408, None),
            (408, None),
            (200, {"permission": True}),
        ]
        call_count = 0

        def fake_get_json(url, timeout):
            nonlocal call_count
            r = responses[call_count]
            call_count += 1
            return r

        with patch("echo_hitl._get_json", side_effect=fake_get_json):
            outcome, body = _poll_response(event_id=1, server_url="http://localhost:4000", timeout=300)

        assert outcome == HitlOutcome.GRANTED
        assert body == {"permission": True}
        assert call_count == 3

    def test_timeout_when_only_408(self):
        """Return TIMEOUT once deadline passes even with only 408 responses."""
        start = time.monotonic()

        def fake_get_json(url, timeout):
            # Simulate server returning 408 quickly
            return (408, None)

        with patch("echo_hitl._get_json", side_effect=fake_get_json):
            outcome, body = _poll_response(event_id=1, server_url="http://localhost:4000", timeout=1)

        assert outcome == HitlOutcome.TIMEOUT
        assert body is None
        # Should complete within ~2s
        assert time.monotonic() - start < 5

    def test_error_on_status_0(self):
        def fake_get_json(url, timeout):
            return (0, None)

        with patch("echo_hitl._get_json", side_effect=fake_get_json):
            outcome, body = _poll_response(event_id=1, server_url="http://localhost:4000", timeout=300)

        assert outcome == HitlOutcome.ERROR
        assert body is None

    def test_error_on_unexpected_status(self):
        def fake_get_json(url, timeout):
            return (500, None)

        with patch("echo_hitl._get_json", side_effect=fake_get_json):
            outcome, body = _poll_response(event_id=1, server_url="http://localhost:4000", timeout=300)

        assert outcome == HitlOutcome.ERROR


# ---------------------------------------------------------------------------
# 5.4–5.8 Public API unit tests
# ---------------------------------------------------------------------------

def _make_post_mock(status: int, body: dict | None):
    def fake_post(url, data, timeout=5):
        return (status, body)
    return fake_post


def _make_poll_mock(poll_status: int, poll_body: dict | None):
    """Returns a fake _get_json that always returns the given status/body."""
    def fake_get(url, timeout):
        return (poll_status, poll_body)
    return fake_get


class TestAskPermission:
    def test_granted(self):
        with patch("echo_hitl._post_json", return_value=(201, {"id": 1})):
            with patch("echo_hitl._get_json", return_value=(200, {"permission": True})):
                result = ask_permission("Allow?", source_app="app", session_id="s1")
        assert result == HitlOutcome.GRANTED

    def test_denied(self):
        with patch("echo_hitl._post_json", return_value=(201, {"id": 1})):
            with patch("echo_hitl._get_json", return_value=(200, {"permission": False})):
                result = ask_permission("Allow?", source_app="app", session_id="s1")
        assert result == HitlOutcome.DENIED

    def test_post_failure_returns_error(self):
        with patch("echo_hitl._post_json", return_value=(0, None)):
            result = ask_permission("Allow?", source_app="app", session_id="s1")
        assert result == HitlOutcome.ERROR

    def test_post_returns_non_2xx_returns_error(self):
        with patch("echo_hitl._post_json", return_value=(500, {"error": "server error"})):
            result = ask_permission("Allow?", source_app="app", session_id="s1")
        assert result == HitlOutcome.ERROR

    def test_no_id_in_post_response_returns_error(self):
        with patch("echo_hitl._post_json", return_value=(201, {"data": "no id"})):
            result = ask_permission("Allow?", source_app="app", session_id="s1")
        assert result == HitlOutcome.ERROR


class TestAskQuestion:
    def test_returns_answer_string(self):
        with patch("echo_hitl._post_json", return_value=(201, {"id": 42})):
            with patch("echo_hitl._get_json", return_value=(200, {"response": "main"})):
                result = ask_question("What branch?", source_app="app", session_id="s1")
        assert result == "main"

    def test_returns_none_on_timeout(self):
        with patch("echo_hitl._post_json", return_value=(201, {"id": 42})):
            with patch("echo_hitl._get_json", return_value=(408, None)):
                result = ask_question("What branch?", source_app="app", session_id="s1", timeout=1)
        assert result is None

    def test_returns_none_on_post_failure(self):
        with patch("echo_hitl._post_json", return_value=(0, None)):
            result = ask_question("What branch?", source_app="app", session_id="s1")
        assert result is None


class TestAskChoice:
    def test_returns_selected_choice(self):
        with patch("echo_hitl._post_json", return_value=(201, {"id": 7})):
            with patch("echo_hitl._get_json", return_value=(200, {"choice": "Vitest"})):
                result = ask_choice("Framework?", ["Jest", "Vitest"], source_app="app", session_id="s1")
        assert result == "Vitest"

    def test_returns_none_on_timeout(self):
        with patch("echo_hitl._post_json", return_value=(201, {"id": 7})):
            with patch("echo_hitl._get_json", return_value=(408, None)):
                result = ask_choice("Framework?", ["Jest", "Vitest"], source_app="app", session_id="s1", timeout=1)
        assert result is None

    def test_choices_included_in_envelope(self):
        """Ensure the envelope sent to POST includes choices."""
        posted_envelopes = []

        def fake_post(url, body, timeout=5):
            posted_envelopes.append(body)
            return (201, {"id": 1})

        with patch("echo_hitl._post_json", side_effect=fake_post):
            with patch("echo_hitl._get_json", return_value=(200, {"choice": "Jest"})):
                ask_choice("Framework?", ["Jest", "Vitest"], source_app="app", session_id="s1")

        assert len(posted_envelopes) == 1
        hitl = posted_envelopes[0]["human_in_the_loop"]
        assert hitl["choices"] == ["Jest", "Vitest"]
        assert hitl["type"] == "choice"


# ---------------------------------------------------------------------------
# HitlOutcome enum
# ---------------------------------------------------------------------------

class TestHitlOutcomeEnum:
    def test_all_members_accessible(self):
        assert HitlOutcome.GRANTED.value == "granted"
        assert HitlOutcome.DENIED.value == "denied"
        assert HitlOutcome.TIMEOUT.value == "timeout"
        assert HitlOutcome.ERROR.value == "error"

    def test_clean_import(self):
        """Verify stdlib-only: no import error in bare environment."""
        import importlib
        mod = importlib.import_module("echo_hitl")
        assert hasattr(mod, "ask_permission")
        assert hasattr(mod, "ask_question")
        assert hasattr(mod, "ask_choice")
        assert hasattr(mod, "HitlOutcome")
