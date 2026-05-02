#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# ///
"""
hook_gate.py — Example pre_tool_use hook that gates dangerous commands
through the echo dashboard using echo_hitl.

Add this to your .claude/settings.json hooks:
    {
      "hooks": {
        "PreToolUse": [
          {
            "matcher": "Bash",
            "hooks": [
              {
                "type": "command",
                "command": "uv run /path/to/apps/hitl-helper-python/examples/hook_gate.py"
              }
            ]
          }
        ]
      }
    }

The hook reads a PreToolUse JSON payload from stdin, checks if the Bash
command looks dangerous, and if so sends an approval request to the echo
dashboard.  The agent is blocked until a human responds.

On GRANTED  → exit 0 (tool allowed)
On DENIED   → print JSON with permissionDecision: deny and exit 0
On TIMEOUT  → deny by default (safe fallback)
On ERROR    → deny by default (safe fallback)
"""

from __future__ import annotations

import json
import os
import sys

# Allow running from any directory: resolve echo_hitl relative to this file
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, ".."))

from echo_hitl import HitlOutcome, ask_permission

# ---------------------------------------------------------------------------
# Configuration — override via environment variables
# ---------------------------------------------------------------------------

SOURCE_APP = os.environ.get("ECHO_SOURCE_APP", "claude-code")
SERVER_URL = os.environ.get("ECHO_SERVER_URL", "http://localhost:4000")
TIMEOUT = int(os.environ.get("ECHO_HITL_TIMEOUT", "300"))

# Substrings that trigger a HITL gate on Bash commands
DANGEROUS_PATTERNS = [
    "rm -rf",
    "rm -fr",
    "DROP TABLE",
    "truncate",
    "git push --force",
    "git reset --hard",
]


def _is_dangerous(command: str) -> bool:
    low = command.lower()
    return any(p.lower() in low for p in DANGEROUS_PATTERNS)


def _deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)  # Malformed input — let Claude Code decide

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    session_id = data.get("session_id", "unknown")

    if tool_name != "Bash":
        sys.exit(0)  # Only gate Bash tool calls

    command = tool_input.get("command", "")
    if not _is_dangerous(command):
        sys.exit(0)  # Safe command — allow

    # Ask the dashboard for approval
    question = (
        f"Allow this Bash command?\n\n```\n{command[:500]}\n```"
    )
    outcome = ask_permission(
        question,
        source_app=SOURCE_APP,
        session_id=session_id,
        server_url=SERVER_URL,
        timeout=TIMEOUT,
    )

    if outcome == HitlOutcome.GRANTED:
        sys.exit(0)
    elif outcome == HitlOutcome.DENIED:
        _deny("Blocked by dashboard: human denied the command.")
    elif outcome == HitlOutcome.TIMEOUT:
        _deny("HITL request timed out — blocking by default for safety.")
    else:  # ERROR
        _deny("Could not reach echo dashboard — blocking by default for safety.")


if __name__ == "__main__":
    main()
