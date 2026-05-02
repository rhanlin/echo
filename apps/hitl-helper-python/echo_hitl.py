"""
echo_hitl — Human-in-the-loop helper for the echo observability server.

Provides three blocking functions that POST a HITL envelope to echo and
long-poll for a human decision via the dashboard:

    ask_permission(question, *, source_app, session_id, ...) -> HitlOutcome
    ask_question(question, *, source_app, session_id, ...)   -> str | None
    ask_choice(question, choices, *, source_app, session_id, ...) -> str | None

All network I/O uses stdlib only (urllib.request, json, time, enum).
No third-party packages are required.

Typical usage from a Claude Code pre_tool_use hook:

    import sys, json
    sys.path.insert(0, "/path/to/apps/hitl-helper-python")
    from echo_hitl import ask_permission, HitlOutcome

    data = json.load(sys.stdin)
    outcome = ask_permission(
        "Allow this tool call?",
        source_app="my-agent",
        session_id=data["session_id"],
    )
    if outcome == HitlOutcome.GRANTED:
        sys.exit(0)   # allow
    else:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": str(outcome),
            }
        }))
        sys.exit(0)
"""

from __future__ import annotations

import argparse
import enum
import json
import sys
import time
import urllib.error
import urllib.request
from typing import Any

# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------

AGENT_VERSION = "0.1.0"
DEFAULT_SERVER_URL = "http://localhost:4000"
DEFAULT_TIMEOUT = 300  # seconds


class HitlOutcome(enum.Enum):
    GRANTED = "granted"
    DENIED = "denied"
    TIMEOUT = "timeout"
    ERROR = "error"


# ---------------------------------------------------------------------------
# Private HTTP helpers
# ---------------------------------------------------------------------------

