"""
Mapping from Claude Code HookEventName → echo canonical event_type.

See: packages/envelope/event-types.ts for the canonical vocabulary.
Design decision: PermissionRequest maps to hitl.request because Claude Code is
blocked on an explicit human allow/deny decision.
"""

HOOK_TO_EVENT_TYPE: dict[str, str] = {
    "SessionStart": "session.start",
    "SessionEnd": "session.end",
    "UserPromptSubmit": "user.prompt.submit",
    "PreToolUse": "tool.pre_use",
    "PostToolUse": "tool.post_use",
    "PostToolUseFailure": "tool.failure",
    "Notification": "agent.notification",
    "Stop": "agent.stop",
    "PreCompact": "agent.precompact",
    "SubagentStart": "subagent.start",
    "SubagentStop": "subagent.stop",
    "PermissionRequest": "hitl.request",
}
