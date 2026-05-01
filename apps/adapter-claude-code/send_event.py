#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# ///
"""
echo adapter for Claude Code hooks.

Reads a Claude Code hook JSON payload from stdin, translates it into a
v1 EventEnvelope, and POSTs it to an echo server. Always exits 0 — this
adapter must NEVER block or disrupt the user's Claude Code session.

Usage (via .claude/settings.json):
  uv run /path/to/echo/apps/adapter-claude-code/send_event.py \\
      --event-type PreToolUse

Configuration (priority order):
  1. CLI flag:   --source-app, --server-url
  2. Env var:    ECHO_SOURCE_APP, ECHO_SERVER_URL
  3. Default:    ECHO_SERVER_URL defaults to http://localhost:4000
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

from mappings import HOOK_TO_EVENT_TYPE

AGENT_KIND = "claude-code"
AGENT_VERSION = "0.1.0"
DEFAULT_SERVER_URL = "http://localhost:4000"


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def resolve_config(
    args: argparse.Namespace,
    env: dict[str, str],
) -> tuple[str, str | None]:
    """Return (server_url, source_app).

    source_app may be None when neither flag nor env var is set.
    Caller is responsible for emitting the warning and exiting.
    """
    server_url = (
        getattr(args, "server_url", None)
        or env.get("ECHO_SERVER_URL")
        or DEFAULT_SERVER_URL
    )
    source_app = getattr(args, "source_app", None) or env.get("ECHO_SOURCE_APP")
    return server_url, source_app


# ---------------------------------------------------------------------------
# Normalized field extraction
# ---------------------------------------------------------------------------

def extract_model_name(transcript_path: str) -> str:
    """Read model name from transcript .jsonl with a 100ms budget.

    Returns empty string on any error or budget overrun.
    """
    deadline = time.monotonic() + 0.1  # 100ms
    try:
        model = ""
        with open(transcript_path, "r", encoding="utf-8") as fh:
            for raw in fh:
                if time.monotonic() > deadline:
                    break
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    entry = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                # Claude Code transcripts: entries with role "assistant" and
                # a top-level "model" field (set by the CLI before writing)
                if entry.get("role") == "assistant" and entry.get("model"):
                    model = entry["model"]
        return model
    except Exception:
        return ""


def extract_normalized(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Return a normalized convenience block, or None if nothing to extract."""
    result: dict[str, Any] = {}

    if payload.get("tool_name"):
        result["tool_name"] = payload["tool_name"]
    if payload.get("cwd"):
        result["cwd"] = payload["cwd"]

    transcript_path = payload.get("transcript_path", "")
    if transcript_path and os.path.isfile(transcript_path):
        model = extract_model_name(transcript_path)
        if model:
            result["model_name"] = model

    return result if result else None


# ---------------------------------------------------------------------------
# Envelope assembly
# ---------------------------------------------------------------------------

def build_envelope(
    stdin_payload: dict[str, Any],
    event_type_arg: str,
    source_app: str,
    agent_version: str = AGENT_VERSION,
) -> dict[str, Any]:
    """Construct a v1 EventEnvelope dict from the raw hook payload."""
    event_type = HOOK_TO_EVENT_TYPE.get(event_type_arg, "unknown")

    envelope: dict[str, Any] = {
        "envelope_version": 1,
        "agent_kind": AGENT_KIND,
        "agent_version": agent_version,
        "source_app": source_app,
        "session_id": stdin_payload.get("session_id", ""),
        "event_type": event_type,
        "raw_event_type": event_type_arg,
        "payload": stdin_payload,
        "timestamp": int(time.time() * 1000),
    }

    normalized = extract_normalized(stdin_payload)
    if normalized is not None:
        envelope["normalized"] = normalized

    return envelope


# ---------------------------------------------------------------------------
# HTTP delivery
# ---------------------------------------------------------------------------

def post_envelope(server_url: str, envelope: dict[str, Any]) -> bool:
    """POST envelope to echo server.  Returns True on 2xx, False on any error.

    Never raises — all exceptions are caught and logged to stderr.
    """
    endpoint = server_url.rstrip("/") + "/events"
    try:
        data = json.dumps(envelope).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=data,
            headers={
                "Content-Type": "application/json",
                "User-Agent": f"echo-adapter-claude-code/{AGENT_VERSION}",
            },
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            if 200 <= resp.status < 300:
                return True
            print(
                f"echo-adapter: POST {endpoint} returned {resp.status}",
                file=sys.stderr,
            )
            return False
    except urllib.error.HTTPError as exc:
        print(
            f"echo-adapter: POST {endpoint} HTTP error {exc.code}: {exc.reason}",
            file=sys.stderr,
        )
        return False
    except urllib.error.URLError as exc:
        print(f"echo-adapter: POST {endpoint} failed: {exc.reason}", file=sys.stderr)
        return False
    except Exception as exc:  # noqa: BLE001
        print(f"echo-adapter: POST {endpoint} unexpected error: {exc}", file=sys.stderr)
        return False


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    try:
        _main()
    except Exception as exc:  # noqa: BLE001
        print(f"echo-adapter: unhandled error: {exc}", file=sys.stderr)
    sys.exit(0)


def _main() -> None:
    parser = argparse.ArgumentParser(
        description="Send a Claude Code hook event to an echo server as a v1 envelope."
    )
    parser.add_argument(
        "--event-type",
        required=True,
        help="Claude Code hook name (e.g. PreToolUse, SessionStart)",
    )
    parser.add_argument(
        "--source-app",
        default=None,
        help="Source application identifier. Overrides ECHO_SOURCE_APP env var.",
    )
    parser.add_argument(
        "--server-url",
        default=None,
        help="Echo server base URL. Overrides ECHO_SERVER_URL. Default: http://localhost:4000",
    )
    args = parser.parse_args()

    # Validate event-type
    if args.event_type not in HOOK_TO_EVENT_TYPE:
        print(
            f"echo-adapter: unknown --event-type '{args.event_type}'. "
            f"Known types: {', '.join(sorted(HOOK_TO_EVENT_TYPE))}",
            file=sys.stderr,
        )
        return

    # Read stdin
    try:
        stdin_payload: dict[str, Any] = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"echo-adapter: failed to parse stdin JSON: {exc}", file=sys.stderr)
        return

    # Resolve config
    server_url, source_app = resolve_config(args, dict(os.environ))
    if not source_app:
        print(
            "echo-adapter: source_app not set. "
            "Use --source-app flag or set ECHO_SOURCE_APP env var.",
            file=sys.stderr,
        )
        return

    # Validate session_id
    if not stdin_payload.get("session_id"):
        print(
            "echo-adapter: payload missing 'session_id' — skipping event.",
            file=sys.stderr,
        )
        return

    # Build + send
    envelope = build_envelope(stdin_payload, args.event_type, source_app)
    post_envelope(server_url, envelope)


if __name__ == "__main__":
    main()
