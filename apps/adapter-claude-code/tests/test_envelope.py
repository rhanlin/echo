"""Tests for envelope assembly: build_envelope(), extract_normalized(), extract_model_name()."""
from __future__ import annotations

import io
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from send_event import (
    AGENT_KIND,
    AGENT_VERSION,
    build_envelope,
    build_permission_question,
    extract_normalized,
)

REQUIRED_FIELDS = {
    "envelope_version",
    "agent_kind",
    "agent_version",
    "source_app",
    "session_id",
    "event_type",
    "raw_event_type",
    "payload",
    "timestamp",
}

ALL_HOOK_NAMES = [
    "SessionStart", "SessionEnd", "UserPromptSubmit",
    "PreToolUse", "PostToolUse", "PostToolUseFailure",
    "Notification", "Stop", "PreCompact",
    "SubagentStart", "SubagentStop", "PermissionRequest",
]

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> dict:
    with open(FIXTURES_DIR / f"{name}.json") as fh:
        return json.load(fh)


def test_envelope_shape_per_hook():
    """Every fixture must produce an envelope with all required v1 fields."""
    for hook_name in ALL_HOOK_NAMES:
        payload = load_fixture(hook_name)
        env = build_envelope(payload, hook_name, "test-app")
        missing = REQUIRED_FIELDS - set(env.keys())
        assert not missing, f"{hook_name}: missing fields {missing}"
        # Type checks
        assert isinstance(env["envelope_version"], int)
        assert isinstance(env["agent_kind"], str)
        assert isinstance(env["agent_version"], str)
        assert isinstance(env["source_app"], str)
        assert isinstance(env["session_id"], str)
        assert isinstance(env["event_type"], str)
        assert isinstance(env["raw_event_type"], str)
        assert isinstance(env["payload"], dict)
        assert isinstance(env["timestamp"], int)


def test_payload_preserved_verbatim():
    """envelope['payload'] must be identical to the input dict."""
    payload = load_fixture("PreToolUse")
    env = build_envelope(payload, "PreToolUse", "test-app")
    assert env["payload"] is payload


def test_raw_event_type_preserved():
    """raw_event_type must be the exact --event-type arg."""
    payload = load_fixture("PermissionRequest")
    env = build_envelope(payload, "PermissionRequest", "test-app")
    assert env["raw_event_type"] == "PermissionRequest"


def test_permission_request_maps_to_hitl_request():
    """PermissionRequest envelope must have event_type=hitl.request."""
    payload = load_fixture("PermissionRequest")
    env = build_envelope(payload, "PermissionRequest", "test-app")
    assert env["event_type"] == "hitl.request"


def test_permission_request_adds_human_in_the_loop_block():
    payload = load_fixture("PermissionRequest")
    env = build_envelope(payload, "PermissionRequest", "test-app")
    assert env["human_in_the_loop"] == {
        "question": "Allow Claude Code to run Bash: rm -rf /tmp/old?",
        "type": "permission",
        "callback": {"kind": "polling"},
    }


def test_pre_tool_use_does_not_add_human_in_the_loop():
    payload = load_fixture("PreToolUse")
    env = build_envelope(payload, "PreToolUse", "test-app")
    assert "human_in_the_loop" not in env


def test_build_permission_question_prefers_file_path_when_present():
    payload = {
        "tool_name": "Write",
        "tool_input": {"file_path": "/repo/src/App.tsx"},
    }
    assert (
        build_permission_question(payload)
        == "Allow Claude Code to use Write on /repo/src/App.tsx?"
    )


def test_normalized_omitted_when_empty():
    """Fixtures with no extractable fields must produce no 'normalized' key."""
    # Stop.json has no tool_name, cwd, or transcript_path that resolves to a file
    payload = load_fixture("Stop")
    payload_copy = dict(payload)
    payload_copy.pop("transcript_path", None)  # ensure no transcript
    env = build_envelope(payload_copy, "Stop", "test-app")
    assert "normalized" not in env


def test_normalized_populated_when_available():
    """Fixture with tool_name and cwd must populate normalized block."""
    payload = load_fixture("PreToolUse")
    env = build_envelope(payload, "PreToolUse", "test-app")
    assert "normalized" in env
    assert env["normalized"]["tool_name"] == "Bash"
    assert env["normalized"]["cwd"] == "/repo"


