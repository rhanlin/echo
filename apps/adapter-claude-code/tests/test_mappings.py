"""Tests for the hook-name → canonical event_type mapping table."""
from __future__ import annotations

import sys
from pathlib import Path

# Allow importing sibling modules without installing the package
sys.path.insert(0, str(Path(__file__).parent.parent))

from mappings import HOOK_TO_EVENT_TYPE

# Canonical vocabulary copied from packages/envelope/event-types.ts
# (kept in sync manually; test will fail if an unknown value is introduced)
CANONICAL_EVENT_TYPES = {
    "session.start",
    "session.end",
    "user.prompt.submit",
    "tool.pre_use",
    "tool.post_use",
    "tool.failure",
    "agent.notification",
    "agent.stop",
    "agent.precompact",
    "hitl.request",
    "subagent.start",
    "subagent.stop",
    "unknown",
}

ALL_HOOK_NAMES = {
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "Notification",
    "Stop",
    "PreCompact",
    "SubagentStart",
    "SubagentStop",
    "PermissionRequest",
}


def test_all_hooks_covered():
    """Every known hook name must have an entry in the mapping table."""
    missing = ALL_HOOK_NAMES - set(HOOK_TO_EVENT_TYPE.keys())
    assert not missing, f"Hooks missing from mapping table: {missing}"


def test_all_hooks_map_to_canonical():
    """Every value in the mapping table must be a canonical event_type."""
    non_canonical = {
        hook: et
        for hook, et in HOOK_TO_EVENT_TYPE.items()
        if et not in CANONICAL_EVENT_TYPES
    }
    assert not non_canonical, (
        f"Non-canonical event_type values found: {non_canonical}"
    )


def test_permission_request_maps_to_hitl_request():
    """PermissionRequest must map to hitl.request, not tool.pre_use."""
    assert HOOK_TO_EVENT_TYPE["PermissionRequest"] == "hitl.request"
    assert HOOK_TO_EVENT_TYPE["PreToolUse"] == "tool.pre_use"


def test_session_hooks():
    assert HOOK_TO_EVENT_TYPE["SessionStart"] == "session.start"
    assert HOOK_TO_EVENT_TYPE["SessionEnd"] == "session.end"


def test_tool_hooks():
    assert HOOK_TO_EVENT_TYPE["PreToolUse"] == "tool.pre_use"
    assert HOOK_TO_EVENT_TYPE["PostToolUse"] == "tool.post_use"
    assert HOOK_TO_EVENT_TYPE["PostToolUseFailure"] == "tool.failure"


def test_agent_hooks():
    assert HOOK_TO_EVENT_TYPE["Notification"] == "agent.notification"
    assert HOOK_TO_EVENT_TYPE["Stop"] == "agent.stop"
    assert HOOK_TO_EVENT_TYPE["PreCompact"] == "agent.precompact"


def test_subagent_hooks():
    assert HOOK_TO_EVENT_TYPE["SubagentStart"] == "subagent.start"
    assert HOOK_TO_EVENT_TYPE["SubagentStop"] == "subagent.stop"
