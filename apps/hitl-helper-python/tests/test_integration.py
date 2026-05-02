"""Integration tests for echo_hitl — require a running echo server.

Run with:
    cd apps/hitl-helper-python
    pytest tests/test_integration.py -v

The echo server must be running at http://localhost:4000.
Skip these tests in CI if the server is not available.
"""

from __future__ import annotations

import sys
import os
import json
import threading
import time
import urllib.request

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from echo_hitl import ask_permission, HitlOutcome

ECHO_URL = os.environ.get("ECHO_SERVER_URL", "http://localhost:4000")


def _server_available() -> bool:
    try:
        with urllib.request.urlopen(ECHO_URL + "/health", timeout=2):
            return True
    except Exception:
        return False


# Skip all integration tests if the server is not running
pytestmark = pytest.mark.skipif(
    not _server_available(),
    reason="Echo server not available at " + ECHO_URL,
)


def _respond_to_event(event_id: int, permission: bool, delay: float = 0.1) -> None:
    """POST a response to the echo server after *delay* seconds."""
    time.sleep(delay)
    body = json.dumps({"permission": permission}).encode("utf-8")
    req = urllib.request.Request(
        f"{ECHO_URL}/events/{event_id}/respond",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception as exc:
        print(f"[integration] respond failed: {exc}", file=sys.stderr)


def _get_latest_pending_event_id() -> int | None:
    """Get the most recently created pending HITL event ID (for test teardown/helper)."""
    try:
        with urllib.request.urlopen(f"{ECHO_URL}/events?limit=1", timeout=5) as resp:
            data = json.loads(resp.read())
            events = data if isinstance(data, list) else data.get("events", [])
            if events:
                return events[0].get("id")
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# 8.1 ask_permission with responder thread → GRANTED
# ---------------------------------------------------------------------------

class TestAskPermissionGranted:
    def test_granted_when_human_responds_true(self):
        """Responder thread approves after 100ms; assert GRANTED."""
        # We need the event_id to respond — use a wrapper that captures it
        created_ids: list[int] = []
        original_post = __import__("echo_hitl")._post_json

        def capturing_post(url, body, timeout=5):
            status, resp_body = original_post(url, body, timeout=timeout)
            if status in (200, 201) and resp_body and "id" in resp_body:
                created_ids.append(resp_body["id"])
            return status, resp_body

        import echo_hitl
        import unittest.mock as mock

        with mock.patch.object(echo_hitl, "_post_json", side_effect=capturing_post):
            # Start poll in main thread, respond in background after 100ms
            result_holder: list[HitlOutcome] = []

            def do_ask():
                outcome = ask_permission(
                    "Allow deploy?",
                    source_app="integration-test",
                    session_id="test-session-granted",
                    server_url=ECHO_URL,
                    timeout=30,
                )
                result_holder.append(outcome)

            ask_thread = threading.Thread(target=do_ask)
            ask_thread.start()

            # Wait for the event to be created
            deadline = time.monotonic() + 5
            while not created_ids and time.monotonic() < deadline:
                time.sleep(0.05)

            assert created_ids, "Event was not created within 5s"
            event_id = created_ids[0]

            # Respond with approval
            _respond_to_event(event_id, permission=True, delay=0.1)
            ask_thread.join(timeout=15)

        assert result_holder, "ask_permission did not return"
        assert result_holder[0] == HitlOutcome.GRANTED


# ---------------------------------------------------------------------------
# 8.2 ask_permission with timeout=2, no responder → TIMEOUT
# ---------------------------------------------------------------------------

class TestAskPermissionTimeout:
    def test_timeout_when_no_response(self):
        """No responder; expect TIMEOUT within ~2.5s."""
        start = time.monotonic()
        result = ask_permission(
            "Allow deploy?",
            source_app="integration-test",
            session_id="test-session-timeout",
            server_url=ECHO_URL,
            timeout=2,
        )
        elapsed = time.monotonic() - start

        assert result == HitlOutcome.TIMEOUT
        # Should complete within reasonable time (timeout + server wait + margin)
        assert elapsed < 10, f"Took too long: {elapsed:.1f}s"


# ---------------------------------------------------------------------------
# 8.3 ask_permission with no server running → ERROR
# ---------------------------------------------------------------------------

class TestAskPermissionNoServer:
    def test_error_when_server_unreachable(self):
        """Point at a port with nothing listening; expect ERROR fast."""
        start = time.monotonic()
        result = ask_permission(
            "Allow deploy?",
            source_app="integration-test",
            session_id="test-session-error",
            server_url="http://localhost:19999",  # nothing here
            timeout=60,
        )
        elapsed = time.monotonic() - start

        assert result == HitlOutcome.ERROR
        # POST timeout is 5s; should complete well within 10s
        assert elapsed < 10, f"Took too long: {elapsed:.1f}s"
