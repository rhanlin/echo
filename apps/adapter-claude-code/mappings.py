"""
Mapping from Claude Code HookEventName → echo canonical event_type.

See: packages/envelope/event-types.ts for the canonical vocabulary.
Design decision: PermissionRequest folds into tool.pre_use because both
represent "agent intends to use a tool". raw_event_type preserves the
distinction for dashboards that want to distinguish them.
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
    "PermissionRequest": "tool.pre_use",
}