def _post_json(url: str, body: dict[str, Any], timeout: int = 5) -> tuple[int, dict | None]:
    """POST *body* as JSON to *url*.  Returns (status_code, parsed_body).

    Returns (0, None) on any network or parsing error.
    """
    try:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            try:
                parsed = json.loads(resp.read().decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                parsed = None
            return resp.status, parsed
    except urllib.error.HTTPError as exc:
        try:
            parsed = json.loads(exc.read().decode("utf-8"))
        except Exception:
            parsed = None
        return exc.code, parsed
    except Exception:
        return 0, None


def _get_json(url: str, timeout: int) -> tuple[int, dict | None]:
    """GET *url* with *timeout*.  Returns (status_code, parsed_body).

    Returns (0, None) on any network or parsing error.
    """
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            try:
                parsed = json.loads(resp.read().decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                parsed = None
            return resp.status, parsed
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except Exception:
        return 0, None


# ---------------------------------------------------------------------------
# Envelope assembly
# ---------------------------------------------------------------------------

def _build_envelope(
    question: str,
    hitl_type: str,
    choices: list[str] | None,
    source_app: str,
    session_id: str,
    agent_kind: str,
    timeout: int,
) -> dict[str, Any]:
    """Construct a v1 EventEnvelope with a human_in_the_loop block."""
    hitl_block: dict[str, Any] = {
        "question": question,
        "type": hitl_type,
        "timeout": timeout,
        "callback": {"kind": "polling"},
    }
    if choices is not None:
        hitl_block["choices"] = choices

    return {
        "envelope_version": 1,
        "agent_kind": agent_kind,
        "agent_version": AGENT_VERSION,
        "source_app": source_app,
        "session_id": session_id,
        "event_type": "hitl.request",
        "raw_event_type": "HumanInTheLoop",
        "timestamp": int(time.time() * 1000),
        "payload": {},
        "human_in_the_loop": hitl_block,
    }


# ---------------------------------------------------------------------------
# Poll loop
# ---------------------------------------------------------------------------

def _poll_response(
    event_id: int | str,
    server_url: str,
    timeout: int,
) -> tuple[HitlOutcome, dict | None]:
    """Long-poll GET /events/{id}/response until a human responds, timeout, or error.

    Returns (HitlOutcome, response_body_dict | None).
    On 200: returns (GRANTED or DENIED depending on caller, body).
    On deadline: returns (TIMEOUT, None).
    On unexpected status: returns (ERROR, None).
    """
    base = server_url.rstrip("/")
    deadline = time.monotonic() + timeout

    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        wait = min(30, max(1, int(remaining)))
        url = f"{base}/events/{event_id}/response?wait={wait}"
        # Use wait+5 as the socket timeout so the server can cleanly return 408
        status, body = _get_json(url, timeout=wait + 5)
        if status == 200:
            return HitlOutcome.GRANTED, body  # Caller interprets the body
        if status == 408:
            continue  # Server timed out this long-poll; retry
        if status == 0:
            return HitlOutcome.ERROR, None
        # 404 or other unexpected status
        return HitlOutcome.ERROR, None

    return HitlOutcome.TIMEOUT, None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def ask_permission(
    question: str,
    *,
    source_app: str,
    session_id: str,
    agent_kind: str = "claude-code",
    server_url: str = DEFAULT_SERVER_URL,
    timeout: int = DEFAULT_TIMEOUT,
) -> HitlOutcome:
    """Post a permission HITL request and block until the human decides.

    Returns:
        HitlOutcome.GRANTED  — human approved
        HitlOutcome.DENIED   — human rejected
        HitlOutcome.TIMEOUT  — no response within *timeout* seconds
        HitlOutcome.ERROR    — server unreachable or unexpected response
    """
    envelope = _build_envelope(
        question=question,
        hitl_type="permission",
        choices=None,
        source_app=source_app,
        session_id=session_id,
        agent_kind=agent_kind,
        timeout=timeout,
    )
    status, body = _post_json(server_url.rstrip("/") + "/events", envelope)
    if status not in (200, 201) or body is None:
        return HitlOutcome.ERROR

    event_id = body.get("id")
    if event_id is None:
        return HitlOutcome.ERROR

    outcome, resp_body = _poll_response(event_id, server_url, timeout)
    if outcome != HitlOutcome.GRANTED:
        return outcome

    # Interpret the response body
    if resp_body is None:
        return HitlOutcome.ERROR
    permission = resp_body.get("permission")
    if permission is True:
        return HitlOutcome.GRANTED
    if permission is False:
        return HitlOutcome.DENIED
    return HitlOutcome.ERROR


def ask_question(
    question: str,
    *,
    source_app: str,
    session_id: str,
    agent_kind: str = "claude-code",
    server_url: str = DEFAULT_SERVER_URL,
    timeout: int = DEFAULT_TIMEOUT,
) -> str | None:
    """Post a free-text question and block until the human answers.

    Returns the answer string, or None on timeout/error.
    """
    envelope = _build_envelope(
        question=question,
        hitl_type="question",
        choices=None,
        source_app=source_app,
        session_id=session_id,
        agent_kind=agent_kind,
        timeout=timeout,
    )
    status, body = _post_json(server_url.rstrip("/") + "/events", envelope)
    if status not in (200, 201) or body is None:
        return None

    event_id = body.get("id")
    if event_id is None:
        return None

    outcome, resp_body = _poll_response(event_id, server_url, timeout)
    if outcome != HitlOutcome.GRANTED or resp_body is None:
        return None

    return resp_body.get("response")


def ask_choice(
    question: str,
    choices: list[str],
    *,
    source_app: str,
    session_id: str,
    agent_kind: str = "claude-code",
    server_url: str = DEFAULT_SERVER_URL,
    timeout: int = DEFAULT_TIMEOUT,
) -> str | None:
    """Post a multiple-choice question and block until the human selects an option.

    Returns the selected choice string, or None on timeout/error.
    """
    envelope = _build_envelope(
        question=question,
        hitl_type="choice",
        choices=choices,
        source_app=source_app,
        session_id=session_id,
        agent_kind=agent_kind,
        timeout=timeout,
    )
    status, body = _post_json(server_url.rstrip("/") + "/events", envelope)
    if status not in (200, 201) or body is None:
        return None

    event_id = body.get("id")
    if event_id is None:
        return None

    outcome, resp_body = _poll_response(event_id, server_url, timeout)
    if outcome != HitlOutcome.GRANTED or resp_body is None:
        return None

    return resp_body.get("choice")


# ---------------------------------------------------------------------------
# CLI mode
# ---------------------------------------------------------------------------

def _cli_main() -> None:
    parser = argparse.ArgumentParser(
        description="Send a HITL request to the echo server and print the outcome.",
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--permission", metavar="QUESTION", help="Ask a yes/no permission question")
    mode.add_argument("--question", metavar="QUESTION", help="Ask a free-text question")
    mode.add_argument("--choice", metavar="QUESTION", help="Ask a multiple-choice question")

    parser.add_argument("--source-app", required=True, help="Source application identifier")
    parser.add_argument("--session-id", required=True, help="Session ID for the event envelope")
    parser.add_argument("--server-url", default=DEFAULT_SERVER_URL, help=f"Echo server URL (default: {DEFAULT_SERVER_URL})")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help=f"Timeout in seconds (default: {DEFAULT_TIMEOUT})")
    parser.add_argument("--choices", help="Comma-separated list of choices (required for --choice mode)")
    parser.add_argument("--agent-kind", default="claude-code", help="Agent kind identifier (default: claude-code)")

    args = parser.parse_args()

    common = dict(
        source_app=args.source_app,
        session_id=args.session_id,
        agent_kind=args.agent_kind,
        server_url=args.server_url,
        timeout=args.timeout,
    )

    if args.permission:
        result = ask_permission(args.permission, **common)
        print(result.value)
    elif args.question:
        result = ask_question(args.question, **common)
        print(result if result is not None else "timeout/error")
    elif args.choice:
        if not args.choices:
            parser.error("--choices is required when using --choice mode")
        choices_list = [c.strip() for c in args.choices.split(",") if c.strip()]
        result = ask_choice(args.choice, choices_list, **common)
        print(result if result is not None else "timeout/error")


if __name__ == "__main__":
    _cli_main()