def test_missing_session_id_exits_zero(capsys):
    """_main() must warn and return (without posting) when session_id is absent."""
    from send_event import _main

    bad_payload = {"tool_name": "Bash"}  # no session_id
    with patch("sys.argv", ["send_event.py", "--event-type", "PreToolUse",
                             "--source-app", "test-app"]):
        with patch("sys.stdin", io.TextIOWrapper(
            io.BytesIO(json.dumps(bad_payload).encode())
        )):
            _main()  # must return, not raise

    captured = capsys.readouterr()
    assert "session_id" in captured.err


def test_agent_identity_fields():
    """agent_kind and agent_version must match module constants."""
    payload = load_fixture("SessionStart")
    env = build_envelope(payload, "SessionStart", "my-app")
    assert env["agent_kind"] == AGENT_KIND
    assert env["agent_version"] == AGENT_VERSION
    assert env["source_app"] == "my-app"


def test_envelope_version_is_1():
    payload = load_fixture("SessionStart")
    env = build_envelope(payload, "SessionStart", "my-app")
    assert env["envelope_version"] == 1


def test_extract_normalized_with_transcript(tmp_path):
    """extract_normalized reads model_name from a valid transcript file."""
    transcript = tmp_path / "sess.jsonl"
    transcript.write_text(
        json.dumps({"role": "assistant", "model": "claude-opus-4-5", "content": "Hi"}) + "\n"
    )
    payload = {"tool_name": "Read", "cwd": "/x", "transcript_path": str(transcript)}
    result = extract_normalized(payload)
    assert result is not None
    assert result["model_name"] == "claude-opus-4-5"


def test_extract_normalized_missing_file():
    """extract_normalized does not crash when transcript_path doesn't exist."""
    payload = {"transcript_path": "/nonexistent/path.jsonl"}
    result = extract_normalized(payload)
    assert result is None


# ---------------------------------------------------------------------------
# Enriched normalized fields (enrich-claude-code-normalized)
# ---------------------------------------------------------------------------

def test_normalized_user_prompt_from_user_prompt_submit():
    payload = load_fixture("UserPromptSubmit")
    env = build_envelope(payload, "UserPromptSubmit", "test-app")
    assert env["normalized"]["user_prompt"] == "What files are in this repo?"


def test_normalized_tool_input_on_pre_tool_use():
    payload = load_fixture("PreToolUse")
    env = build_envelope(payload, "PreToolUse", "test-app")
    assert env["normalized"]["tool_input"] == {"command": "ls -la"}


def test_normalized_tool_output_on_post_tool_use():
    payload = load_fixture("PostToolUse")
    env = build_envelope(payload, "PostToolUse", "test-app")
    assert env["normalized"]["tool_output"] == payload["tool_response"]


def test_normalized_error_on_post_tool_use_failure():
    payload = load_fixture("PostToolUseFailure")
    env = build_envelope(payload, "PostToolUseFailure", "test-app")
    assert env["normalized"]["error"] == {
        "message": "cat: /nonexistent: No such file or directory"
    }
    assert "code" not in env["normalized"]["error"]


def test_normalized_notification_message():
    payload = load_fixture("Notification")
    env = build_envelope(payload, "Notification", "test-app")
    assert env["normalized"]["notification_message"] == "Claude needs your attention."


def test_extract_normalized_omits_field_on_type_mismatch():
    """A type mismatch on one source field omits only that field."""
    payload = {
        "tool_name": "Bash",
        "tool_input": "not-a-dict",  # mismatch
        "cwd": "/repo",
    }
    result = extract_normalized(payload)
    assert result is not None
    assert result["tool_name"] == "Bash"
    assert result["cwd"] == "/repo"
    assert "tool_input" not in result


def test_extract_normalized_does_not_mutate_payload():
    """The original stdin payload dict must remain deep-equal after extraction."""
    payload = load_fixture("PreToolUse")
    snapshot = json.loads(json.dumps(payload))
    extract_normalized(payload)
    assert payload == snapshot


def test_extract_normalized_returns_none_when_nothing_extractable():
    """Regression on the empty-block omission rule."""
    payload = {"some_unknown_key": 1, "another": "x"}
    assert extract_normalized(payload) is None


def test_normalized_error_omitted_when_not_string():
    """error wrapping must skip non-string values."""
    payload = {"tool_name": "Bash", "error": {"already": "object"}}
    result = extract_normalized(payload)
    assert result is not None
    assert "error" not in result


def test_normalized_omits_empty_strings():
    """Empty strings should not produce normalized fields."""
    payload = {"tool_name": "", "cwd": "", "prompt": "", "message": ""}
    assert extract_normalized(payload) is None
