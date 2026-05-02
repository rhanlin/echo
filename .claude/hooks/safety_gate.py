#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# ///
"""
safety_gate.py — PreToolUse safety hook for agents-observe.

Classifies Bash commands into:
  - blacklist  → instant local deny (e.g. `rm -rf /`, `rm -rf $HOME`)
  - graylist   → push to dashboard via echo_hitl.ask_permission()
  - safe       → pass through (allow)

Environment variables:
  ECHO_HITL_TIMEOUT  — seconds to wait for human decision (default: 60)
  ECHO_SERVER_URL    — echo server base URL (default: http://127.0.0.1:4000)
  CLAUDE_PROJECT_DIR — set by Claude Code; used to locate echo_hitl.

Contract:
  - Reads PreToolUse JSON from stdin.
  - On deny: prints Claude Code permissionDecision JSON to stdout, exits 0.
  - On allow: empty stdout, exits 0.
  - Always exits 0 (never crashes Claude Code).
  - Fails closed: any unexpected error → deny.
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Optional, Tuple

# ---------------------------------------------------------------------------
# Configuration — edit these lists to extend coverage.
# ---------------------------------------------------------------------------

# Patterns that are NEVER permitted, even by human approval.
# Each pattern is a regex applied to a normalized (lowercased, single-spaced)
# version of the command.
BLACKLIST_PATTERNS: list[str] = [
    r'\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\s+/\s*$',   # rm -rf /
    r'\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\s+/\*',     # rm -rf /*
    r'\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\s+~\s*$',   # rm -rf ~
    r'\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\s+~/\s*$',  # rm -rf ~/
    r'\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\s+\$home\b',# rm -rf $HOME
    r'\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\s+\.\s*$',  # rm -rf .
    r'\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\s+\*\s*$',  # rm -rf *
    r'\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\s+\.\.\s*$',# rm -rf ..
]

# Recognises any rm invocation with a recursive flag — graylist candidate.
RM_RECURSIVE_PATTERNS: list[str] = [
    r'\brm\s+.*-[a-z]*r[a-z]*f\b',          # rm -rf, rm -fr, rm -Rf, etc.
    r'\brm\s+.*-[a-z]*f[a-z]*r\b',          # rm -fr variations
    r'\brm\s+--recursive\s+--force\b',
    r'\brm\s+--force\s+--recursive\b',
    r'\brm\s+-r\s+.*-f\b',
    r'\brm\s+-f\s+.*-r\b',
]

# Directories where rm -rf is silently permitted (no HITL prompt).
ALLOWED_RM_DIRECTORIES: list[str] = [
    'trees/',
    'tmp/',
    '.cache/',
]

DEFAULT_TIMEOUT = 60
DEFAULT_SERVER_URL = "http://127.0.0.1:4000"
DEFAULT_SOURCE_APP = "agents-observe"

# ---------------------------------------------------------------------------
# Pattern helpers
# ---------------------------------------------------------------------------


def _normalize(command: str) -> str:
    return ' '.join(command.lower().split())


def _matches_any(normalized: str, patterns: list[str]) -> bool:
    for p in patterns:
        if re.search(p, normalized):
            return True
    return False


def _is_blacklisted(command: str) -> bool:
    return _matches_any(_normalize(command), BLACKLIST_PATTERNS)


def _is_rm_recursive(command: str) -> bool:
    return _matches_any(_normalize(command), RM_RECURSIVE_PATTERNS)


def _extract_rm_targets(command: str) -> list[str]:
    """Return the path arguments of an rm invocation, stripped of quotes."""
    match = re.search(r'rm\s+(?:-[\w-]+\s+|--[\w-]+\s+)*(.+)$', command, re.IGNORECASE)
    if not match:
        return []
    raw = match.group(1).strip()
    return [p.strip('\'"') for p in raw.split() if p.strip('\'"')]


def _all_targets_allowed(command: str, allowed_dirs: list[str]) -> bool:
    targets = _extract_rm_targets(command)
    if not targets:
        return False
    for path in targets:
        ok = False
        for allowed in allowed_dirs:
            if path.startswith(allowed) or path.startswith('./' + allowed):
                ok = True
                break
        if not ok:
            return False
    return True


def _classify(command: str) -> str:
    """Returns 'blacklist', 'graylist', or 'safe'."""
    if _is_blacklisted(command):
        return 'blacklist'
    if _is_rm_recursive(command):
        if _all_targets_allowed(command, ALLOWED_RM_DIRECTORIES):
            return 'safe'
        return 'graylist'
    return 'safe'


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------


def _read_input() -> dict:
    try:
        return json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return {}


def _emit_deny(reason: str) -> None:
    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    print(json.dumps(output))


# ---------------------------------------------------------------------------
# echo_hitl integration
# ---------------------------------------------------------------------------


def _load_echo_hitl() -> Tuple[Optional[object], Optional[object]]:
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    helper_dir = os.path.join(project_dir, "apps", "hitl-helper-python")
    if helper_dir not in sys.path:
        sys.path.insert(0, helper_dir)
    try:
        from echo_hitl import ask_permission, HitlOutcome  # type: ignore
        return ask_permission, HitlOutcome
    except ImportError:
        return None, None


def _get_timeout() -> int:
    raw = os.environ.get("ECHO_HITL_TIMEOUT")
    if raw is None:
        return DEFAULT_TIMEOUT
    try:
        value = int(raw)
        if value <= 0:
            return DEFAULT_TIMEOUT
        return value
    except ValueError:
        return DEFAULT_TIMEOUT


def _get_server_url() -> str:
    return os.environ.get("ECHO_SERVER_URL", DEFAULT_SERVER_URL)


def _get_source_app() -> str:
    return os.environ.get("ECHO_SOURCE_APP", DEFAULT_SOURCE_APP)


def _request_human_approval(command: str, session_id: str) -> bool:
    """Ask via dashboard. Returns True iff GRANTED. Emits deny otherwise."""
    ask_permission, HitlOutcome = _load_echo_hitl()
    if ask_permission is None or HitlOutcome is None:
        _emit_deny("safety-gate: echo_hitl not available")
        return False

    question = f"Allow Bash command? `{command}`"
    try:
        outcome = ask_permission(
            question,
            source_app=_get_source_app(),
            session_id=session_id,
            agent_kind="claude-code",
            server_url=_get_server_url(),
            timeout=_get_timeout(),
        )
    except Exception as e:
        _emit_deny(f"safety-gate: error - {type(e).__name__}: {e}")
        return False

    if outcome == HitlOutcome.GRANTED:
        return True

    deny_messages = {
        HitlOutcome.DENIED: "safety-gate: human denied",
        HitlOutcome.TIMEOUT: "safety-gate: timeout",
        HitlOutcome.ERROR: "safety-gate: HITL request failed",
    }
    _emit_deny(deny_messages.get(outcome, f"safety-gate: unexpected outcome {outcome!r}"))
    return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    try:
        data = _read_input()
        tool_name = data.get('tool_name', '')

        if tool_name != 'Bash':
            return  # not our concern

        tool_input = data.get('tool_input', {}) or {}
        command = tool_input.get('command', '') or ''
        if not command.strip():
            return

        session_id = data.get('session_id', 'unknown')
        verdict = _classify(command)

        if verdict == 'blacklist':
            _emit_deny("safety-gate: blacklisted command")
            return

        if verdict == 'graylist':
            _request_human_approval(command, session_id)
            return

        # safe → silent allow
        return

    except Exception as e:  # fail closed on any unexpected error
        _emit_deny(f"safety-gate: hook error - {type(e).__name__}: {e}")


if __name__ == '__main__':
    main()
    sys.exit(0)
